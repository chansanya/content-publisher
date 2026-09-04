<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
ignore_user_abort(true);
set_time_limit(0);

function respond(int $status, array $payload): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function remove_tree(string $path): void
{
    if (is_link($path) || is_file($path)) {
        if (!unlink($path)) throw new RuntimeException("无法删除文件: {$path}");
        return;
    }
    if (!is_dir($path)) return;
    $items = scandir($path);
    if ($items === false) throw new RuntimeException("无法读取目录: {$path}");
    foreach ($items as $item) {
        if ($item === '.' || $item === '..') continue;
        remove_tree($path . DIRECTORY_SEPARATOR . $item);
    }
    if (!rmdir($path)) throw new RuntimeException("无法删除目录: {$path}");
}

function move_tree(string $source, string $target): void
{
    if (@rename($source, $target)) return;
    if (is_file($source)) {
        if (!copy($source, $target)) throw new RuntimeException("无法发布文件: {$target}");
        unlink($source);
        return;
    }
    if (!is_dir($target) && !mkdir($target, 0755, true)) {
        throw new RuntimeException("无法创建目录: {$target}");
    }
    $items = scandir($source);
    if ($items === false) throw new RuntimeException("无法读取目录: {$source}");
    foreach ($items as $item) {
        if ($item === '.' || $item === '..') continue;
        move_tree($source . DIRECTORY_SEPARATOR . $item, $target . DIRECTORY_SEPARATOR . $item);
    }
    rmdir($source);
}

/** 相对站点根的安全路径：拒绝绝对路径、盘符、. .. 空段，以及站点根下的隐藏目录（含 .ftppublisher 控制目录） */
function is_safe_relative_path(string $raw): bool
{
    $path = str_replace('\\', '/', trim($raw));
    if ($path === '' || $path[0] === '/' || preg_match('/^[A-Za-z]:/', $path)) return false;
    $parts = explode('/', $path);
    if ($parts[0] === '' || $parts[0][0] === '.') return false;
    foreach ($parts as $segment) {
        if ($segment === '' || $segment === '.' || $segment === '..') return false;
    }
    return true;
}

function normalize_preserve_path(string $raw): ?string
{
    $path = trim(str_replace('\\', '/', $raw), '/');
    if ($path === '' || preg_match('/^[A-Za-z]:/', $path)) return null;
    $parts = explode('/', $path);
    foreach ($parts as $part) {
        if ($part === '' || $part === '.' || $part === '..' || $part[0] === '.' || preg_match('/[\r\n]/', $part)) {
            return null;
        }
    }
    return implode('/', $parts);
}

function path_intersects_preserved(string $path, array $preserved): bool
{
    $path = trim(str_replace('\\', '/', $path), '/');
    foreach ($preserved as $protected) {
        if ($path === $protected || strncmp($path, $protected . '/', strlen($protected) + 1) === 0 || strncmp($protected, $path . '/', strlen($path) + 1) === 0) {
            return true;
        }
    }
    return false;
}

// config.php 中的 preserve 是插件管理器同步的远程相对路径；其祖先与子项同样视为受保护。

if ($_SERVER['REQUEST_METHOD'] !== 'POST') respond(405, ['ok' => false, 'message' => 'Method Not Allowed']);
if (!class_exists('ZipArchive')) respond(500, ['ok' => false, 'message' => '服务器未启用 PHP ZipArchive']);

$configFile = __DIR__ . DIRECTORY_SEPARATOR . 'config.php';
if (!is_file($configFile)) respond(500, ['ok' => false, 'message' => '部署配置不存在']);
$config = require $configFile;
$expectedToken = is_array($config) ? (string)($config['token'] ?? '') : '';
$preservedPaths = [];
if (is_array($config) && is_array($config['preserve'] ?? null)) {
    foreach ($config['preserve'] as $name) {
        if (is_string($name) && ($normalized = normalize_preserve_path($name)) !== null) $preservedPaths[$normalized] = true;
    }
}
$providedToken = (string)($_SERVER['HTTP_X_FTPPUBLISHER_TOKEN'] ?? '');
if ($expectedToken === '' || !hash_equals($expectedToken, $providedToken)) {
    respond(403, ['ok' => false, 'message' => '部署密钥无效']);
}

$body = json_decode((string)file_get_contents('php://input'), true);
$action = is_array($body) ? (string)($body['action'] ?? 'deploy') : '';
$releaseId = is_array($body) ? (string)($body['releaseId'] ?? '') : '';
$paths = [];
if ($action === 'deploy' && !preg_match('/^[A-Za-z0-9_-]{6,100}$/', $releaseId)) {
    respond(400, ['ok' => false, 'message' => 'releaseId 非法']);
}
if ($action === 'delete') {
    $paths = is_array($body['paths'] ?? null) ? $body['paths'] : [];
    if (count($paths) < 1 || count($paths) > 100) {
        respond(400, ['ok' => false, 'message' => 'paths 必须是 1-100 条路径数组']);
    }
    foreach ($paths as $relative) {
        if (!is_string($relative) || !is_safe_relative_path($relative)) {
            respond(400, ['ok' => false, 'message' => '包含非法路径']);
        }
        if (path_intersects_preserved($relative, array_keys($preservedPaths))) {
            respond(403, ['ok' => false, 'message' => '插件映射目录只能在插件管理页面删除']);
        }
    }
}
if ($action === 'clear' && is_array($body) && is_array($body['preserve'] ?? null)) {
    foreach ($body['preserve'] as $name) {
        if (is_string($name) && ($normalized = normalize_preserve_path($name)) !== null) $preservedPaths[$normalized] = true;
    }
}

$controlDir = __DIR__;
$controlName = basename($controlDir);
$preservedPaths[$controlName] = true;
$protectedPaths = array_keys($preservedPaths);
$rootDir = dirname($controlDir);
$archivePath = $controlDir . DIRECTORY_SEPARATOR . 'incoming' . DIRECTORY_SEPARATOR . $releaseId . '.zip';
$stagingDir = $controlDir . DIRECTORY_SEPARATOR . 'staging' . DIRECTORY_SEPARATOR . $releaseId;
$lock = fopen($controlDir . DIRECTORY_SEPARATOR . 'deploy.lock', 'c');
if ($lock === false || !flock($lock, LOCK_EX | LOCK_NB)) {
    respond(409, ['ok' => false, 'message' => '已有部署任务正在执行']);
}

$startedAt = microtime(true);
try {
    if ($action === 'delete') {
        $entries = [];
        foreach ($paths as $relative) {
            $full = $rootDir . DIRECTORY_SEPARATOR . str_replace('\\', '/', $relative);
            if (is_link($full)) $type = 'link';
            elseif (is_dir($full)) $type = 'directory';
            elseif (is_file($full)) $type = 'file';
            else {
                $entries[] = ['path' => $relative, 'type' => null, 'existed' => false];
                continue;
            }
            remove_tree($full);
            $entries[] = ['path' => $relative, 'type' => $type, 'existed' => true];
        }
        flock($lock, LOCK_UN);
        fclose($lock);
        respond(200, [
            'ok' => true,
            'entries' => $entries,
            'durationMs' => (int)round((microtime(true) - $startedAt) * 1000)
        ]);
    }
    if ($action === 'clear') {
        $rootItems = scandir($rootDir);
        if ($rootItems === false) throw new RuntimeException('无法读取站点根目录');
        $removed = 0;
        foreach ($rootItems as $item) {
            if ($item === '.' || $item === '..' || path_intersects_preserved($item, $protectedPaths)) continue;
            remove_tree($rootDir . DIRECTORY_SEPARATOR . $item);
            $removed += 1;
        }
        flock($lock, LOCK_UN);
        fclose($lock);
        respond(200, [
            'ok' => true,
            'removed' => $removed,
            'durationMs' => (int)round((microtime(true) - $startedAt) * 1000)
        ]);
    }
    if ($action !== 'deploy') respond(400, ['ok' => false, 'message' => '未知 action']);

    if (!is_file($archivePath)) throw new RuntimeException('待发布 ZIP 不存在');
    remove_tree($stagingDir);
    if (!mkdir($stagingDir, 0755, true) && !is_dir($stagingDir)) {
        throw new RuntimeException('无法创建解压目录');
    }

    $zip = new ZipArchive();
    if ($zip->open($archivePath) !== true) throw new RuntimeException('ZIP 无法打开');
    for ($index = 0; $index < $zip->numFiles; $index++) {
        $name = str_replace('\\', '/', (string)$zip->getNameIndex($index));
        $parts = explode('/', $name);
        if ($name === '' || $name[0] === '/' || preg_match('/^[A-Za-z]:/', $name) || in_array('..', $parts, true)) {
            $zip->close();
            throw new RuntimeException("ZIP 包含非法路径: {$name}");
        }
    }
    if (!$zip->extractTo($stagingDir)) {
        $zip->close();
        throw new RuntimeException('ZIP 解压失败');
    }
    $fileCount = $zip->numFiles;
    $zip->close();

    $rootItems = scandir($rootDir);
    if ($rootItems === false) throw new RuntimeException('无法读取站点根目录');
    foreach ($rootItems as $item) {
        if ($item === '.' || $item === '..' || path_intersects_preserved($item, $protectedPaths)) continue;
        remove_tree($rootDir . DIRECTORY_SEPARATOR . $item);
    }

    $stagingItems = scandir($stagingDir);
    if ($stagingItems === false) throw new RuntimeException('无法读取解压结果');
    foreach ($stagingItems as $item) {
        if ($item === '.' || $item === '..') continue;
        if (path_intersects_preserved($item, $protectedPaths)) continue;
        move_tree($stagingDir . DIRECTORY_SEPARATOR . $item, $rootDir . DIRECTORY_SEPARATOR . $item);
    }

    remove_tree($stagingDir);
    unlink($archivePath);
    flock($lock, LOCK_UN);
    fclose($lock);
    respond(200, [
        'ok' => true,
        'releaseId' => $releaseId,
        'files' => $fileCount,
        'durationMs' => (int)round((microtime(true) - $startedAt) * 1000)
    ]);
} catch (Throwable $error) {
    flock($lock, LOCK_UN);
    fclose($lock);
    respond(500, ['ok' => false, 'message' => $error->getMessage()]);
}
