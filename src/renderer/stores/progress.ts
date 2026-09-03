import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { UploadProgress } from '@shared/types'

/** 主进程节流推送的真实进度；显示百分比强制单调递增 */
export const useProgressStore = defineStore('progress', () => {
  const latest = ref<UploadProgress | null>(null)
  const active = ref(false)
  const displayPercentage = ref(0)

  function bind(): void {
    window.ftpApi.onProgress((progress) => {
      if (!active.value) return
      latest.value = progress
      displayPercentage.value = Math.max(displayPercentage.value, progress.percentage)
    })
  }

  function begin(): void {
    active.value = true
    latest.value = null
    displayPercentage.value = 0
  }

  function end(): void {
    active.value = false
  }

  return { latest, active, displayPercentage, bind, begin, end }
})
