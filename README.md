# 内容发布工具

面向阿里云虚拟云主机应用发布的 Windows x64 Electron 工具，也可作为定向服务器的 FTP 工具：通过 FTP 上传单个 ZIP，由服务器端 PHP 本地解压发布，并支持基于本地历史 ZIP 的完整回滚。

同时提供局域网本地 Web 代理，可将固定 `.web` 目录作为静态站点，并把任意成功历史版本一键应用到该目录进行预览。

程序启动时自动检查 GitHub Releases 的最新稳定版本，侧边栏版本号旁也可手动检查。发现更新后可前往下载页面选择安装版、解压版或便携版；程序不会自动下载或覆盖本地文件。检查失败不影响其他功能。

## 核心发布模型

```text
选择文件夹或 ZIP
→ 文件夹先复制快照，统一生成标准 ZIP 归档
→ FTP 上传单个 ZIP 与部署脚本
→ 调用受密钥保护的 PHP 接口
→ 服务器本地解压并替换站点内容
→ 保存发布结果
```

固定远程目录是独占部署槽位。服务端发布时保留 `.ftppublisher` 控制目录和已同步插件目录，其余内容会被目标 ZIP 完整替换。回滚复用历史 ZIP，走同一套服务器端解压流程。

`plugins/` 是独立插件目录。每个一级子目录可在「插件管理」页面单独同步到远程根目录，远程映射路径可逐项自定义，例如 `plugins/wp-admin/` → `远程根目录/wp-admin/`、`plugins/probe/` → `远程根目录/plugins/probe/`。映射保存在应用数据的 `plugin-mappings.json` 中。插件推送只覆盖同名文件，不清空站点、不生成发布记录；执行「同步运行文件」时会同时同步全部插件，并让完整发布/清空流程保留这些映射路径。

## 环境要求

- Windows x64 / macOS（arm64 与 x64）
- Node.js >= 18

## 快速开始

```bash
npm install          # 安装依赖
copy .env.example .env   # 按实际服务器填写
npm run dev          # 开发模式（构建主进程 + Vite 热更新 + Electron）
```

## 配置说明（.env）

开发环境读取项目根目录 `.env`；Windows 安装版、ZIP 解压版和 macOS 读取用户数据目录中的 `.env`；Windows 单文件便携版读取便携 exe 同级 `.env`。安装版和解压版共享用户数据目录。旧安装目录中的 `.env` 如仍存在，首次启动时复制迁移，不删除原文件，也不覆盖数据目录中的文件。

```dotenv
FTP_HOST=ftp.example.com
FTP_PORT=21
FTP_USER=username
FTP_PASSWORD=password
FTP_REMOTE_ROOT=/fixed/publish/path
FTP_SECURE=true
FTP_TLS_REJECT_UNAUTHORIZED=true
DEPLOY_ENDPOINT=https://www.example.com/.ftppublisher/deploy.php
DEPLOY_TOKEN="replace-with-random-token"
WEB_URL=https://www.example.com/
CERT_DOMAIN=example.com
ALIYUN_ACCESS_KEY_ID=
ALIYUN_ACCESS_KEY_SECRET=
```

规则：

- `FTP_SECURE` 只有明确设为 `false` 才使用普通 FTP，其余取值一律显式 FTPS，连接失败不会降级。
- 自签名证书环境可设 `FTP_TLS_REJECT_UNAUTHORIZED=false`。
- `FTP_PORT` 未填写默认 `21`。
- `.env` 缺失或必填字段（FTP_HOST / FTP_USER / FTP_PASSWORD / FTP_REMOTE_ROOT）不完整时，禁止测试连接与发布，界面列出缺失字段。
- 远程根路径必须是安全的绝对路径（拒绝空、相对路径、`.`、`..`、`/`）。
- `DEPLOY_ENDPOINT` 必须指向网站公网可访问的 `.ftppublisher/deploy.php`。
- `DEPLOY_TOKEN` 至少 8 位；包含 `#` 时必须用引号包裹。部署接口和桌面端必须使用相同密钥。
- `WEB_URL` 可选，填写真实站点的 HTTP/HTTPS 地址；连接成功后可从连接状态和发布成功结果直接打开。
- `CERT_DOMAIN`、`ALIYUN_ACCESS_KEY_ID`、`ALIYUN_ACCESS_KEY_SECRET` 用于证书监控和阿里云操作；证书页保存时也会写入 `.env`。旧版本保存的域名和可解密凭证，在相应字段不存在时迁移，显式配置的字段不会覆盖。
- 密码只读展示为 `***`，不会出现在日志、错误详情或发布记录中。

## 常用命令

```bash
npm run dev           # 本地开发调试
npm run build         # 构建 main / preload / renderer
npm run dist:win      # 打包 Windows x64 三件套（输出 release/）
npm run dist:zip      # 仅打包 Windows x64 解压 ZIP 版
npm run release       # 手动触发 GitHub 全平台构建与发布
npm run release:watch # 查看 GitHub Actions 构建状态
```

`dist:win` 的 Windows 输出包括：

- `ContentPublisher-<version>-x64-setup.exe`：NSIS 安装版，可选择安装目录并创建桌面快捷方式。
- `ContentPublisher-<version>-x64.zip`：解压版，解压后直接运行目录中的 `内容发布工具.exe`。
- `ContentPublisher-<version>-x64-portable.exe`：单文件便携版，自解压后运行，可拷贝到任意位置。

应用图标来自 `resources/icon.svg`，构建时转为 `icon.ico`（Windows）/ `icon.icns`（macOS）。

### 打包与 .env

安装包本身不直接携带 `.env`，只附带 [.env.example](.env.example) 模板。能否「开箱即用」取决于打包方式：

| 打包方式 | 是否带出厂配置 | 说明 |
|---|---|---|
| 本地 `npm run dist:win` / `dist:zip` | 取决于项目根目录 | 构建时若存在 `.env` 则作为 `default.env` 打进包内，首次启动按需复制到数据目录 |
| GitHub Actions 打包 | 可选 | 仅在配置 `BUILD_ENV` secret 时内置出厂配置，否则需手动放置 `.env` |

**手动放置 .env 的位置**（内容参考 [.env.example](.env.example)）：

- Windows 安装版和解压版：`%APPDATA%` 下的应用用户数据目录；具体路径可在软件「设置」中查看，或在配置缺失提示中查看。
- Windows 单文件便携版：portable exe 所在目录。
- macOS：`~/Library/Application Support/内容发布工具/`（应用首次启动会自动创建该目录，也可直接放一份 .env 进去）。

> ⚠️ **安全提示**：`.env` 明文包含 FTP 密码、部署密钥和阿里云 AccessKey Secret，分发时应通过可信渠道并控制接收范围。将真实 `.env` 打入安装包也会暴露凭据，不要用于公开发布。旧版安装目录可能在安装新版本前被清理，升级前务必手动备份旧 `.env`。

## 使用流程

1. **连接状态**：确认脱敏配置无误后点击「测试连接」，需看到连接成功且能进入远程根目录。
2. **远程文件**：测试连接成功后导航中才会显示入口；进入目标目录后可上传多个本地文件，也可下载单个文件、删除文件或递归删除目录。上传同名文件会覆盖，远程根目录本身不可删除。
3. **本地发布**：支持选择文件夹或 ZIP。文件夹会先复制为本地快照并统一打包成 ZIP；ZIP 输入则完成路径安全校验和唯一顶级目录剥离。两者最终都只通过 FTP 上传一个 ZIP，再由 PHP 在服务器本地解压替换站点。
4. **发布记录**：成功记录可执行「回滚」；失败或中断记录点击「再次发布」后会跳转到本地发布页，以 ZIP 输入展示原归档和文件清单。确认执行后原地更新当前记录，不新增记录，也不重新扫描或压缩源文件。
5. **本地代理**：设置端口与 SPA 回退后手动启动；历史记录可点击「应用代理」，清空 `.web` 后解压目标版本，原历史 ZIP 保持不变。
6. **插件管理**：连接成功后进入「插件管理」，可新建 `plugins/` 一级目录、为其设置远程映射路径并上传。映射路径、其子项及为其提供目录的祖先路径不能在远程文件页删除。插件页删除时，远程存在则只删除远程；远程已不存在则删除本地插件目录及映射。修改插件或映射后点击「同步运行文件」可连同 `deploy.php`、`config.php` 一起同步。

## 本地 Web 代理

- 开发环境固定使用当前项目目录下的 `.web`；打包后使用可执行文件同级 `.web`，实际路径在代理页面展示。
- 默认端口 `4173`，可在 `1024-65535` 范围内修改并持久化。
- 监听 `0.0.0.0`，页面同时展示 localhost 与有效局域网 IPv4 地址。
- 默认按普通静态网站处理；开启 SPA 回退后，未知地址返回 `index.html`。
- 仅支持 `GET` 和 `HEAD`，不提供 HTTPS、鉴权、反向代理、接口转发或目录列表。
- 代理不会随程序自动启动；程序退出时自动停止。
- 应用历史版本会清空 `.web` 内全部手工文件。代理若正在运行，会自动停服，替换完成后恢复运行。
- 如果 `.web` 根目录没有 `index.html`，但唯一子目录中存在 `index.html`，代理会自动将该子目录作为站点根目录；历史版本应用时也会自动剥离这一层。
- 局域网内其他设备可直接访问，请勿在 `.web` 放置密码、密钥等敏感文件。

## 证书申请、监控与部署

软件支持使用已领取的 V2 免费实例手动提交证书申请、查看 DNS 验证信息、主动刷新签发状态，以及部署已签发证书。申请提交后本地任务立即结束，不轮询等待验证或签发；软件不会新增、修改或删除 DNS 解析记录，也不查询旧版资源包额度。

“监控配置”页保留域名、每日检查时间、到期预警天数与本地监控开关。默认每天 07:00 检查，启动和电脑唤醒时补检；定时任务只读取网站 TLS 证书，不触发云端部署。旧版自动申请配置不再生效，原阈值仅迁移为预警天数。

使用方式：

1. 在软件中保存域名和阿里云凭证，进入“证书与部署”，点击“刷新证书”。免费实例仍须事先领取。
2. 对待申请实例点击“申请”并确认。程序配置 DNS 验证并提交一次申请，提交成功即结束本地任务，不等 CA 签发。
3. 点击“验证”查看阿里云返回的记录，可复制主机记录和记录值。如果阿里云已自动完成验证无需手动添加；否则请在实际 DNS 服务商配置记录。之后手动刷新证书状态。
4. 状态变为已签发后点击“部署”，勾选云虚拟主机资源并确认。程序等待部署任务完成，并逐个核对目标域名的线上证书序列号和有效期。已生效的证书不重复创建任务，证书有效期降级或目标变化会停止。

部署目前支持阿里云中国站 `webHosting` 云虚拟主机资源，若列表为空请先在控制台同步云产品资源。资源 ID、证书 ID 和域名会在主进程重新核对；可能消耗云产品部署次数，具体以控制台为准。

建议授予以下 CAS 动作；不需要阿里云 DNS 写权限：

```text
yundun-cert:ListInstances
yundun-cert:GetInstanceDetail
yundun-cert:GetCertificateDetail
yundun-cert:UpdateInstance
yundun-cert:ApplyCertificate
yundun-cert:ListCloudResources
yundun-cert:ListContact
yundun-cert:CreateDeploymentJob
yundun-cert:DescribeDeploymentJob
yundun-cert:UpdateDeploymentJobStatus
yundun-cert:DescribeDeploymentJobStatus
yundun-cert:ListWorkerResource
```

AccessKey 存放在 `.env`，Secret 为明文，不通过状态接口返回，也不写入日志；`.env` 已排除于 Git。旧版加密凭证可在本机解密且新字段均不存在时迁移，旧加密记录保留。证书列表和详情接口不获取私钥内容。

运行中的申请、验证信息读取或部署可点击进度卡片右侧“中止”，立即停止本地等待，不必等云端请求返回。已发出的请求不保证撤回：迟到的结果会保存，后续步骤停止，在途请求未结束时不允许新任务覆盖。申请配置和提交前分别持久化阶段；响应丢失或历史申请结果不明时锁定该实例，不自动重复提交。若经过确认实例确未提交，可在“验证”中解除本地待核对标记；解除前会再次读取云端状态并提示延迟风险。定时监控不会自动申请或部署。

不再接续时，点击概览右上角“结束任务”，确认后归档旧记录并解除本地锁定。历史记录保存在 `certificate-monitor.json` 的 `taskHistory`，不会撤销云端任务或退还额度。旧申请流程在升级启动后自动归档，不再阻塞新的部署，也不会取消已申请的证书。

## 数据目录

```text
historical/
├─ index.json                # 记录索引（electron-store）
└─ artifacts/
   └─ <releaseId>/
      ├─ artifact.zip        # 不可变本地版本
      └─ manifest.json       # 文件清单（路径 / 大小 / 总量）
```

本地版本默认永久保留，MVP 不做自动清理。异常退出后遗留的进行中任务会在下次启动时标记为 `interrupted`。

插件远程映射保存在 Electron `userData` 目录的 `plugin-mappings.json`，不随站点文件或发布记录清理。

## 工程结构

```text
src/
├─ main/        主进程：env / ftp / artifact / server deploy / record / publish / proxy / plugin 服务
├─ preload/     contextBridge 白名单桥接（contextIsolation 开启，nodeIntegration 关闭）
├─ renderer/    Vue 3 + Pinia + Element Plus（连接 / 远程文件 / 发布 / 记录 / 代理页面 + 全局日志）
└─ shared/      跨进程类型、IPC 通道、常量
```

`plugins/` 不随安装包分发，由插件管理页首次访问或新建插件时在可执行文件同级（开发环境为项目根）自动创建；已有插件目录在升级时原样保留，不会被安装包覆盖。插件目录可直接编辑，推送时按页面中保存的远程映射路径上传到 `FTP_REMOTE_ROOT`。

## 插件目录

```text
plugins/
└─ wp-admin/
   └─ admin-ajax.php
```

推送后对应远程路径为 `FTP_REMOTE_ROOT/wp-admin/admin-ajax.php`。插件目录属于独立运行文件，完整版本发布和远程清空时会保留；映射路径下的文件不能从远程文件页删除，需在插件管理页删除整个远程插件目录。移除本地插件目录并同步运行文件后，该映射会从保护清单移除，下一次发布或清空才会清理远程残留。

例如在插件管理页将 `probe` 映射为 `/plugins/probe`，则 `plugins/probe/probe.php` 会上传到 `FTP_REMOTE_ROOT/plugins/probe/probe.php`；映射路径必须是相对远程根目录的安全路径。
