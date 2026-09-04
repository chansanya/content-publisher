import { ref } from 'vue'
import { defineStore } from 'pinia'

export type PageName = 'remote' | 'publish' | 'replacements' | 'records' | 'proxy' | 'plugins' | 'settings'

export const useUiStore = defineStore('ui', () => {
  const currentPage = ref<PageName>('publish')
  const appVersion = ref('')

  /** 从主进程读取 package.json 版本号，界面不硬编码 */
  async function loadVersion(): Promise<void> {
    const result = await window.ftpApi.getAppVersion()
    if (result.ok) appVersion.value = result.data
  }

  function go(page: PageName): void {
    currentPage.value = page
  }

  return { currentPage, appVersion, go, loadVersion }
})
