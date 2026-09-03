import type { AppError } from '@shared/types'

/** 服务层统一异常：携带可直接返回给渲染进程的 AppError */
export class ServiceError extends Error {
  readonly appError: AppError

  constructor(code: string, message: string, detail?: string) {
    super(message)
    this.name = 'ServiceError'
    this.appError = { code, message, detail }
  }
}

export function toAppError(err: unknown): AppError {
  if (err instanceof ServiceError) return err.appError
  if (err instanceof Error) return { code: 'INTERNAL_ERROR', message: err.message }
  return { code: 'INTERNAL_ERROR', message: String(err) }
}
