<script setup lang="ts">
import { computed } from 'vue'
import { CircleCheck, Loader, Plug } from 'lucide-vue-next'
import { useConnectionStore } from '@renderer/stores/connection'

const connection = useConnectionStore()
const host = computed(() => connection.config?.host ?? '--')
</script>

<template>
  <div class="conn-status">
    <span class="conn-host" :title="host">{{ host }}</span>

    <div v-if="connection.testState === 'idle'" class="status-badge is-idle">
      <span class="dot" />
      未连接
    </div>
    <div v-else-if="connection.testState === 'testing'" class="status-badge is-testing is-live">
      <Loader :size="12" class="spin" />
      连接中
    </div>
    <div v-else-if="connection.testState === 'success'" class="status-badge is-ok is-live">
      <CircleCheck :size="13" />
      已连接
    </div>
    <div v-else class="status-badge is-bad">
      <span class="dot" />
      连接失败
    </div>

    <el-button
      type="primary"
      text
      :loading="connection.testState === 'testing'"
      :disabled="!connection.canTest"
      title="测试连接"
      @click="connection.testConnection()"
    >
      <template #icon>
        <Plug v-if="connection.testState !== 'testing'" :size="16" />
      </template>
    </el-button>
  </div>
</template>

<style scoped>
.conn-status {
  display: flex;
  align-items: center;
  gap: 12px;
}
.conn-host {
  font-family: var(--fp-mono);
  font-size: 13px;
  font-weight: 600;
  color: var(--fp-text);
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.is-idle { color: #8b98ab; border-color: rgba(148, 163, 184, 0.3); background: rgba(148, 163, 184, 0.07); }
.is-testing { color: #7dd3fc; border-color: rgba(125, 211, 252, 0.35); background: rgba(125, 211, 252, 0.08); }
.is-ok { color: #34d399; border-color: rgba(52, 211, 153, 0.35); background: rgba(52, 211, 153, 0.08); }
.is-bad { color: #f87171; border-color: rgba(248, 113, 113, 0.4); background: rgba(248, 113, 113, 0.08); }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
