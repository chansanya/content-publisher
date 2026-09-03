# 内容发布工具

面向 Windows x64 的 Electron 桌面发布工具：通过 FTP 上传单个 ZIP，再由服务器端 PHP 本地解压发布，并支持基于本地历史 ZIP 的完整回滚。

同时提供局域网本地 Web 代理，可将固定 `.web` 目录作为静态站点，并把任意成功历史版本一键应用到该目录进行预览。

## 核心发布模型

```text
选择文件夹或 ZIP
→ 文件夹先复制快照，统一生成标准 ZIP 归档
→ FTP 上传单个 ZIP 与部署脚本
→ 调用受密钥保护的 PHP 接口
→ 服务器本地解压并替换站点内容
→ 保存发布结果
```

固定远程目录是独占部署槽位。服务端发布时保留 `.ftppublisher` 控制目录，其余内容会被目标 ZIP 完整替换。回滚复用历史 ZIP，走同一套服务器端解压流程。

## 环境要求

- Windows x64
- Node.js >= 18

## 快速开始

```bash
npm install          # 安装依赖
copy .env.example .env   # 按实际服务器填写
npm run dev          # 开发模式（构建主进程 + Vite 热更新 + Electron）
```

## 配置说明（.env）

开发环境读取项目根目录 `.env`；打包后读取可执行文件同级 `.env`（NSIS 安装版放在安装目录，解压 ZIP 版放在解压目录）。

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
PUBLISH_RECORD_DIR=./historical
```

规则：

- `FTP_SECURE` 只有明确设为 `false` 才使用普通 FTP，其余取值一律显式 FTPS，连接失败不会降级。
- 自签名证书环境可设 `FTP_TLS_REJECT_UNAUTHORIZED=false`。
- `FTP_PORT` 未填写默认 `21`。
- `.env` 缺失或必填字段（FTP_HOST / FTP_USER / FTP_PASSWORD / FTP_REMOTE_ROOT）不完整时，禁止测试连接与发布，界面列出缺失字段。
- 远程根路径必须是安全的绝对路径（拒绝空、相对路径、`.`、`..`、`/`）。
- `DEPLOY_ENDPOINT` 必须指向网站公网可访问的 `.ftppublisher/deploy.php`。
- `DEPLOY_TOKEN` 至少 8 位；包含 `#` 时必须用引号包裹。部署接口和桌面端必须使用相同密钥。
- 密码只读展示为 `***`，不会出现在日志、错误详情或发布记录中。

## 常用命令

```bash
npm run dev          # 开发调试
npm test             # 单元测试（Vitest，FTP 全部使用 mock）
npm run typecheck    # vue-tsc 类型检查
npm run build        # 构建 main / preload / renderer
npm run dist:win     # 打包 Windows x64 NSIS 安装包 + 解压 ZIP 版（输出 release/）
```

`dist:win` 的 Windows 输出包括：

- `内容发布工具-<version>-x64-setup.exe`：NSIS 安装版，可选择安装目录并创建桌面快捷方式。
- `内容发布工具-<version>-x64-unpacked.zip`：解压版。解压一次后直接运行目录中的 `内容发布工具.exe`，程序以该目录为工作目录，不会像 `portable.exe` 一样每次启动重新自解压。

应用图标来自 `resources/icon.svg`，由 electron-builder 在打包时处理。

## 使用流程

1. **连接状态**：确认脱敏配置无误后点击「测试连接」，需看到连接成功且能进入远程根目录。
2. **远程文件**：测试连接成功后导航中才会显示入口；进入目标目录后可上传多个本地文件，也可下载单个文件、删除文件或递归删除目录。上传同名文件会覆盖，远程根目录本身不可删除。
3. **本地发布**：支持选择文件夹或 ZIP。文件夹会先复制为本地快照并统一打包成 ZIP；ZIP 输入则完成路径安全校验和唯一顶级目录剥离。两者最终都只通过 FTP 上传一个 ZIP，再由 PHP 在服务器本地解压替换站点。
4. **发布记录**：成功记录可执行「回滚」；失败或中断记录点击「再次发布」后会跳转到本地发布页，以 ZIP 输入展示原归档和文件清单。确认执行后原地更新当前记录，不新增记录，也不重新扫描或压缩源文件。
5. **本地代理**：设置端口与 SPA 回退后手动启动；历史记录可点击「应用代理」，清空 `.web` 后解压目标版本，原历史 ZIP 保持不变。

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

## 工程结构

```text
src/
├─ main/        主进程：env / ftp / artifact / server deploy / record / publish / proxy 服务
├─ preload/     contextBridge 白名单桥接（contextIsolation 开启，nodeIntegration 关闭）
├─ renderer/    Vue 3 + Pinia + Element Plus（连接 / 远程文件 / 发布 / 记录 / 代理页面 + 全局日志）
└─ shared/      跨进程类型、IPC 通道、常量
tests/unit/     Vitest 单元测试
```

## 安全与 IPC

preload 仅暴露固定白名单通道。除原有 FTP/发布接口外，本地代理增加 `proxy:getStatus`、`proxy:saveSettings`、`proxy:start`、`proxy:stop`、`proxy:applyArtifact`、`proxy:openSite`、`proxy:openRoot`。所有请求统一返回 `ApiResult<T>`，渲染进程不能直接访问 HTTP Server、文件系统或历史归档路径。

服务端 `.ftppublisher/deploy.php` 仅接受 POST，并使用 `X-FtpPublisher-Token` 校验密钥。ZIP 会先解压到 staging，成功后才替换站点目录；部署脚本自身不会被清理。

## MVP 边界

不支持：增量同步、远程备份、自动故障恢复、断点续传、中途取消、`.tar.gz`、多 FTP 配置、界面编辑配置、CSV 导出。远程文件页的手工文件上传与本地完整版本发布相互独立。
