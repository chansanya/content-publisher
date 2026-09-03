import Store from 'electron-store'
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import type { RequestListener, Server } from 'node:http'
import { networkInterfaces } from 'node:os'
import path from 'node:path'
import sirv from 'sirv'
import type { ApplyArtifactResult, ArtifactManifest, ProxySettings, ProxyStatus } from '@shared/types'
import { extractArtifact, makeTempDir, removeDir } from './artifactService'
import { ServiceError } from './errors'

const DEFAULT_PORT = 4173

export interface VerifiedArtifact {
  zipPath: string
  manifest: ArtifactManifest
}

export interface ProxySettingsStore {
  get(): ProxySettings
  set(settings: ProxySettings): void
}

export class ElectronProxySettingsStore implements ProxySettingsStore {
  private readonly store: Store<ProxySettings>

  constructor(settingsDir: string) {
    this.store = new Store<ProxySettings>({
      name: 'proxy-settings',
      cwd: settingsDir,
      defaults: { port: DEFAULT_PORT, spaFallback: false }
    })
  }

  get(): ProxySettings {
    return {
      port: this.store.get('port'),
      spaFallback: this.store.get('spaFallback'),
      lastAppliedArtifactId: this.store.get('lastAppliedArtifactId')
    }
  }

  set(settings: ProxySettings): void {
    this.store.set('port', settings.port)
    this.store.set('spaFallback', settings.spaFallback)
    if (settings.lastAppliedArtifactId) {
      this.store.set('lastAppliedArtifactId', settings.lastAppliedArtifactId)
    } else {
      this.store.delete('lastAppliedArtifactId')
    }
  }
}

export interface ProxyServiceDeps {
  rootDir: string
  settingsStore: ProxySettingsStore
  resolveArtifact: (artifactId: string) => VerifiedArtifact
  createServer?: (handler: RequestListener) => Server
}

export class ProxyService {
  private server: Server | null = null
  private busy = false

  constructor(private readonly deps: ProxyServiceDeps) {
    mkdirSync(deps.rootDir, { recursive: true })
  }

  get rootDir(): string {
    return this.deps.rootDir
  }

  getStatus(): ProxyStatus {
    const settings = this.deps.settingsStore.get()
    return {
      ...settings,
      running: this.server !== null,
      busy: this.busy,
      rootDir: this.deps.rootDir,
      bindHost: '0.0.0.0',
      urls: this.urls(settings.port)
    }
  }

  saveSettings(input: Pick<ProxySettings, 'port' | 'spaFallback'>): ProxyStatus {
    if (this.server || this.busy) {
      throw new ServiceError('PROXY_BUSY', '请先停止本地代理再修改设置')
    }
    if (!Number.isInteger(input.port) || input.port < 1024 || input.port > 65535) {
      throw new ServiceError('PROXY_PORT_INVALID', '代理端口必须是 1024-65535 的整数')
    }
    const current = this.deps.settingsStore.get()
    this.deps.settingsStore.set({ ...current, port: input.port, spaFallback: input.spaFallback })
    return this.getStatus()
  }

  async start(): Promise<ProxyStatus> {
    if (this.server) return this.getStatus()
    if (this.busy) throw new ServiceError('PROXY_BUSY', '本地代理正在处理其他操作')
    this.busy = true
    try {
      await this.startServer()
    } finally {
      this.busy = false
    }
    return this.getStatus()
  }

  async stop(): Promise<ProxyStatus> {
    if (!this.server) return this.getStatus()
    if (this.busy) throw new ServiceError('PROXY_BUSY', '本地代理正在处理其他操作')
    this.busy = true
    try {
      await this.stopServer()
    } finally {
      this.busy = false
    }
    return this.getStatus()
  }

  async applyArtifact(artifactId: string): Promise<ApplyArtifactResult> {
    if (this.busy) throw new ServiceError('PROXY_BUSY', '本地代理正在处理其他操作')
    this.busy = true
    const wasRunning = this.server !== null
    const tempDir = makeTempDir()
    let operationError: unknown
    let restartError: unknown

    try {
      const { zipPath, manifest } = this.deps.resolveArtifact(artifactId)
      extractArtifact(zipPath, manifest, tempDir)

      if (wasRunning) await this.stopServer()
      rmSync(this.deps.rootDir, { recursive: true, force: true })
      cpSync(this.resolveSiteRoot(tempDir), this.deps.rootDir, { recursive: true })

      const settings = this.deps.settingsStore.get()
      this.deps.settingsStore.set({ ...settings, lastAppliedArtifactId: artifactId })

      return {
        artifactId,
        totalFiles: manifest.totalFiles,
        rootDir: this.deps.rootDir,
        restarted: wasRunning
      }
    } catch (err) {
      operationError = err
      throw err
    } finally {
      removeDir(tempDir)
      if (wasRunning && !this.server) {
        try {
          await this.startServer()
        } catch (err) {
          restartError = err
        }
      }
      this.busy = false
      if (!operationError && restartError) throw restartError
    }
  }

  getPrimaryUrl(): string {
    return `http://localhost:${this.deps.settingsStore.get().port}`
  }

  getRootDir(): string {
    mkdirSync(this.deps.rootDir, { recursive: true })
    return this.deps.rootDir
  }

  dispose(): void {
    this.server?.close()
    this.server = null
  }

  private async startServer(): Promise<void> {
    mkdirSync(this.deps.rootDir, { recursive: true })
    const settings = this.deps.settingsStore.get()
    const serve = sirv(this.resolveSiteRoot(this.deps.rootDir), {
      dev: true,
      dotfiles: false,
      single: settings.spaFallback ? 'index.html' : false
    })
    const handler: RequestListener = (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.statusCode = 405
        res.setHeader('Allow', 'GET, HEAD')
        res.end('Method Not Allowed')
        return
      }
      serve(req, res, () => {
        res.statusCode = 404
        res.end('Not Found')
      })
    }
    const server = (this.deps.createServer ?? createServer)(handler)

    await new Promise<void>((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException): void => {
        server.off('error', onError)
        reject(
          new ServiceError(
            error.code === 'EADDRINUSE' ? 'PROXY_PORT_IN_USE' : 'PROXY_START_FAILED',
            error.code === 'EADDRINUSE' ? `端口 ${settings.port} 已被占用` : '本地代理启动失败',
            error.message
          )
        )
      }
      server.once('error', onError)
      server.listen(settings.port, '0.0.0.0', () => {
        server.off('error', onError)
        this.server = server
        resolve()
      })
    })
  }

  private async stopServer(): Promise<void> {
    const server = this.server
    if (!server) return
    this.server = null
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }

  private urls(port: number): string[] {
    const urls = [`http://localhost:${port}`]
    for (const addresses of Object.values(networkInterfaces())) {
      for (const address of addresses ?? []) {
        if (address.family === 'IPv4' && !address.internal) {
          urls.push(`http://${address.address}:${port}`)
        }
      }
    }
    return [...new Set(urls)]
  }

  private resolveSiteRoot(rootDir: string): string {
    if (existsSync(path.join(rootDir, 'index.html'))) return rootDir
    const entries = readdirSync(rootDir, { withFileTypes: true })
    if (entries.length !== 1 || !entries[0].isDirectory()) return rootDir
    const nestedRoot = path.join(rootDir, entries[0].name)
    return existsSync(path.join(nestedRoot, 'index.html')) ? nestedRoot : rootDir
  }
}
