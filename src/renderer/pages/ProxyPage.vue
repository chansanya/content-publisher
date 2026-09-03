<script setup lang="ts">
import { computed, onMounted } from 'vue'
import {
  CircleStop,
  ExternalLink,
  FolderOpen,
  Play,
  Replace,
  Save,
  ServerCog
} from 'lucide-vue-next'
import { useProxyStore } from '@renderer/stores/proxy'

const proxy = useProxyStore()

const running = computed(() => proxy.status?.running === true)
const settingsDisabled = computed(() => running.value || proxy.busy)

onMounted(() => proxy.load())
</script>

<template>
  <div>
    <el-alert
      v-if="proxy.error"
      type="error"
      :closable="false"
      show-icon
      :title="proxy.error.message"
      :description="proxy.error.detail"
      style="margin-bottom: 18px"
    />

    <section class="fp-card">
      <div class="fp-card-title">
        <ServerCog :size="16" />
        代理设置
        <span style="flex: 1" />
        <span class="status-badge" :class="running ? 'is-succeeded is-live' : 'is-interrupted'">
          <span class="dot" />
          {{ running ? '运行中' : '已停止' }}
        </span>
      </div>

      <div class="field-grid">
        <div class="field-item">
          <div class="field-label">监听地址</div>
          <div class="field-value">0.0.0.0</div>
        </div>
        <div class="field-item">
          <div class="field-label">端口</div>
          <el-input-number v-model="proxy.port" :min="1024" :max="65535" :disabled="settingsDisabled" controls-position="right" />
        </div>
        <div class="field-item">
          <div class="field-label">最近应用版本</div>
          <div class="field-value">{{ proxy.status?.lastAppliedArtifactId ?? '--' }}</div>
        </div>
        <div class="field-item">
          <div class="field-label">SPA 路由回退</div>
          <el-switch v-model="proxy.spaFallback" :disabled="settingsDisabled" active-text="开启" inactive-text="关闭" />
        </div>
      </div>

      <div class="running-actions">
        <el-tooltip content="应用替换规则到代理内容" placement="top">
          <el-button text :loading="proxy.applyingReplacements" :disabled="proxy.loading" @click="proxy.applyReplacements()">
            <template #icon><Replace :size="20" /></template>
          </el-button>
        </el-tooltip>
        <el-tooltip content="打开根目录" placement="top">
          <el-button text @click="proxy.openRoot()">
            <template #icon><FolderOpen :size="20" /></template>
          </el-button>
        </el-tooltip>
        <el-tooltip content="保存设置" placement="top">
          <el-button text :disabled="settingsDisabled" :loading="proxy.loading" @click="proxy.saveSettings()">
            <template #icon><Save :size="20" /></template>
          </el-button>
        </el-tooltip>
        <el-tooltip v-if="!running" content="启动代理" placement="top">
          <el-button text type="primary" :loading="proxy.loading" :disabled="proxy.busy" @click="proxy.start()">
            <template #icon><Play :size="20" /></template>
          </el-button>
        </el-tooltip>
        <el-tooltip v-else content="停止代理" placement="top">
          <el-button text type="danger" :loading="proxy.loading" :disabled="proxy.busy" @click="proxy.stop()">
            <template #icon><CircleStop :size="20" /></template>
          </el-button>
        </el-tooltip>
        <el-tooltip content="打开站点" placement="top">
          <el-button text type="primary" :disabled="!running" @click="proxy.openSite()">
            <template #icon><ExternalLink :size="20" /></template>
          </el-button>
        </el-tooltip>
      </div>
    </section>
  </div>
</template>

<style scoped>
.status-badge.is-succeeded {
  color: var(--fp-success);
  border-color: rgba(52, 211, 153, 0.35);
  background: rgba(52, 211, 153, 0.08);
}

.status-badge.is-interrupted {
  color: var(--fp-text-muted);
  border-color: var(--fp-border-strong);
  background: rgba(148, 163, 184, 0.07);
}

.running-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 15px;
}
</style>
