import path from 'node:path'
import { app } from 'electron'

/**
 * 应用文件及旧配置查找基准目录：
 * - 开发环境：项目根目录（app.getAppPath()）
 * - Windows 安装版：安装目录（exe 同级）
 * - Windows 便携版：electron-builder 通过 PORTABLE_EXECUTABLE_DIR 指向 portable exe 真实所在目录
 * - macOS：.app bundle 内只读，配置与数据（.env/logs/records/.web）放 userData
 */
export function resolveBaseDir(): string {
  if (!app.isPackaged) return app.getAppPath()
  if (process.platform === 'darwin') return app.getPath('userData')
  return process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath)
}

/**
 * 数据目录（.env/发布记录/日志/本地代理/替换规则）：
 * - 开发环境：项目根目录
 * - Windows 便携版：PORTABLE_EXECUTABLE_DIR，数据随 exe 走，不与其他版本共享
 * - 安装版/解压版/macOS：userData（共享，升级不丢）
 */
export function resolveDataDir(): string {
  if (!app.isPackaged) return app.getAppPath()
  if (process.platform === 'win32' && process.env.PORTABLE_EXECUTABLE_DIR) {
    return process.env.PORTABLE_EXECUTABLE_DIR
  }
  return app.getPath('userData')
}

/** 本地服务端部署脚本路径：打包后随 resources 分发 */
export function deployScriptPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'deploy.php')
    : path.join(resolveBaseDir(), 'resources', 'deploy.php')
}

/** 插件源目录：跟随数据目录（绿色版在 exe 同级，安装版/解压版/mac 在 userData，开发在项目根） */
export function pluginRootPath(dataDir = resolveDataDir()): string {
  return path.join(dataDir, 'plugins')
}
