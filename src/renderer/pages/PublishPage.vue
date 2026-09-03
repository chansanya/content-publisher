<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  CircleCheck,
  CircleX,
  ChevronDown,
  CloudUpload,
  FileArchive,
  RefreshCw,
  FolderOpen,
  Globe2,
  History,
  LoaderCircle,
  RotateCcw,
  ServerCog,
  ShieldAlert,
  Trash2,
  TriangleAlert
} from 'lucide-vue-next'
import { useConnectionStore } from '@renderer/stores/connection'
import { useLogsStore } from '@renderer/stores/logs'
import { useProgressStore } from '@renderer/stores/progress'
import { usePublishStore } from '@renderer/stores/publish'
import { useUiStore } from '@renderer/stores/ui'
import StatTile from '@renderer/components/StatTile.vue'
import { formatBytes, formatEta } from '@renderer/utils/format'

const publish = usePublishStore()
const progressStore = useProgressStore()
const connection = useConnectionStore()
const logs = useLogsStore()
const ui = useUiStore()
const sourceCollapsed = ref(false)
const syncingRuntime = ref(false)
const cleaningIncoming = ref(false)

async function syncDeployRuntime(): Promise<void> {
  if (syncingRuntime.value) return
  syncingRuntime.value = true
  try {
    const result = await window.ftpApi.syncDeployRuntime()
    if (result.ok) {
      ElMessage.success('服务端部署脚本已更新')
      logs.log('success', 'publish', '已手动更新服务端部署脚本 deploy.php / config.php')
    } else {
      ElMessage.error(result.error.message)
      logs.log('error', 'publish', `部署脚本更新失败: ${result.error.message}`)
    }
  } finally {
    syncingRuntime.value = false
  }
}

async function cleanIncoming(): Promise<void> {
  if (cleaningIncoming.value) return
  cleaningIncoming.value = true
  try {
    const result = await window.ftpApi.cleanIncoming()
    if (result.ok) {
      ElMessage.success(result.data.removed > 0 ? `已清理 ${result.data.removed} 个残留条目` : 'incoming 无残留')
    } else {
      ElMessage.error(result.error.message)
      logs.log('error', 'publish', `清理 incoming 失败: ${result.error.message}`)
    }
  } finally {
    cleaningIncoming.value = false
  }
}

const remoteRoot = computed(() => connection.config?.remoteRoot ?? '(未配置)')
const syncStepText = computed(() => {
  for (let i = logs.entries.length - 1; i >= 0; i--) {
    const entry = logs.entries[i]
    if (entry.scope === 'publish') return entry.message
  }
  return '准备同步'
})
const scanningCopy = computed(() =>
  publish.scanning === 'directory'
    ? {
        title: '正在扫描文件夹',
        subtitle: '遍历目录、应用 .ftpignore 过滤并复制内容快照',
        hint: '文件较多时需要一些时间，请勿关闭程序'
      }
    : publish.scanning === 'proxy'
      ? {
          title: '正在扫描本地代理目录',
          subtitle: '读取 .web 当前内容生成发布清单，发布时原地压缩',
          hint: '扫描完成后直接进入压缩上传'
        }
      : {
          title: '正在解析 ZIP',
          subtitle: '读取压缩包目录、校验文件路径并生成内容预览',
          hint: '大文件解析需要一些时间，请勿关闭程序'
        }
)
const configReady = computed(() =>
  Boolean(connection.config?.deployEndpoint && connection.config.deployTokenConfigured)
)
const republishing = computed(() => publish.republishRecordId !== null)
const publishSteps = computed(() =>
  republishing.value ? ['校验历史 ZIP', '上传单个 ZIP', '服务器解压发布'] : ['准备本地 ZIP', '上传单个 ZIP', '服务器解压发布']
)

type DisplayPhase = 'idle' | 'preparing' | 'clearing' | 'uploading' | 'deploying' | 'succeeded' | 'failed'

const phase = computed<DisplayPhase>(() => {
  if (publish.result) return publish.result.status === 'succeeded' ? 'succeeded' : 'failed'
  if (!publish.executing) return 'idle'
  return (progressStore.latest?.phase ?? 'preparing') as DisplayPhase
})

const percentage = computed(() => {
  if (phase.value === 'succeeded') return 100
  if (phase.value === 'clearing') return 0
  return progressStore.displayPercentage
})

const latest = computed(() => progressStore.latest)

const currentFilePct = computed(() => {
  const p = latest.value
  if (!p || p.currentFileTotalBytes <= 0) return 0
  return Math.min(100, (p.currentFileBytes / p.currentFileTotalBytes) * 100)
})

const bytesText = computed(() => {
  const p = latest.value
  return `${formatBytes(p?.uploadedBytes ?? 0)} / ${formatBytes(p?.totalBytes ?? publish.summary?.totalBytes ?? 0)}`
})

const filesText = computed(() => {
  const p = latest.value
  return `${p?.completedFiles ?? 0} / ${p?.totalFiles ?? publish.summary?.totalFiles ?? 0}`
})

const speedText = computed(() => (phase.value === 'uploading' && latest.value ? `${formatBytes(latest.value.bytesPerSecond)}/s` : '--'))
const etaText = computed(() => (phase.value === 'uploading' && latest.value ? formatEta(latest.value.estimatedSeconds) : '--'))

const stepState = (index: 0 | 1 | 2): 'idle' | 'active' | 'done' | 'failed' => {
  const indexes: Record<DisplayPhase, number> = {
    idle: -1,
    preparing: 0,
    clearing: 1,
    uploading: 1,
    deploying: 2,
    succeeded: 3,
    failed: -1
  }
  const current = indexes[phase.value]
  if (phase.value === 'failed') {
    const failedAt = indexes[(progressStore.latest?.phase ?? 'preparing') as DisplayPhase]
    if (index < failedAt) return 'done'
    if (index === failedAt) return 'failed'
    return 'idle'
  }
  if (current < 0) return 'idle'
  if (index < current) return 'done'
  if (index === current) return phase.value === 'succeeded' ? 'done' : 'active'
  return 'idle'
}

async function confirmAndExecute(): Promise<void> {
  if (!publish.summary) return
  await connection.loadConfig()
  if (!connection.config) return
  try {
    await ElMessageBox.confirm(
      `即将上传${republishing.value ? '历史' : ''} ZIP，并由服务器解压替换 ${remoteRoot.value} 内的站点内容，共 ${publish.summary.totalFiles} 个文件（${formatBytes(publish.summary.totalBytes)}）。`,
      republishing.value ? '确认再次发布' : '确认服务端发布',
      {
        type: 'warning',
        confirmButtonText: republishing.value ? '再次发布' : '上传 ZIP 并发布',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger'
      }
    )
  } catch {
    return
  }
  await publish.execute()
}

/** 重新选择：有执行结果时确认防误触，未执行直接清除 */
async function requestClearSummary(): Promise<void> {
  if (!publish.result && !publish.runError) {
    publish.clearSummary()
    return
  }
  try {
    await ElMessageBox.confirm(
      '将清除当前发布来源与执行结果，返回来源选择界面。',
      '重新选择来源',
      { type: 'warning', confirmButtonText: '清除并重新选择', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  publish.clearSummary()
}
</script>

<template>
  <div>
    <Teleport to="body">
      <Transition name="zip-loading">
        <div v-if="publish.scanning !== null" class="zip-loading-overlay" role="status" aria-live="polite">
          <div class="zip-loading-panel">
            <div class="zip-loading-icon">
              <LoaderCircle :size="36" :stroke-width="1.8" class="zip-loading-spinner" />
            </div>
            <div class="zip-loading-title">{{ scanningCopy.title }}</div>
            <div class="zip-loading-subtitle">{{ scanningCopy.subtitle }}</div>
            <div class="zip-loading-track">
              <span />
            </div>
            <div class="zip-loading-hint">{{ scanningCopy.hint }}</div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <el-alert
      v-if="connection.config && !configReady"
      type="error"
      :closable="false"
      show-icon
      title="服务端 ZIP 发布配置不完整"
      description="请在 .env 中配置 DEPLOY_ENDPOINT 和至少 8 位的 DEPLOY_TOKEN，然后重启应用。"
      style="margin-bottom: 18px"
    />

    <!-- 部署脚本维护 -->
    <div v-if="connection.config" class="runtime-bar">
      <ServerCog :size="15" class="runtime-bar-icon" />
      <span class="runtime-bar-hint">
        <span v-if="syncingRuntime || cleaningIncoming" class="mono">{{ syncStepText }}</span>
        <template v-else>部署脚本维护</template>
      </span>
      <el-tooltip content="同步到服务器" placement="top">
        <el-button
          size="small"
          text
          type="primary"
          :loading="syncingRuntime"
          :disabled="!configReady || cleaningIncoming"
          @click="syncDeployRuntime"
        >
          <template #icon><RefreshCw :size="16" /></template>
        </el-button>
      </el-tooltip>
      <el-tooltip content="清理远程残留ZIP" placement="top">
        <el-button
          size="small"
          text
          type="warning"
          :loading="cleaningIncoming"
          :disabled="publish.executing || syncingRuntime"
          @click="cleanIncoming"
        >
          <template #icon><Trash2 :size="16" /></template>
        </el-button>
      </el-tooltip>
    </div>
    <!-- 一、来源选择与内容预览 -->
    <section class="fp-card">
      <button
        type="button"
        class="fp-card-title source-card-header"
        :class="{ 'is-collapsed': sourceCollapsed }"
        :aria-expanded="!sourceCollapsed"
        aria-controls="publish-source-content"
        @click="sourceCollapsed = !sourceCollapsed"
      >
        <FileArchive :size="16" />
        <span>选择完整发布版本</span>
        <span v-if="sourceCollapsed && publish.summary" class="source-card-summary mono">
          {{ publish.summary.sourceName }} · {{ publish.summary.totalFiles }} 个文件 · {{ formatBytes(publish.summary.totalBytes) }}
        </span>
        <span style="flex: 1" />
        <ChevronDown :size="16" class="source-card-chevron" />
      </button>

      <el-collapse-transition>
        <div id="publish-source-content" v-show="!sourceCollapsed" class="source-card-content">
          <div v-if="!publish.summary" style="display: flex; gap: 14px; flex-wrap: wrap">
            <button
              class="source-btn is-zip"
              :class="{
                'is-scanning': publish.scanning === 'zip',
                'is-muted': publish.scanning !== null && publish.scanning !== 'zip'
              }"
              :disabled="publish.scanning !== null"
              @click="publish.selectSource('zip')"
            >
              <FileArchive :size="26" style="color: var(--fp-accent-2); flex-shrink: 0" />
              <span class="source-copy">
                选择 ZIP
                <span class="hint">上传单个压缩包</span>
              </span>
              <span v-if="publish.scanning === 'zip'" class="scan-status">
                <LoaderCircle :size="14" class="scan-spinner" />
                正在解析
              </span>
            </button>
            <button
              class="source-btn"
              :class="{
                'is-scanning': publish.scanning === 'directory',
                'is-muted': publish.scanning !== null && publish.scanning !== 'directory'
              }"
              :disabled="publish.scanning !== null"
              @click="publish.selectSource('directory')"
            >
              <FolderOpen :size="26" style="color: var(--fp-accent); flex-shrink: 0" />
              <span class="source-copy">
                选择文件夹
                <span class="hint">自动打包为 ZIP 上传</span>
              </span>
              <span v-if="publish.scanning === 'directory'" class="scan-status">
                <LoaderCircle :size="14" class="scan-spinner" />
                正在扫描
              </span>
            </button>
            <button
              class="source-btn"
              :class="{
                'is-scanning': publish.scanning === 'proxy',
                'is-muted': publish.scanning !== null && publish.scanning !== 'proxy'
              }"
              :disabled="publish.scanning !== null"
              @click="publish.selectSource('proxy')"
            >
              <Globe2 :size="26" style="color: var(--fp-success); flex-shrink: 0" />
              <span class="source-copy">
                发布本地代理
                <span class="hint">压缩当前代理内容上传</span>
              </span>
              <span v-if="publish.scanning === 'proxy'" class="scan-status">
                <LoaderCircle :size="14" class="scan-spinner" />
                正在扫描
              </span>
            </button>
          </div>

          <template v-else>
            <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 12px">
              <FileArchive :size="18" style="color: var(--fp-accent-2)" />
              <span class="mono" style="font-size: 14px; font-weight: 700">{{ publish.summary.sourceName }}</span>
              <el-tag size="small" effect="plain">{{
                publish.summary.sourceType === 'zip' ? 'ZIP 输入' : publish.summary.sourceType === 'directory' ? '文件夹输入' : '本地代理'
              }}</el-tag>
              <el-tag v-if="republishing" size="small" effect="plain" type="warning">历史归档重发</el-tag>
              <el-tag size="small" effect="plain" type="info">{{ publish.summary.totalFiles }} 个文件</el-tag>
              <el-tag size="small" effect="plain" type="info">{{ formatBytes(publish.summary.totalBytes) }}</el-tag>
              <span style="flex: 1" />
              <el-button size="small" :disabled="publish.executing" @click="requestClearSummary">重新选择</el-button>
            </div>

            <el-alert
              v-if="publish.summary.strippedTopDir"
              type="info"
              :closable="false"
              show-icon
              :title="`已自动剥离唯一顶级目录 ${publish.summary.strippedTopDir}，远程根目录将直接呈现其内部内容`"
            />
          </template>
        </div>
      </el-collapse-transition>
    </section>

    <!-- 二、服务端发布确认 -->
    <section v-if="publish.summary && !publish.executing && !publish.result" class="fp-card">
      <div class="fp-card-title">
        <ShieldAlert :size="16" />
        服务端 ZIP 发布确认
      </div>

      <el-alert
        type="warning"
        :closable="false"
        show-icon
        title="ZIP 上传完成后，服务器将解压并替换远程根目录内容"
        style="margin-bottom: 14px"
      >
        <div class="mono" style="font-size: 12px; line-height: 1.8">
          目标目录: {{ remoteRoot }}<br />
          服务端会保留 .ftppublisher 控制目录，其余内容会被完整替换，操作不可恢复。
        </div>
      </el-alert>

      <div style="display: flex; align-items: center; gap: 14px; flex-wrap: wrap">
        <el-checkbox v-model="publish.confirmClear">
          我已知晓服务器将替换 {{ remoteRoot }} 内的站点内容
        </el-checkbox>
        <span style="flex: 1" />
        <el-button
          type="primary"
          size="large"
          :disabled="!publish.confirmClear || !configReady"
          @click="confirmAndExecute"
        >
          <template #icon><CloudUpload :size="16" /></template>
          {{ republishing ? '再次发布' : '上传 ZIP 并发布' }}
        </el-button>
      </div>
    </section>

    <!-- 三、执行状态与进度 -->
    <section v-if="publish.executing || publish.result" class="fp-card">
      <div class="fp-card-title">
        <CloudUpload :size="16" />
        发布执行
      </div>

      <div class="phase-steps" style="margin-bottom: 20px">
        <div
          v-for="(step, i) in publishSteps"
          :key="step"
          class="phase-step"
          :class="`is-${stepState(i as 0 | 1 | 2)}`"
        >
          <CircleCheck v-if="stepState(i as 0 | 1 | 2) === 'done'" :size="15" />
          <CircleX v-else-if="stepState(i as 0 | 1 | 2) === 'failed'" :size="15" />
          <span v-else class="dot" style="width: 6px; height: 6px; border-radius: 50%; background: currentColor" />
          {{ step }}
        </div>
      </div>

      <!-- 总进度 -->
      <div class="fp-progress-track">
        <div
          class="fp-progress-fill"
          :class="{ indeterminate: phase === 'clearing' || phase === 'preparing' || phase === 'deploying', 'is-success': phase === 'succeeded' }"
          :style="{ width: `${phase === 'clearing' || phase === 'preparing' ? 0 : percentage}%` }"
        />
      </div>
      <div class="progress-meta">
        <span>{{ phase === 'deploying' ? '服务器正在解压并替换站点...' : phase === 'clearing' ? '正在清空远程目录...' : phase === 'preparing' ? (republishing ? '正在校验历史 ZIP...' : '正在生成本地 ZIP...') : phase === 'succeeded' ? '发布完成' : 'ZIP 上传进度' }}</span>
        <span v-if="phase !== 'clearing' && phase !== 'preparing'">{{ percentage.toFixed(1) }}%</span>
      </div>

      <!-- 当前文件 -->
      <template v-if="phase === 'uploading' && latest">
        <div style="margin-top: 18px">
          <div class="field-label" style="margin-bottom: 6px">当前文件</div>
          <div class="field-value mono" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap">
            {{ latest.currentFile || '--' }}
          </div>
          <div class="fp-progress-track" style="height: 6px; margin-top: 8px">
            <div class="fp-progress-fill" :style="{ width: `${currentFilePct}%` }" />
          </div>
        </div>
      </template>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-top: 20px">
        <StatTile label="已上传字节" :value="bytesText" />
        <StatTile label="已完成文件" :value="filesText" />
        <StatTile label="实时速度" :value="speedText" />
        <StatTile label="预计剩余" :value="etaText" />
      </div>
    </section>

    <!-- 四、结果 -->
    <section v-if="publish.result?.status === 'succeeded'" class="fp-card" style="border-color: rgba(52, 211, 153, 0.4)">
      <div style="display: flex; align-items: center; gap: 14px; flex-wrap: wrap">
        <CircleCheck :size="30" style="color: var(--fp-success)" />
        <div>
          <div style="font-size: 16px; font-weight: 800">{{ republishing ? '再次发布成功' : '发布成功' }}</div>
          <div class="text-muted mono" style="font-size: 12.5px; margin-top: 3px">
            {{ publish.result.totalFiles }} 个文件 · {{ formatBytes(publish.result.totalBytes) }} · 耗时 {{ ((publish.result.durationMs ?? 0) / 1000).toFixed(1) }}s
          </div>
        </div>
        <span style="flex: 1" />
        <el-button @click="ui.go('records')">
          <template #icon><History :size="15" /></template>
          查看发布记录
        </el-button>
      </div>
    </section>

    <section v-else-if="publish.result?.status === 'failed' || publish.runError" class="fp-card" style="border-color: rgba(248, 113, 113, 0.45)">
      <div style="display: flex; gap: 14px; align-items: flex-start; flex-wrap: wrap">
        <CircleX :size="30" style="color: var(--fp-danger); flex-shrink: 0" />
        <div style="min-width: 0; flex: 1">
          <div style="font-size: 16px; font-weight: 800">{{ republishing ? '再次发布失败' : '发布失败' }}</div>
          <el-alert
            type="error"
            :closable="false"
            show-icon
            :title="publish.result?.error?.message ?? publish.runError ?? '未知错误'"
            :description="publish.result?.error?.detail"
            style="margin-top: 10px"
          />
          <el-alert type="warning" :closable="false" show-icon style="margin-top: 10px">
            <template #title>
              <span style="display: inline-flex; align-items: center; gap: 6px">
                <TriangleAlert :size="14" />
                远程目录可能处于不完整状态。请从发布记录中选择历史成功版本进行回滚。
              </span>
            </template>
          </el-alert>
        </div>
      </div>
      <div style="display: flex; gap: 10px; margin-top: 14px; justify-content: flex-end">
        <el-button @click="requestClearSummary">
          <template #icon><RotateCcw :size="15" /></template>
          重新选择来源
        </el-button>
        <el-button type="primary" @click="ui.go('records')">
          <template #icon><History :size="15" /></template>
          前往发布记录回滚
        </el-button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.runtime-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 10px 14px;
  margin-bottom: 18px;
  border: 1px solid var(--fp-border);
  border-radius: 12px;
  background: var(--fp-panel);
}

.runtime-bar-icon {
  flex-shrink: 0;
  color: var(--fp-accent-2);
}

.runtime-bar-hint {
  flex: 1;
  min-width: 240px;
  color: var(--fp-text-muted);
  font-size: 12.5px;
}

.source-card-header {
  width: 100%;
  padding: 0;
  border: 0;
  background: none;
  color: var(--fp-text);
  text-align: left;
  cursor: pointer;
  transition: margin-bottom 0.2s ease;
}

.source-card-header.is-collapsed {
  margin-bottom: 0;
}

.source-card-summary {
  min-width: 0;
  max-width: 58%;
  margin-left: 10px;
  overflow: hidden;
  color: var(--fp-text-muted);
  font-size: 11px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-card-chevron {
  flex-shrink: 0;
  color: var(--fp-text-faint);
  transition: transform 0.22s ease, color 0.22s ease;
}

.source-card-header:hover .source-card-chevron {
  color: var(--fp-accent-2);
}

.source-card-header:not(.is-collapsed) .source-card-chevron {
  transform: rotate(180deg);
}

.zip-loading-overlay {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(5, 9, 15, 0.78);
  backdrop-filter: blur(9px);
}

.zip-loading-panel {
  position: relative;
  width: min(420px, 100%);
  overflow: hidden;
  padding: 34px 36px 30px;
  border: 1px solid rgba(56, 189, 248, 0.24);
  border-radius: 20px;
  text-align: center;
  background:
    radial-gradient(circle at 50% 0, rgba(56, 189, 248, 0.12), transparent 52%),
    #101722;
  box-shadow: 0 30px 90px rgba(0, 0, 0, 0.48), inset 0 1px rgba(255, 255, 255, 0.025);
}

.zip-loading-icon {
  display: grid;
  place-items: center;
  width: 68px;
  height: 68px;
  margin: 0 auto 20px;
  border: 1px solid rgba(56, 189, 248, 0.24);
  border-radius: 20px;
  color: var(--fp-accent-2);
  background: rgba(56, 189, 248, 0.08);
  box-shadow: 0 0 36px rgba(56, 189, 248, 0.1);
}

.zip-loading-spinner {
  animation: zip-spin 0.9s linear infinite;
}

.zip-loading-title {
  color: var(--fp-text);
  font-size: 19px;
  font-weight: 800;
  letter-spacing: -0.01em;
}

.zip-loading-subtitle {
  margin-top: 9px;
  color: var(--fp-text-muted);
  font-size: 13px;
  line-height: 1.65;
}

.zip-loading-track {
  height: 4px;
  margin-top: 24px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.1);
}

.zip-loading-track span {
  display: block;
  width: 42%;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, transparent, var(--fp-accent-2), var(--fp-accent), transparent);
  animation: zip-track 1.35s ease-in-out infinite;
}

.zip-loading-hint {
  margin-top: 13px;
  color: var(--fp-text-faint);
  font-family: var(--fp-mono);
  font-size: 11px;
}

.zip-loading-enter-active,
.zip-loading-leave-active {
  transition: opacity 0.2s ease;
}

.zip-loading-enter-active .zip-loading-panel,
.zip-loading-leave-active .zip-loading-panel {
  transition: transform 0.24s ease, opacity 0.2s ease;
}

.zip-loading-enter-from,
.zip-loading-leave-to,
.zip-loading-enter-from .zip-loading-panel,
.zip-loading-leave-to .zip-loading-panel {
  opacity: 0;
}

.zip-loading-enter-from .zip-loading-panel,
.zip-loading-leave-to .zip-loading-panel {
  transform: translateY(10px) scale(0.98);
}

@keyframes zip-spin {
  to { transform: rotate(360deg); }
}

@keyframes zip-track {
  from { transform: translateX(-120%); }
  to { transform: translateX(340%); }
}
</style>
