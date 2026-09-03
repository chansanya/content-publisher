<script setup lang="ts">
import { computed } from 'vue'
import type { PublishStatus } from '@shared/types'

const props = defineProps<{ status: PublishStatus }>()

interface StatusMeta {
  label: string
  cls: string
  live?: boolean
}

const META: Record<PublishStatus, StatusMeta> = {
  preparing: { label: '准备中', cls: 'preparing', live: true },
  clearing: { label: '清理远程', cls: 'clearing', live: true },
  uploading: { label: '上传中', cls: 'uploading', live: true },
  deploying: { label: '服务器发布', cls: 'deploying', live: true },
  succeeded: { label: '成功', cls: 'succeeded' },
  failed: { label: '失败', cls: 'failed' },
  interrupted: { label: '已中断', cls: 'interrupted' }
}

const meta = computed(() => META[props.status])
</script>

<template>
  <span class="status-badge" :class="[`is-${meta.cls}`, meta.live ? 'is-live' : '']">
    <span class="dot" />
    {{ meta.label }}
  </span>
</template>

<style scoped>
.is-preparing { color: #7dd3fc; }
.is-clearing { color: #fbbf24; }
.is-uploading { color: #2dd4bf; }
.is-deploying { color: #38bdf8; }
.is-succeeded { color: #34d399;}
.is-failed { color: #f87171;}
.is-interrupted { color: #a78bfa;}
</style>
