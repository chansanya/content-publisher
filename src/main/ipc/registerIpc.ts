import type { OperationLogEvent } from '@shared/types'
import type { PublishService } from '../services/publishService'
import type { ProxyService } from '../services/proxyService'
import { registerConfigHandlers } from './configHandlers'
import { registerFtpHandlers } from './ftpHandlers'
import { registerPublishHandlers } from './publishHandlers'
import { registerProxyHandlers } from './proxyHandlers'
import { registerReplacementHandlers } from './replacementHandlers'

export interface IpcLogDeps {
  sendLog: (event: OperationLogEvent) => void
}

export function registerIpc(publishService: PublishService, proxyService: ProxyService, deps: IpcLogDeps): void {
  registerConfigHandlers()
  registerFtpHandlers(deps)
  registerPublishHandlers(publishService)
  registerProxyHandlers(proxyService)
  registerReplacementHandlers()
}
