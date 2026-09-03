<script setup lang="ts">
import { computed, onMounted, type Component } from 'vue'
import SideNav from './components/SideNav.vue'
import LogPanel from './components/LogPanel.vue'
import ConnectionStatus from './components/ConnectionStatus.vue'
import RemoteFilesPage from './pages/RemoteFilesPage.vue'
import PublishPage from './pages/PublishPage.vue'
import RecordsPage from './pages/RecordsPage.vue'
import ReplacementsPage from './pages/ReplacementsPage.vue'
import ProxyPage from './pages/ProxyPage.vue'
import SettingsPage from './pages/SettingsPage.vue'
import { useUiStore } from './stores/ui'
import type { PageName } from './stores/ui'
import { useConnectionStore } from './stores/connection'
import { useRemoteStore } from './stores/remote'

const ui = useUiStore()
const connection = useConnectionStore()
const remote = useRemoteStore()

const HEADS: Record<PageName, { eyebrow: string; title: string }> = {
  remote: {
    eyebrow: 'Remote Files',
    title: '远程文件'
  },
  publish: {
    eyebrow: 'Publish',
    title: '本地发布'
  },
  replacements: {
    eyebrow: 'Replacements',
    title: '替换规则'
  },
  records: {
    eyebrow: 'Records',
    title: '发布记录'
  },
  proxy: {
    eyebrow: 'Local Web',
    title: '本地代理'
  },
  settings: {
    eyebrow: 'Settings',
    title: '设置'
  }
}

const head = computed(() => HEADS[ui.currentPage])

const PAGES: Record<PageName, Component> = {
  remote: RemoteFilesPage,
  publish: PublishPage,
  records: RecordsPage,
  replacements: ReplacementsPage,
  proxy: ProxyPage,
  settings: SettingsPage
}

const page = computed(() => PAGES[ui.currentPage])

onMounted(async () => {
  await connection.loadConfig()
  // 启动后自动测试连接；成功则预加载远程文件列表（后续切换页面复用，不重复加载）
  if (connection.canTest) await connection.testConnection()
  if (connection.testState === 'success') remote.load('')
})
</script>

<template>
  <div class="app-shell">
    <SideNav />
    <main class="app-main">
      <div class="page-scroll">
        <header class="page-head">
          <div class="head-row">
            <div class="head-meta">
              <div class="page-eyebrow">{{ head.eyebrow }}</div>
              <h1 class="page-title">{{ head.title }}</h1>
            </div>
            <ConnectionStatus class="head-status" />
          </div>
        </header>
        <Transition name="page" mode="out-in">
          <component :is="page" :key="ui.currentPage" />
        </Transition>
      </div>
    </main>
    <LogPanel />
  </div>
</template>
