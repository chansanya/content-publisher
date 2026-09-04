import type { OperationLogEvent } from '@shared/types'
import type { PublishService } from '../services/publishService'
import type { ProxyService } from '../services/proxyService'
import { registerConfigHandlers } from './configHandlers'
import { registerFtpHandlers } from './ftpHandlers'
import { registerPublishHandlers } from './publishHandlers'
import { registerProxyHandlers } from './proxyHandlers'
import { registerReplacementHandlers } from './replacementHandlers'
import { registerPluginHandlers } from './pluginHandlers'
import type { PluginService } from '../services/pluginService'

export interface IpcLogDeps {
  sendLog: (event: OperationLogEvent) => void
}

export function registerIpc(
  publishService: PublishService,
  proxyService: ProxyService,
  pluginService: PluginService,
  deps: IpcLogDeps
): void {
  registerConfigHandlers()
  registerFtpHandlers({ ...deps, pluginService })
  registerPublishHandlers(publishService)
  registerProxyHandlers(proxyService)
  registerReplacementHandlers()
  registerPluginHandlers(pluginService)
}
