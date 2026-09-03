/// <reference types="vite/client" />

import type { FtpApi } from '@preload/api'

declare global {
  interface Window {
    ftpApi: FtpApi
  }
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}

export {}
