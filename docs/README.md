---
home: true
title: 首页
heroText: 内容发布工具
tagline: 面向阿里云虚拟云主机的 Windows x64 发布与回滚工具，附带本地 Web 代理与证书申请、监控、部署能力
actions:
  - text: 快速开始
    link: /guide/
    type: primary
  - text: 配置说明
    link: /guide/configuration.html
    type: secondary
features:
  - title: FTP 一键发布
    details: 选择文件夹或 ZIP，统一归档后通过 FTP 上传单个 ZIP，由服务器端 PHP 本地解压完成发布。
  - title: 历史完整回滚
    details: 基于本地不可变历史 ZIP 走同一套服务器端解压流程，一键回滚到任意成功版本。
  - title: 本地 Web 预览
    details: 内置局域网 Web 代理，将 .web 目录作为静态站点，并可一键应用历史版本进行预览。
  - title: 证书申请与部署
    details: 支持阿里云 CAS 免费实例的申请、DNS 验证、状态刷新与云虚拟主机部署。
  - title: 插件独立同步
    details: 插件目录逐项映射到远程路径，同步运行文件而不清空站点、不生成发布记录。
  - title: 自动更新检查
    details: 启动时自动检查 GitHub Releases 最新稳定版，可手动检查，不自动下载或覆盖本地文件。
footer: MIT Licensed | Copyright © 2026
---
