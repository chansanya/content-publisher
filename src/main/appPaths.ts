import path from 'node:path'
import { app } from 'electron'

/**
 * .env 查找基准目录：
 * - 开发环境：项目根目录（app.getAppPath()）
 * - NSIS 安装版：安装目录（exe 同级）
 * - 便携版：electron-builder 通过 PORTABLE_EXECUTABLE_DIR 指向 portable exe 真实所在目录
 */
export function resolveBaseDir(): string {
  if (!app.isPackaged) return app.getAppPath()
  return process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath)
}

/** 本地服务端部署脚本路径：打包后随 resources 分发 */
export function deployScriptPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'deploy.php')
    : path.join(resolveBaseDir(), 'resources', 'deploy.php')
}
