import { PROGRESS_THROTTLE_MS, SPEED_WINDOW_MS } from '@shared/constants'
import type { UploadProgress } from '@shared/types'

/** 上传速度：5 秒滑动窗口内的字节速率 */
export class SpeedTracker {
  private samples: { t: number; total: number }[] = []

  push(t: number, total: number): void {
    this.samples.push({ t, total })
    while (this.samples.length > 2 && t - this.samples[0].t > SPEED_WINDOW_MS) {
      this.samples.shift()
    }
  }

  rate(): number {
    if (this.samples.length < 2) return 0
    const first = this.samples[0]
    const last = this.samples[this.samples.length - 1]
    const dt = (last.t - first.t) / 1000
    if (dt <= 0.2) return 0
    return Math.max(0, (last.total - first.total) / dt)
  }
}

export type ProgressSink = (progress: UploadProgress) => void

/**
 * 进度事件构造器：节流推送 + 数值单调（uploadedBytes / completedFiles / percentage 只升不降），
 * 仅在完整成功后允许出现 100%。
 */
export class ProgressTracker {
  private lastSentAt = 0
  private readonly speed = new SpeedTracker()
  private readonly files: { path: string; size: number }[]
  private readonly totalBytes: number
  private readonly totalFiles: number

  private uploadedBytes = 0
  private currentFileBytes = 0
  private currentFileTotalBytes = 0
  private currentFile = ''
  private completedFiles = 0

  constructor(
    private readonly releaseId: string,
    files: { path: string; size: number }[],
    private readonly sink: ProgressSink
  ) {
    this.files = files
    this.totalFiles = files.length
    this.totalBytes = files.reduce((sum, f) => sum + f.size, 0)
  }

  emitClearing(): void {
    const now = Date.now()
    this.lastSentAt = now
    this.sink(this.build('clearing', now))
  }

  onUploadStart(file: { path: string; size: number }): void {
    this.currentFile = file.path
    this.currentFileBytes = 0
    this.currentFileTotalBytes = file.size
    this.push(Date.now(), false)
  }

  onBytes(uploadedBytes: number, currentFileBytes: number): void {
    this.uploadedBytes = Math.max(this.uploadedBytes, uploadedBytes)
    this.currentFileBytes = Math.max(0, currentFileBytes)
    this.push(Date.now(), false)
  }

  onFileDone(): void {
    this.completedFiles = Math.min(this.totalFiles, this.completedFiles + 1)
    // 串行上传按清单顺序完成，按已完成文件累计字节，保证 uploadedBytes 单调且不依赖末次字节事件
    let doneBytes = 0
    for (let i = 0; i < this.completedFiles; i++) doneBytes += this.files[i].size
    this.uploadedBytes = Math.max(this.uploadedBytes, doneBytes)
    this.currentFileBytes = this.currentFileTotalBytes
    this.push(Date.now(), true)
  }

  emitSuccess(): void {
    this.uploadedBytes = this.totalBytes
    this.completedFiles = this.totalFiles
    this.currentFileBytes = this.currentFileTotalBytes
    const progress = this.build('uploading', Date.now())
    progress.percentage = 100
    progress.estimatedSeconds = 0
    this.sink(progress)
  }

  emitDeploying(): void {
    this.uploadedBytes = this.totalBytes
    this.completedFiles = this.totalFiles
    this.currentFileBytes = this.currentFileTotalBytes
    this.sink(this.build('deploying', Date.now()))
  }

  /** 失败时刻的已上传快照，用于失败记录 */
  snapshot(): { uploadedFiles: number; uploadedBytes: number } {
    return { uploadedFiles: this.completedFiles, uploadedBytes: this.uploadedBytes }
  }

  private build(phase: 'clearing' | 'uploading' | 'deploying', now: number): UploadProgress {
    const bytesPerSecond = this.speed.rate()
    const ratio = this.totalBytes > 0 ? this.uploadedBytes / this.totalBytes : 0
    // 未成功前最高 99.9，100% 只属于 emitSuccess
    const percentage = Math.min(99.9, ratio * 100)
    return {
      releaseId: this.releaseId,
      phase,
      currentFile: this.currentFile,
      currentFileBytes: this.currentFileBytes,
      currentFileTotalBytes: this.currentFileTotalBytes,
      uploadedBytes: this.uploadedBytes,
      totalBytes: this.totalBytes,
      completedFiles: this.completedFiles,
      totalFiles: this.totalFiles,
      percentage: this.totalFiles === 0 ? 0 : percentage,
      bytesPerSecond,
      estimatedSeconds:
        bytesPerSecond > 0 && this.uploadedBytes < this.totalBytes
          ? Math.ceil((this.totalBytes - this.uploadedBytes) / bytesPerSecond)
          : null
    }
  }

  private push(now: number, force: boolean): void {
    if (!force && now - this.lastSentAt < PROGRESS_THROTTLE_MS) return
    this.lastSentAt = now
    this.speed.push(now, this.uploadedBytes)
    this.sink(this.build('uploading', now))
  }
}
