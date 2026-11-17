# 工程结构与数据目录

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

## 工程结构

```text
src/
├─ main/        主进程：env / ftp / artifact / server deploy / record / publish / proxy / plugin 服务
├─ preload/     contextBridge 白名单桥接（contextIsolation 开启，nodeIntegration 关闭）
├─ renderer/    Vue 3 + Pinia + Element Plus（连接 / 远程文件 / 发布 / 记录 / 代理页面 + 全局日志）
└─ shared/      跨进程类型、IPC 通道、常量
```

## 数据目录

```text
historical/
├─ index.json                # 记录索引（electron-store）
└─ artifacts/
   └─ <releaseId>/
      ├─ artifact.zip        # 不可变本地版本
      └─ manifest.json       # 文件清单（路径 / 大小 / 总量）
```

本地版本默认永久保留。异常退出后遗留的进行中任务会在下次启动时标记为 `interrupted`。
