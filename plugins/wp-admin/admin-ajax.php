<?php
declare(strict_types=1);

require_once __DIR__ . '/mailer.php';

/* 表单业务配置：收件人、标题、接口 action 与 nonce。 */
const MAIL_TO = 'siyuanma1221@hotmail.com';
// const MAIL_TO = 'sales@Haveways.com';
const MAIL_SUBJECT = '网站表单消息';

const FORM_ACTION = 'elementor_form_builder_form_ajax';
const FORM_NONCE = '3d3a6568da';
const SHORT_MESSAGE_POST_ID = '340';
const CONTACT_POST_ID = '307';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Cache-Control: no-store');

function respond(int $status, bool $success, string $message): void
{
    http_response_code($status);
    echo json_encode(
        ['success' => $success, 'data' => ['message' => $message]],
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
    );
    exit;
}

function request_data(): array
{
    if ($_POST !== []) return $_POST;

    $json = json_decode((string)file_get_contents('php://input'), true);
    return is_array($json) ? $json : [];
}

function plain_text(string $content): string
{
    $content = preg_replace('/<br\s*\/?>/i', "\n", $content) ?? $content;
    $content = html_entity_decode($content, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $content = strip_tags($content);
    $content = str_replace(["\r\n", "\r"], "\n", $content);
    $content = preg_replace('/\n{3,}/', "\n\n", $content) ?? $content;
    return trim($content);
}

function field_text(array $data, string $key): string
{
    $value = $data[$key] ?? null;
    return is_string($value) || is_int($value) || is_float($value) ? plain_text((string)$value) : '';
}

function serialized_field(string $content, string $label): string
{
    $lines = preg_split('/\n+/', plain_text($content)) ?: [];
    foreach ($lines as $line) {
        if (preg_match('/^' . preg_quote($label, '/') . '\s*:\s*(.*)$/i', trim($line), $matches)) {
            return trim($matches[1]);
        }
    }
    return '';
}

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') respond(200, true, 'OK');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') respond(405, false, '只支持 POST 请求');
if (!filter_var(MAIL_TO, FILTER_VALIDATE_EMAIL)) respond(500, false, 'MAIL_TO 收件邮箱无效');

$data = request_data();
$action = is_string($data['action'] ?? null) ? $data['action'] : '';
$nonce = is_string($data['nonce'] ?? null) ? $data['nonce'] : '';

if ($action !== FORM_ACTION) respond(400, false, 'action 不正确');
if (!hash_equals(FORM_NONCE, $nonce)) respond(403, false, 'nonce 不正确');

$name = field_text($data, 'name');
$email = field_text($data, 'email');
$contactMessage = field_text($data, 'msg');
$shortMessage = field_text($data, 'message');
$serialized = field_text($data, 'dataSerialize');
$postId = field_text($data, 'post_id');
$replyTo = null;
$replyToName = '';

if ($postId === CONTACT_POST_ID) {
    if ($name === '') $name = serialized_field($serialized, 'Name');
    if ($email === '') $email = serialized_field($serialized, 'Email');
    if ($contactMessage === '') $contactMessage = serialized_field($serialized, 'Message');
    if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        respond(400, false, 'email 格式不正确');
    }
    $lines = [];
    if ($name !== '') $lines[] = 'Name: ' . $name;
    if ($email !== '') $lines[] = 'Email: ' . $email;
    if ($contactMessage !== '') $lines[] = 'Message: ' . $contactMessage;
    $message = $lines !== [] ? implode("\n\n", $lines) : $serialized;
    $replyTo = $email !== '' ? $email : null;
    $replyToName = $name;
} elseif ($postId === SHORT_MESSAGE_POST_ID) {
    if ($shortMessage === '') $shortMessage = serialized_field($serialized, 'Message');
    $message = $shortMessage !== '' ? 'Message: ' . $shortMessage : $serialized;
} else {
    respond(400, false, '不支持的 post_id');
}

if ($message === '') respond(400, false, '消息内容为空');

try {
    mail_send(MAIL_TO, MAIL_SUBJECT, $message, $replyTo, $replyToName);
} catch (Throwable $error) {
    respond(500, false, '邮件发送失败: ' . $error->getMessage());
}

respond(200, true, '邮件发送成功');
