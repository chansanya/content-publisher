<script setup lang="ts">
import { computed, watch } from 'vue'
import { CloudUpload, FolderTree, Globe2, History, HardDriveUpload, Replace, Settings } from 'lucide-vue-next'
import { useUiStore } from '@renderer/stores/ui'
import { useConnectionStore } from '@renderer/stores/connection'
import type { PageName } from '@renderer/stores/ui'

const ui = useUiStore()
const connection = useConnectionStore()

const items: { key: PageName; label: string; icon: typeof CloudUpload; requiresConnection?: boolean }[] = [
  { key: 'publish', label: '本地发布', icon: CloudUpload },
  { key: 'replacements', label: '替换规则', icon: Replace },
  { key: 'remote', label: '远程文件', icon: FolderTree, requiresConnection: true },
  { key: 'records', label: '发布记录', icon: History },
  { key: 'proxy', label: '本地代理', icon: Globe2 }
]

const visibleItems = computed(() =>
  items.filter((item) => !item.requiresConnection || connection.testState === 'success')
)

watch(
  () => connection.testState,
  (state) => {
    if (state !== 'success' && ui.currentPage === 'remote') ui.go('publish')
  }
)
</script>

<template>
  <aside class="side-nav">
    <div class="nav-brand">
      <div class="brand-icon">
        <HardDriveUpload :size="20" :stroke-width="2.2" />
      </div>
      <div>
        <div class="brand-name">FtpPublisher</div>
        <div class="brand-sub">Fixed Root Deploy</div>
      </div>
    </div>

    <button
      v-for="item in visibleItems"
      :key="item.key"
      class="nav-item"
      :class="{ 'is-active': ui.currentPage === item.key }"
      @click="ui.go(item.key)"
    >
      <component :is="item.icon" :size="17" :stroke-width="2" />
      <span>{{ item.label }}</span>
    </button>

    <button
      class="nav-item"
      :class="{ 'is-active': ui.currentPage === 'settings' }"
      @click="ui.go('settings')"
    >
      <Settings :size="17" :stroke-width="2" />
      <span>设置</span>
    </button>

    <div class="nav-foot">v1.0.0 · win-x64</div>
  </aside>
</template>
