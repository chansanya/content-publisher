import Store from 'electron-store'
import { MAX_RECORDS } from '@shared/constants'
import type { PublishRecord } from '@shared/types'

export const ACTIVE_STATUSES = ['preparing', 'clearing', 'uploading', 'deploying'] as const

export interface RecordStore {
  list(): PublishRecord[]
  get(id: string): PublishRecord | undefined
  insert(record: PublishRecord): void
  update(record: PublishRecord): void
  delete(id: string): void
  /** 启动时把遗留的进行中任务标记为 interrupted，返回标记数量 */
  markInterrupted(): number
}

function sortDesc(records: PublishRecord[]): PublishRecord[] {
  return [...records].sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0))
}

/** electron-store 实现：索引 JSON 与 artifacts 同处 PUBLISH_RECORD_DIR */
export class ElectronStoreRecordStore implements RecordStore {
  private readonly store: Store<{ records: PublishRecord[] }>

  constructor(recordDir: string) {
    this.store = new Store<{ records: PublishRecord[] }>({
      name: 'index',
      cwd: recordDir,
      defaults: { records: [] }
    })
  }

  list(): PublishRecord[] {
    return sortDesc(this.store.get('records'))
  }

  get(id: string): PublishRecord | undefined {
    return this.store.get('records').find((r) => r.id === id)
  }

  insert(record: PublishRecord): void {
    const records = [record, ...this.store.get('records')]
    this.store.set('records', sortDesc(records).slice(0, MAX_RECORDS))
  }

  update(record: PublishRecord): void {
    const records = this.store.get('records').map((r) => (r.id === record.id ? record : r))
    this.store.set('records', records)
  }

  delete(id: string): void {
    const records = this.store.get('records').filter((r) => r.id !== id)
    this.store.set('records', records)
  }

  markInterrupted(): number {
    const records = this.store.get('records')
    let changed = 0
    const next = records.map((r) => {
      if ((ACTIVE_STATUSES as readonly string[]).includes(r.status)) {
        changed += 1
        return { ...r, status: 'interrupted' as const }
      }
      return r
    })
    if (changed > 0) this.store.set('records', next)
    return changed
  }
}

/** 测试用内存实现 */
export class MemoryRecordStore implements RecordStore {
  private records: PublishRecord[] = []

  list(): PublishRecord[] {
    return sortDesc(this.records)
  }

  get(id: string): PublishRecord | undefined {
    return this.records.find((r) => r.id === id)
  }

  insert(record: PublishRecord): void {
    this.records = sortDesc([record, ...this.records]).slice(0, MAX_RECORDS)
  }

  update(record: PublishRecord): void {
    this.records = this.records.map((r) => (r.id === record.id ? record : r))
  }

  delete(id: string): void {
    this.records = this.records.filter((r) => r.id !== id)
  }

  markInterrupted(): number {
    let changed = 0
    this.records = this.records.map((r) => {
      if ((ACTIVE_STATUSES as readonly string[]).includes(r.status)) {
        changed += 1
        return { ...r, status: 'interrupted' as const }
      }
      return r
    })
    return changed
  }
}
