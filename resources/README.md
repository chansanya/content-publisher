# 构建资源

- 替换应用图标：放入 `icon.ico`（256x256 多尺寸），electron-builder 会自动使用。
- 未提供图标时使用 Electron 默认图标。

## 表单邮件接口

`plugins/wp-admin/admin-ajax.php` 是独立 PHP 接口，不依赖 WordPress，也不依赖固定 URL。上传后可任意命名，例如 `wp-admin/admin-ajax.php`、`aaa/bbb.php` 或 `api/send-mail.php`。

SMTP 私密配置放在 `plugins/wp-admin/mailer-config.php`。复制同目录的 `mailer-config.example.php` 后填写：

```php
return [
    'host' => 'smtp.qiye.aliyun.com',
    'port' => 465,
    'encryption' => 'ssl',
    'account' => '实际发件邮箱',
    'password' => 'SMTP 授权码',
    'timeout' => 20,
    'fromName' => 'Haveways 网站表单'
];
```

实际 `mailer-config.php` 已被 Git 忽略，但会随本地插件推送到远程。如果发件邮箱不是阿里云企业邮箱，应换成实际服务商提供的 SMTP 主机、端口与加密方式。

接口通过同目录的 `mailer.php` 使用 PHP cURL SMTP 发送，不依赖虚拟主机的 PHP `mail()` 配置；服务器必须启用 cURL 并允许外连 SMTP 端口。

接口仅接受 POST，支持 `application/x-www-form-urlencoded`、`multipart/form-data` 和 JSON。固定参数为：

```text
action=elementor_form_builder_form_ajax
nonce=3d3a6568da
```

接口通过 `post_id` 区分两类表单：`340` 为短消息并读取 `message`；`307` 为联系人表单并读取 `name`、`email`、`msg`，同时将联系人邮箱设置为邮件 `Reply-To`。两类格式都保留 `dataSerialize` 作为字段缺失时的兜底内容，HTML `<br>` 会转换为换行；其他 `post_id` 会被拒绝。如果目标站点已有 WordPress 原生 `wp-admin/admin-ajax.php`，请确认后再覆盖；该文件本身不依赖 WordPress。

## 插件同步

项目根目录的 `plugins/` 下每个一级子目录都是一个可推送插件，也可在应用「插件管理」页面新建。页面可为每个目录设置远程映射路径，例如 `plugins/wp-admin/a.php` → `FTP_REMOTE_ROOT/wp-admin/a.php`，`plugins/probe/probe.php` → `FTP_REMOTE_ROOT/plugins/probe/probe.php`。映射保存在应用数据的 `plugin-mappings.json` 中。插件推送不清空远程内容；「清空站点」和服务端 `deploy.php` 会保留已映射的插件路径。映射路径、其子项及祖先目录不能在远程文件页删除，只能在插件管理页删除远程插件目录。
