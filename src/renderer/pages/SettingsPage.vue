<script setup lang="ts">
import { computed } from 'vue'
import { ElMessageBox } from 'element-plus'
import {
  Copy,
  Database,
  FileCog,
  FolderOpen,
  FolderTree,
  KeyRound,
  Plug,
  RefreshCw,
  ScrollText,
  Server,
  ShieldCheck,
  User
} from 'lucide-vue-next'
import { useConnectionStore } from '@renderer/stores/connection'

const connection = useConnectionStore()
const config = computed(() => connection.config)

interface Row {
  icon: typeof Server
  label: string
  value: string
  copyable?: boolean
  openable?: 'recordDir' | 'logDir' | 'envFile'
}

const rows = computed<Row[]>(() => {
  if (!config.value) return []
  return [
    { icon: Server, label: '主机', value: config.value.host, copyable: true },
    { icon: Plug, label: '端口', value: String(config.value.port), copyable: true },
    { icon: User, label: '用户名', value: config.value.user, copyable: true },
    { icon: KeyRound, label: '密码', value: config.value.passwordMasked, copyable: true },
    { icon: FolderTree, label: '远程根目录', value: config.value.remoteRoot, copyable: true },
    { icon: Server, label: '部署接口', value: config.value.deployEndpoint || '未配置', copyable: Boolean(config.value.deployEndpoint) },
    { icon: KeyRound, label: '部署密钥', value: config.value.deployTokenConfigured ? '已配置' : '未配置' },
    {
      icon: ShieldCheck,
      label: '协议',
      value: `${config.value.secure ? '显式 FTPS' : '普通 FTP'}${config.value.secure ? (config.value.tlsRejectUnauthorized ? ' · 校验证书' : ' · 容忍自签名') : ''}`
    },
    { icon: Database, label: '发布记录目录', value: config.value.recordDir, openable: 'recordDir' },
    { icon: ScrollText, label: '本地日志', value: 'logs/fp-YYYY-MM-DD.log · 保留 14 天 · 含 debug 级别', openable: 'logDir' },
    { icon: FileCog, label: '配置文件', value: config.value.envPath, openable: 'envFile' }
  ]
})

function onCopy(row: Row): void {
  if (row.label === '密码') {
    connection.copyPassword()
  } else {
    connection.copyText(row.value, row.label)
  }
}

function onOpen(row: Row): void {
  if (row.openable === 'recordDir') connection.openRecordDir()
  else if (row.openable === 'logDir') connection.openLogDir()
  else if (row.openable === 'envFile') connection.openEnvFile()
}

async function confirmRestart(): Promise<void> {
  try {
    await ElMessageBox.confirm(
      '重启后软件会中断当前进行中的任务。确定重启吗？',
      '重启软件',
      {
        type: 'warning',
        confirmButtonText: '重启',
        cancelButtonText: '取消'
      }
    )
  } catch {
    return
  }
  await connection.restartApp()
}
</script>

<template>
  <div>
    <!-- 连接配置 -->
    <section class="fp-card">
      <div class="fp-card-title">
        <Server :size="16" />
        连接配置
      </div>

      <div v-if="config" class="field-grid">
        <div v-for="row in rows" :key="row.label" class="field-item" :style="{ gridColumn: '1 / -1' }">
          <div class="field-label">
            <component :is="row.icon" :size="12" />
            {{ row.label }}
            <span style="flex: 1" />
            <button v-if="row.copyable" class="field-action" @click="onCopy(row)">
              <Copy :size="12" />
            </button>
            <button v-else-if="row.openable" class="field-action" @click="onOpen(row)">
              <FolderOpen :size="12" />
            </button>
          </div>
          <div class="field-value">{{ row.value }}</div>
        </div>
      </div>
      <div v-else-if="connection.loaded" class="text-muted" style="font-size: 13px">
        配置不可用，请修正 .env 后重试。
      </div>
    </section>

    <!-- 重启 -->
    <section class="fp-card">
      <div style="display: flex; align-items: center; gap: 14px; flex-wrap: wrap;justify-content: end">
        <el-tooltip content="重启软件" placement="top">
          <el-button type="primary" circle class="icon-only-button" aria-label="重启软件" @click="confirmRestart">
            <RefreshCw :size="15" />
          </el-button>
        </el-tooltip>
      </div>
    </section>
  </div>
</template>

<style scoped>
.field-action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border: 1px solid var(--fp-border);
  border-radius: 6px;
  background: transparent;
  color: var(--fp-text-muted);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.18s ease;
}
.field-action:hover {
  color: var(--fp-accent);
  border-color: rgba(45, 212, 191, 0.5);
  background: rgba(45, 212, 191, 0.08);
}
</style>
