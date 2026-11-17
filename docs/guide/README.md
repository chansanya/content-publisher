# 快速开始

## 简介

内容发布工具是面向阿里云虚拟云主机应用发布的 Windows x64 Electron 工具，也可作为定向服务器的 FTP 工具：通过 FTP 上传单个 ZIP，由服务器端 PHP 本地解压发布，并支持基于本地历史 ZIP 的完整回滚。

## 环境要求

- Windows x64 / macOS（arm64 与 x64）
- Node.js >= 18

## 安装

```bash
npm install
copy .env.example .env
npm run dev
```

`.env` 按实际服务器填写，字段与校验规则见[配置说明](./configuration.md)。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 本地开发调试（构建主进程 + Vite 热更新 + Electron） |
| `npm run build` | 构建 main / preload / renderer |
| `npm run dist:win` | 打包 Windows x64 三件套（输出 release/） |
| `npm run dist:zip` | 仅打包 Windows x64 解压 ZIP 版 |
| `npm run release` | 手动触发 GitHub 全平台构建与发布 |
| `npm run release:watch` | 查看 GitHub Actions 构建状态 |

`dist:win` 的 Windows 输出包括安装版 setup.exe、解压版 zip、单文件便携版 portable.exe 三种形态。
