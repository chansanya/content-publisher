import { defineConfig, type Plugin } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import { copyFileSync, existsSync } from 'node:fs'
import { isAbsolute } from 'node:path'

// 主进程构建为 CJS：所有裸模块（electron / basic-ftp / archiver 等）保持 external，
// 由 electron-builder 打包 node_modules；仅打包项目内源码。
const external = (id: string): boolean =>
  !id.startsWith('.') && !id.startsWith('@shared') && !id.startsWith('@main') && !isAbsolute(id)

// 把项目根 .env 收进包内作为出厂默认值（default.env），安装后首次启动若无 .env 则写出到 exe 同级
const seedDefaultEnv = (): Plugin => ({
  name: 'seed-default-env',
  closeBundle() {
    const source = fileURLToPath(new URL('./.env', import.meta.url))
    if (!existsSync(source)) {
      this.warn('项目根 .env 不存在，跳过 default.env 生成')
      return
    }
    copyFileSync(source, fileURLToPath(new URL('./dist/main/default.env', import.meta.url)))
  }
})

export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      '@main': fileURLToPath(new URL('./src/main', import.meta.url))
    }
  },
  build: {
    target: 'node18',
    lib: {
      entry: fileURLToPath(new URL('./src/main/index.ts', import.meta.url)),
      formats: ['cjs'],
      fileName: () => 'index.js'
    },
    outDir: 'dist/main',
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
    rollupOptions: { external }
  },
  plugins: [seedDefaultEnv()]
})
