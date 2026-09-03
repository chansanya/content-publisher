import { ref } from 'vue'
import { defineStore } from 'pinia'

export type PageName = 'remote' | 'publish' | 'replacements' | 'records' | 'proxy' | 'settings'

export const useUiStore = defineStore('ui', () => {
  const currentPage = ref<PageName>('publish')

  function go(page: PageName): void {
    currentPage.value = page
  }

  return { currentPage, go }
})
