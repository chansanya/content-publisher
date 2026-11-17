import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { build as buildVite, loadConfigFromFile } from 'vite'

const root = fileURLToPath(new URL('../', import.meta.url))
const temporary = await mkdtemp(path.join(tmpdir(), 'content-publisher-cert-test-'))
try {
  const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, path.join(root, 'vite.main.config.ts'))
  if (!loaded) throw new Error('Unable to load main-process Vite config')
  const runtimeBundle = path.join(temporary, 'cas-runtime-smoke.cjs')
  await buildVite({
    ...loaded.config,
    configFile: false,
    root,
    plugins: [],
    logLevel: 'error',
    build: {
      ...loaded.config.build,
      lib: {
        entry: path.join(root, 'src/main/services/aliyunCertificateService.ts'),
        formats: ['cjs'],
        fileName: () => 'cas-runtime-smoke.cjs'
      },
      outDir: temporary,
      emptyOutDir: false,
      sourcemap: false
    }
  })
  const output = path.join(temporary, 'certificate.test.cjs')
  await build({
    entryPoints: [path.join(root, 'tests/certificate.test.ts')],
    outfile: output,
    tsconfig: path.join(root, 'tsconfig.json'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    plugins: [{
      name: 'mock-certificate-storage',
      setup(builder) {
        builder.onResolve({ filter: /^(electron|electron-store)$/ }, args => ({ path: args.path, namespace: 'certificate-test' }))
        builder.onLoad({ filter: /.*/, namespace: 'certificate-test' }, args => ({
          contents: args.path === 'electron'
            ? "export const safeStorage = { isEncryptionAvailable: () => true, decryptString: value => value.toString() }"
            : "export default class Store { constructor(options) { this.data = { ...options.defaults, ...globalThis.__certificateStoreFixture } } get(key) { return this.data[key] } set(key, value) { if (typeof key === 'object') Object.assign(this.data, key); else this.data[key] = value } delete(key) { delete this.data[key] } }",
          loader: 'js'
        }))
      }
    }]
  })
  const uiOutput = path.join(temporary, 'certificate-ui.test.cjs')
  await build({
    entryPoints: [path.join(root, 'tests/certificate-ui.test.ts')],
    outfile: uiOutput,
    tsconfig: path.join(root, 'tsconfig.json'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    plugins: [{
      name: 'mock-ui-messages',
      setup(builder) {
        builder.onResolve({ filter: /^element-plus$/ }, () => ({ path: 'messages', namespace: 'mock-ui' }))
        builder.onLoad({ filter: /.*/, namespace: 'mock-ui' }, () => ({ contents: 'export const ElMessage = { error() {}, success() {} }', loader: 'js' }))
      }
    }]
  })
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--test', output, uiOutput], {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, NODE_PATH: path.join(root, 'node_modules'), CERTIFICATE_RUNTIME_BUNDLE: runtimeBundle }
    })
    child.once('error', reject)
    child.once('exit', (status) => resolve(status ?? 1))
  })
  process.exitCode = code
} finally {
  await rm(temporary, { recursive: true, force: true })
}
