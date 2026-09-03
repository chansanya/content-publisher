// 开发编排：构建 main/preload → 启动 vite dev server → 拉起 Electron
import { spawn, spawnSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const shell = process.platform === 'win32'
const npm = shell ? 'npm.cmd' : 'npm'

function runSync(script) {
  const result = spawnSync(npm, ['run', script], { cwd: root, stdio: 'inherit', shell })
  if (result.status !== 0) {
    process.exitCode = 1
    process.exit(result.status ?? 1)
  }
}

runSync('build:main')
runSync('build:preload')

const devUrl = 'http://localhost:5173'
const renderer = spawn(npm, ['run', 'dev:renderer'], { cwd: root, stdio: 'inherit', shell })

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

const electron = spawn(npm, ['run', 'start:electron'], {
  cwd: root,
  stdio: 'inherit',
  shell,
  env: { ...process.env, VITE_DEV_SERVER_URL: devUrl }
})

electron.on('exit', (code) => {
  renderer.kill()
  process.exit(code ?? 0)
})
