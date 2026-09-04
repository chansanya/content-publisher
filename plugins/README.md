# 插件目录

每个一级子目录都是一个可单独推送的插件。可以在插件管理页新建目录；默认按目录同名映射，也可以修改远程路径。例如：

```text
plugins/
└─ wp-admin/
   └─ admin-ajax.php
```

在应用的「插件管理」页面点击推送后，文件会上传到配置的远程根目录下：

```text
远程根目录/wp-admin/admin-ajax.php
```

如果把 `wp-admin` 的映射改为 `/plugins/admin`，目标就会变成 `远程根目录/plugins/admin/admin-ajax.php`。映射保存在应用数据的 `plugin-mappings.json` 中。根目录下的说明文件不会被推送；插件目录内的文件会原样上传，同名远程文件会覆盖。

例如保持 `wp-admin` → `/wp-admin`，同时设置 `probe` → `/plugins/probe`，两个本地目录可以分别发布到不同的远程位置。

已设置映射的远程目录会在完整发布和远程清空时保留，远程文件页不能删除。插件管理页删除时，远程存在则只删除远程；再次删除或远程本就不存在时，会删除本地插件目录及映射。新增、删除或修改一级插件目录后，在本地发布页点击「同步运行文件」更新服务端保留清单。

## 表单邮件接口

`wp-admin/admin-ajax.php` 通过 `post_id` 区分表单：`340` 为短消息并读取 `message`；`307` 为联系人信息并读取 `name`、`email`、`msg`。两种格式共用 `action=elementor_form_builder_form_ajax` 和固定 `nonce`；`dataSerialize` 作为兜底内容。联系人邮箱会写入邮件 `Reply-To`，便于直接回复。

SMTP 私密配置位于同目录的 `mailer-config.php`。首次使用时复制 `mailer-config.example.php` 并填写账号与授权码；实际配置已被 Git 忽略，但会随本地插件推送到远程。
