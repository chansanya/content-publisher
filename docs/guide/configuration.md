# 配置说明

## .env 位置

开发环境读取项目根目录 `.env`；Windows 安装版、ZIP 解压版和 macOS 读取用户数据目录中的 `.env`；Windows 单文件便携版读取便携 exe 同级 `.env`。安装版与解压版共享用户数据目录。

## 字段

| 字段 | 说明 |
| --- | --- |
| `FTP_HOST` | FTP 主机 |
| `FTP_PORT` | FTP 端口，未填写默认 `21` |
| `FTP_USER` | FTP 用户名 |
| `FTP_PASSWORD` | FTP 密码 |
| `FTP_REMOTE_ROOT` | 固定远程发布目录 |
| `FTP_SECURE` | 仅明确为 `false` 时用普通 FTP，否则强制 FTPS |
| `FTP_TLS_REJECT_UNAUTHORIZED` | 自签名证书环境设为 `false` |
| `DEPLOY_ENDPOINT` | 部署接口地址（`.ftppublisher/deploy.php`） |
| `DEPLOY_TOKEN` | 部署接口密钥，至少 8 位 |
| `WEB_URL` | 真实站点 HTTP/HTTPS 地址（可选） |
| `CERT_DOMAIN` | 证书监控域名 |
| `ALIYUN_ACCESS_KEY_ID` | 阿里云 AccessKey ID |
| `ALIYUN_ACCESS_KEY_SECRET` | 阿里云 AccessKey Secret |

## 校验规则

- 必填字段（`FTP_HOST` / `FTP_USER` / `FTP_PASSWORD` / `FTP_REMOTE_ROOT`）不完整时，禁止测试连接与发布，界面列出缺失字段。
- `FTP_REMOTE_ROOT` 必须是安全的绝对路径（拒绝空、相对路径、`.`、`..`、`/`）。
- `DEPLOY_ENDPOINT` 必须指向网站公网可访问的 `.ftppublisher/deploy.php`。
- `DEPLOY_TOKEN` 至少 8 位；包含 `#` 时须用引号包裹，部署接口与桌面端必须使用相同密钥。
- 密码只读展示为 `***`，不写入日志、错误详情或发布记录。
