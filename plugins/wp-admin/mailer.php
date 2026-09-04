<?php
declare(strict_types=1);

/* 私密 SMTP 配置放在同目录 mailer-config.php，不进入 Git。 */
$mailConfigFile = __DIR__ . '/mailer-config.php';
$mailConfig = is_file($mailConfigFile) ? require $mailConfigFile : [];
if (!is_array($mailConfig)) $mailConfig = [];

define('SMTP_HOST', (string)($mailConfig['host'] ?? 'smtp.qiye.aliyun.com'));
define('SMTP_PORT', (int)($mailConfig['port'] ?? 465));
define('SMTP_ENCRYPTION', (string)($mailConfig['encryption'] ?? 'ssl'));
define('SMTP_ACCOUNT', (string)($mailConfig['account'] ?? ''));
define('SMTP_PASSWORD', (string)($mailConfig['password'] ?? ''));
define('SMTP_TIMEOUT', (int)($mailConfig['timeout'] ?? 20));
define('MAIL_FROM_NAME', (string)($mailConfig['fromName'] ?? 'Haveways 网站表单'));

function encode_mail_header(string $value): string
{
    return '=?UTF-8?B?' . base64_encode($value) . '?=';
}

function mail_payload(string $to, string $subject, string $body, ?string $replyTo = null, string $replyToName = ''): string
{
    $fromDomain = substr(strrchr(SMTP_ACCOUNT, '@') ?: '@localhost', 1);
    $replyAddress = filter_var($replyTo, FILTER_VALIDATE_EMAIL) ? $replyTo : SMTP_ACCOUNT;
    $replyHeader = $replyToName !== ''
        ? encode_mail_header($replyToName) . ' <' . $replyAddress . '>'
        : $replyAddress;
    $headers = [
        'Date: ' . date(DATE_RFC2822),
        'Message-ID: <' . bin2hex(random_bytes(12)) . '@' . $fromDomain . '>',
        'From: ' . encode_mail_header(MAIL_FROM_NAME) . ' <' . SMTP_ACCOUNT . '>',
        'Reply-To: ' . $replyHeader,
        'To: <' . $to . '>',
        'Subject: ' . encode_mail_header($subject),
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64'
    ];
    return implode("\r\n", $headers)
        . "\r\n\r\n"
        . chunk_split(base64_encode($body), 76, "\r\n");
}

/**
 * 发送一封纯文本邮件，失败抛异常（由调用方决定如何呈现）。
 *
 * 用 cURL SMTP 发送：阿里云虚机禁用 stream_socket_client、且 PHP 层无 OpenSSL 做 TLS，
 * libcurl 自带 NSS 完成 TLS 并自行建立连接，绕开以上两个限制。
 * 邮件正文通过临时文件 + CURLOPT_INFILE 喂入，避免 CURLOPT_READFUNCTION 闭包在 cURL 7.29 的兼容问题。
 */
function mail_send(string $to, string $subject, string $body, ?string $replyTo = null, string $replyToName = ''): void
{
    if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
        throw new RuntimeException('收件邮箱无效: ' . $to);
    }
    if (!filter_var(SMTP_ACCOUNT, FILTER_VALIDATE_EMAIL)) {
        throw new RuntimeException('SMTP_ACCOUNT 发件邮箱无效');
    }
    if (SMTP_PASSWORD === '') {
        throw new RuntimeException('未配置 SMTP 授权码');
    }

    $encryption = strtolower(SMTP_ENCRYPTION);
    if (!in_array($encryption, ['ssl', 'tls', 'none'], true)) {
        throw new RuntimeException('SMTP_ENCRYPTION 只能是 ssl、tls 或 none');
    }
    if (!function_exists('curl_init')) {
        throw new RuntimeException('服务器未启用 cURL，无法发送邮件');
    }

    $scheme = $encryption === 'ssl' ? 'smtps' : 'smtp';
    $payload = mail_payload($to, $subject, $body, $replyTo, $replyToName);

    $tmp = tmpfile();
    if ($tmp === false) {
        throw new RuntimeException('无法创建临时文件');
    }
    fwrite($tmp, $payload);
    rewind($tmp);

    $curl = curl_init();
    if ($curl === false) {
        fclose($tmp);
        throw new RuntimeException('无法初始化 PHP cURL');
    }

    $options = [
        CURLOPT_URL => $scheme . '://' . SMTP_HOST . ':' . SMTP_PORT,
        CURLOPT_USERNAME => SMTP_ACCOUNT,
        CURLOPT_PASSWORD => SMTP_PASSWORD,
        CURLOPT_MAIL_FROM => '<' . SMTP_ACCOUNT . '>',
        CURLOPT_MAIL_RCPT => ['<' . $to . '>'],
        CURLOPT_UPLOAD => true,
        CURLOPT_INFILE => $tmp,
        CURLOPT_INFILESIZE => strlen($payload),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => SMTP_TIMEOUT,
        CURLOPT_TIMEOUT => SMTP_TIMEOUT,
        CURLOPT_USE_SSL => $encryption === 'none' ? CURLUSESSL_NONE : CURLUSESSL_ALL,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => 0
    ];

    try {
        if (!curl_setopt_array($curl, $options)) {
            throw new RuntimeException('无法设置 cURL SMTP 参数');
        }
        if (curl_exec($curl) === false) {
            throw new RuntimeException('cURL SMTP 发送失败: ' . curl_error($curl));
        }
    } finally {
        curl_close($curl);
        fclose($tmp);
    }
}
