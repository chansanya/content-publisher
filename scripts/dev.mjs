// 开发编排：构建 main/preload → 启动 vite dev server → 拉起 Electron
import { spawn, spawnSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const viteCli = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')
const electron = require('electron')

function runVite(args) {
  const result = spawnSync(process.execPath, [viteCli, ...args], { cwd: root, stdio: 'inherit' })
  if (result.status !== 0) {
    process.exitCode = 1
    process.exit(result.status ?? 1)
  }
}

runVite(['build', '-c', 'vite.main.config.ts'])
runVite(['build', '-c', 'vite.preload.config.ts'])

const devUrl = 'http://localhost:5173'
const renderer = spawn(process.execPath, [viteCli], { cwd: root, stdio: 'inherit' })

async function waitFor(url, attempts = 90) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url)
      if (res.ok) return true
    } catch {
      // server not up yet
    }
    await delay(500)
  }
  return false
}

const up = await waitFor(devUrl)
if (!up) {
  console.error('[dev] Vite dev server failed to start')
  renderer.kill()
  process.exit(1)
}

const app = spawn(electron, ['.'], {
  cwd: root,
  // Electron 在 Windows 代码页 936 下直接继承控制台会把 UTF-8 中文输出成乱码。
  // 通过 Node 按 UTF-8 解码后转发，避免修改用户终端的全局代码页。
  stdio: ['inherit', 'pipe', 'pipe'],
  env: { ...process.env, VITE_DEV_SERVER_URL: devUrl }
})

app.stdout.setEncoding('utf8')
app.stderr.setEncoding('utf8')
app.stdout.on('data', (chunk) => process.stdout.write(chunk))
app.stderr.on('data', (chunk) => process.stderr.write(chunk))

app.on('exit', (code) => {
  renderer.kill()
  process.exit(code ?? 0)
})
