<?php
header('Content-Type: text/plain; charset=utf-8');

echo "========== PHP 环境 ==========\n";
echo "PHP 版本: " . PHP_VERSION . "\n";
echo "SAPI: " . PHP_SAPI . "\n\n";

echo "========== 关键函数可用性 ==========\n";
$funcs = ['stream_socket_client', 'fsockopen', 'pfsockopen', 'mail', 'curl_init'];
foreach ($funcs as $f) {
    echo $f . ": " . (function_exists($f) ? "可用" : "被禁/不存在") . "\n";
}
echo "\n";

echo "========== disable_functions 完整列表 ==========\n";
$disabled = ini_get('disable_functions');
if ($disabled) {
    foreach (explode(',', $disabled) as $d) {
        $d = trim($d);
        if ($d !== '') echo "- " . $d . "\n";
    }
} else {
    echo "(空 — 没有禁用任何函数)\n";
}
echo "\n";

echo "========== cURL ==========\n";
if (function_exists('curl_version')) {
    $c = curl_version();
    echo "cURL 版本: " . $c['version'] . "\n";
    echo "SSL 版本: " . $c['ssl_version'] . "\n";
    echo "支持的协议: " . implode(', ', $c['protocols']) . "\n";
    echo "支持 SMTP 协议: " . (in_array('smtp', $c['protocols']) ? '是' : '否') . "\n";
    echo "支持 HTTPS 协议: " . (in_array('https', $c['protocols']) ? '是' : '否') . "\n";
} else {
    echo "cURL 不可用\n";
}
echo "\n";

echo "========== 端口连通性实测（fsockopen）==========\n";
if (function_exists('fsockopen')) {
    $targets = [
        ['smtp.qiye.aliyun.com', 465, 'SMTP SSL'],
        ['smtp.qiye.aliyun.com', 587, 'SMTP TLS'],
        ['smtp.qiye.aliyun.com', 25,  'SMTP 明文'],
        ['haveways.com', 443, 'HTTPS（对照，应连通）'],
    ];
    foreach ($targets as [$host, $port, $label]) {
        $errno = 0; $errstr = '';
        $fp = @fsockopen($host, $port, $errno, $errstr, 8);
        if ($fp) {
            echo "[$label] $host:$port => 连通\n";
            fclose($fp);
        } else {
            echo "[$label] $host:$port => 失败: ($errno) $errstr\n";
        }
    }
} else {
    echo "fsockopen 被禁，无法测试端口连通性\n";
}
