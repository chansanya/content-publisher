<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { AlertTriangle, CheckCircle2, FolderOpen, FolderPlus, Link2, PackageOpen, RefreshCw, RotateCcw, Save, Trash2, UploadCloud } from 'lucide-vue-next'
import type { AppError, PluginProgress, PluginSummary } from '@shared/types'
import OperationLoadingOverlay from '@renderer/components/OperationLoadingOverlay.vue'
import { useConnectionStore } from '@renderer/stores/connection'
import { useLogsStore } from '@renderer/stores/logs'
import { useRemoteStore } from '@renderer/stores/remote'
import { formatBytes } from '@renderer/utils/format'

const connection = useConnectionStore()
const logs = useLogsStore()
const remote = useRemoteStore()
const plugins = ref<PluginSummary[]>([])
const rootDir = ref('')
const loading = ref(false)
const creating = ref(false)
const pushing = ref<string | null>(null)
const savingMapping = ref<string | null>(null)
const deleting = ref<string | null>(null)
const syncingRuntime = ref(false)
const error = ref<AppError | null>(null)
const progress = ref<PluginProgress | null>(null)
const mappingDrafts = ref<Record<string, string>>({})
const editingMapping = ref<string | null>(null)
const deletingTarget = ref('')
let unbindProgress: (() => void) | null = null

const remoteRoot = computed(() => connection.config?.remoteRoot ?? '(未配置)')
const progressPercent = computed(() => Math.min(100, Math.max(0, progress.value?.percentage ?? 0)))
const progressBytes = computed(() => {
  const current = progress.value
  return current ? `${formatBytes(current.uploadedBytes)} / ${formatBytes(current.totalBytes)}` : '--'
})
const hasDirtyMappings = computed(() => plugins.value.some((plugin) => mappingDrafts.value[plugin.name] !== plugin.remotePath))

function draftRemotePath(plugin: PluginSummary): string {
  const value = mappingDrafts.value[plugin.name] ?? plugin.remotePath
  return value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') || value
}

async function load(): Promise<void> {
  if (loading.value) return
  loading.value = true
  error.value = null
  try {
    const result = await window.ftpApi.listPlugins()
    if (!result.ok) {
      error.value = result.error
      logs.log('error', 'plugin', `插件目录读取失败: ${result.error.message}`)
      return
    }
    rootDir.value = result.data.rootDir
    plugins.value = result.data.plugins
    mappingDrafts.value = Object.fromEntries(result.data.plugins.map((plugin) => [plugin.name, plugin.remotePath]))
    editingMapping.value = null
  } finally {
    loading.value = false
  }
}

async function openRoot(): Promise<void> {
  const result = await window.ftpApi.openPluginRoot()
  if (!result.ok) ElMessage.error(result.error.message)
}

async function createPlugin(): Promise<void> {
  if (creating.value || syncingRuntime.value || pushing.value || savingMapping.value || deleting.value) return
  let name: string
  try {
    const result = await ElMessageBox.prompt(
      '将在本地 plugins/ 下创建一个一级插件目录，创建后可打开目录放入文件。',
      '新建插件',
      {
        confirmButtonText: '创建目录',
        cancelButtonText: '取消',
        inputPlaceholder: '例如 wp-admin 或 probe'
      }
    )
    name = result.value.trim()
  } catch {
    return
  }
  if (!name) {
    ElMessage.warning('插件名称不能为空')
    return
  }
  creating.value = true
  try {
    const result = await window.ftpApi.createPlugin(name)
    if (!result.ok) {
      error.value = result.error
      ElMessage.error(result.error.message)
      return
    }
    ElMessage.success(`已创建插件目录 ${result.data.name}`)
    logs.log('success', 'plugin', `已创建本地插件目录 ${result.data.localPath}`)
    await load()
  } finally {
    creating.value = false
  }
}

async function syncRuntime(): Promise<void> {
  if (syncingRuntime.value || pushing.value || savingMapping.value || deleting.value) return
  if (hasDirtyMappings.value) {
    ElMessage.warning('请先保存插件远程路径映射')
    return
  }
  syncingRuntime.value = true
  progress.value = null
  try {
    const result = await window.ftpApi.syncDeployRuntime()
    if (!result.ok) {
      ElMessage.error(result.error.message)
      logs.log('error', 'plugin', `运行文件同步失败: ${result.error.message}`)
      return
    }
    ElMessage.success('部署脚本与全部插件已同步，映射路径已保护')
    await load()
  } finally {
    syncingRuntime.value = false
  }
}

async function saveMapping(plugin: PluginSummary): Promise<void> {
  if (creating.value || savingMapping.value || pushing.value || deleting.value || syncingRuntime.value) return
  const remotePath = mappingDrafts.value[plugin.name] ?? plugin.remotePath
  if (!remotePath.trim()) {
    ElMessage.warning('远程路径不能为空')
    return
  }
  savingMapping.value = plugin.name
  try {
    const result = await window.ftpApi.savePluginMapping(plugin.name, remotePath)
    if (!result.ok) {
      error.value = result.error
      ElMessage.error(result.error.message)
      return
    }
    ElMessage.success(`已保存 ${plugin.name} 的远程路径映射`)
    logs.log('success', 'plugin', `插件 ${plugin.name} 映射到 ${result.data.remotePath}`)
    editingMapping.value = null
    if (remote.listing) await remote.load(remote.listing.relativePath)
    await load()
  } finally {
    savingMapping.value = null
  }
}

function editMapping(plugin: PluginSummary): void {
  if (creating.value || syncingRuntime.value || savingMapping.value || deleting.value) return
  editingMapping.value = plugin.name
}

function cancelMappingEdit(plugin: PluginSummary): void {
  mappingDrafts.value[plugin.name] = plugin.remotePath
  editingMapping.value = null
}

function resetMapping(plugin: PluginSummary): void {
  mappingDrafts.value[plugin.name] = plugin.name
}

async function push(plugin: PluginSummary): Promise<void> {
  if (creating.value || pushing.value || savingMapping.value || deleting.value || syncingRuntime.value) return
  if (mappingDrafts.value[plugin.name] !== plugin.remotePath) {
    ElMessage.warning('请先保存该插件的远程路径映射')
    return
  }
  try {
    await ElMessageBox.confirm(
      `将把本地插件「${plugin.name}」的 ${plugin.totalFiles} 个文件上传到「${remoteRoot.value}/${plugin.remotePath}」。只覆盖同名文件，不清空其他远程内容，也不生成发布记录。`,
      '确认推送插件',
      {
        type: 'warning',
        confirmButtonText: '推送到远程',
        cancelButtonText: '取消'
      }
    )
  } catch {
    return
  }

  pushing.value = plugin.name
  progress.value = null
  try {
    const result = await window.ftpApi.pushPlugin(plugin.name)
    if (!result.ok) {
      error.value = result.error
      ElMessage.error(result.error.message)
      logs.log('error', 'plugin', `插件 ${plugin.name} 推送失败: ${result.error.message}`)
      return
    }
    ElMessage.success(`插件 ${plugin.name} 已推送`)
    logs.log('success', 'plugin', `插件 ${plugin.name} 已推送到 ${result.data.remoteDirectory} · ${result.data.uploadedFiles} 个文件`)
    progress.value = null
    await load()
  } finally {
    pushing.value = null
  }
}

async function deleteRemote(plugin: PluginSummary): Promise<void> {
  if (creating.value || pushing.value || savingMapping.value || deleting.value || syncingRuntime.value) return
  if (mappingDrafts.value[plugin.name] !== plugin.remotePath) {
    ElMessage.warning('请先保存该插件的远程路径映射')
    return
  }
  try {
    await ElMessageBox.confirm(
      `将检查插件「${plugin.name}」：远程目录存在时只删除远程内容；如果远程目录已经不存在，则永久删除本地 plugins/${plugin.name} 及其映射。`,
      '确认删除插件',
      {
        type: 'warning',
        confirmButtonText: '执行删除',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger'
      }
    )
  } catch {
    return
  }
  deletingTarget.value = `${remoteRoot.value}/${plugin.remotePath}`
  deleting.value = plugin.name
  try {
    const result = await window.ftpApi.deletePlugin(plugin.name)
    if (!result.ok) {
      error.value = result.error
      ElMessage.error(result.error.message)
      logs.log('error', 'plugin', `插件 ${plugin.name} 远程删除失败: ${result.error.message}`)
      return
    }
    if (result.data.existed) {
      ElMessage.success(`已删除远程插件 ${plugin.name}，本地文件已保留`)
    } else if (result.data.localRemoved) {
      ElMessage.success(`远程目录不存在，已删除本地插件 ${plugin.name}`)
    } else {
      ElMessage.success(result.data.mappingRemoved ? '远程和本地均不存在，已清理插件映射' : '远程和本地插件均不存在')
    }
    logs.log('success', 'plugin', `插件 ${plugin.name} 删除完成 · 远程 ${result.data.existed ? '已删除' : '不存在'} · 本地 ${result.data.localRemoved ? '已删除' : '保留'}`)
    if (remote.listing) await remote.load(remote.listing.relativePath)
    await load()
  } finally {
    deleting.value = null
    deletingTarget.value = ''
  }
}

onMounted(() => {
  unbindProgress = window.ftpApi.onPluginProgress((value) => {
    if (pushing.value === value.pluginName || syncingRuntime.value) progress.value = value
  })
  void load()
})

onBeforeUnmount(() => {
  unbindProgress?.()
  unbindProgress = null
})
</script>

<template>
  <div>
    <OperationLoadingOverlay
      :visible="deleting !== null"
      title="正在删除插件"
      :name="deleting ?? ''"
      :target="deletingTarget"
      hint="远程目录不存在时将删除本地插件目录，请勿关闭程序"
    />

    <el-alert
      v-if="error"
      type="error"
      :closable="false"
      show-icon
      :title="error.message"
      :description="error.detail"
      style="margin-bottom: 18px"
    />

    <section class="fp-card">
      <div class="fp-card-title">
        <PackageOpen :size="16" />
        插件管理
      </div>
      <p class="section-desc">
        为 <span class="mono">plugins/</span> 下的一级子目录设置远程映射并上传，不参与完整版本发布，也不会清空站点。映射目录只能在本页推送或删除。
      </p>
      <div class="plugin-root-row">
        <div class="plugin-root-value">
          <span class="field-label">本地插件目录</span>
          <span class="mono">{{ rootDir || '--' }}</span>
        </div>
        <el-tooltip content="打开插件目录" placement="top">
          <el-button text aria-label="打开插件目录" :disabled="creating" @click="openRoot">
            <template #icon><FolderOpen :size="15" /></template>
          </el-button>
        </el-tooltip>
        <el-tooltip content="刷新插件列表" placement="top">
          <el-button text aria-label="刷新插件列表" :loading="loading" :disabled="creating || syncingRuntime || savingMapping !== null || deleting !== null" @click="load">
            <template #icon><RefreshCw :size="15" /></template>
          </el-button>
        </el-tooltip>
        <el-tooltip content="同步部署脚本、保护配置和全部插件" placement="top">
          <el-button text type="primary" aria-label="同步运行文件" :loading="syncingRuntime" :disabled="creating || loading || pushing !== null || savingMapping !== null || deleting !== null" @click="syncRuntime">
            <template #icon><UploadCloud :size="15" /></template>
          </el-button>
        </el-tooltip>
        <el-tooltip content="新建插件" placement="top">
          <el-button text type="primary" :loading="creating" :disabled="loading || syncingRuntime || pushing !== null || savingMapping !== null || deleting !== null" @click="createPlugin">
            <template #icon><FolderPlus :size="15" /></template>
          </el-button>
        </el-tooltip>

      </div>
      <div class="mapping-hint"><Link2 :size="13" />远程映射填写相对 FTP_REMOTE_ROOT 的路径，开头的 `/` 可省略；保存后该路径、子项及其祖先目录由插件管理器保护。</div>
    </section>

    <section class="fp-card">
      <div class="fp-card-title">
        <UploadCloud :size="16" />
        可推送插件
        <span class="plugin-target mono">目标：{{ remoteRoot }}</span>
      </div>
      <el-table v-loading="loading" :data="plugins" size="small" row-key="name">
        <el-table-column label="插件目录" width="100" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="plugin-name">
              <PackageOpen :size="15" />{{ row.name }}
              <el-tag v-if="!row.localExists" size="small" effect="plain" type="danger" title="映射仍受保护，可在本页删除远程目录或恢复同名映射">本地缺失</el-tag>
            </span>
          </template>
        </el-table-column>
        <el-table-column label="远程映射路径" min-width="270" align="center">
          <template #default="{ row }">
            <div class="mapping-cell">
              <el-input
                v-if="editingMapping === row.name"
                v-model="mappingDrafts[row.name]"
                class="mapping-input"
                size="small"
                autofocus
                placeholder="例如 /wp-admin"
                title="回车保存，Esc 取消"
                @keyup.enter="saveMapping(row)"
                @keyup.esc="cancelMappingEdit(row)"
              />
              <el-tooltip v-else content="点击修改远程映射" placement="top">
                <button type="button" class="mapping-value mono" @click="editMapping(row)">
                  /{{ draftRemotePath(row) }}
                </button>
              </el-tooltip>
              <el-tooltip content="恢复同名映射" placement="top">
                <el-button text size="small" aria-label="恢复同名映射" :disabled="creating || syncingRuntime || savingMapping !== null || deleting !== null" @click="resetMapping(row)">
                  <RotateCcw :size="13" />
                </el-button>
              </el-tooltip>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="目标路径" min-width="200"  align="center" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="mapping-target mono" :class="{ 'is-dirty': mappingDrafts[row.name] !== row.remotePath }">
              {{ remoteRoot }}/{{ draftRemotePath(row) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="文件数" width="90" align="center" >
          <template #default="{ row }">{{ row.totalFiles }}</template>
        </el-table-column>
        <el-table-column label="大小" width="90" align="center" >
          <template #default="{ row }">{{ formatBytes(row.totalBytes) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="150" align="center"  fixed="right">
          <template #default="{ row }">
            <el-tooltip content="保存远程路径映射" placement="top">
              <el-button
                text
                class="icon-only-button"
                type="primary"
                size="small"
                :loading="savingMapping === row.name"
                :disabled="creating || syncingRuntime || pushing !== null || savingMapping !== null || deleting !== null || mappingDrafts[row.name] === row.remotePath"
                aria-label="保存远程路径映射"
                @click="saveMapping(row)"
              >
                <template #icon><Save :size="14" /></template>
              </el-button>
            </el-tooltip>
            <el-tooltip :content="!row.localExists ? '本地插件目录不存在' : row.totalFiles === 0 ? '插件目录为空' : '推送插件'" placement="top">
              <el-button
                text
                class="icon-only-button"
                type="primary"
                size="small"
                :loading="pushing === row.name"
                :disabled="creating || syncingRuntime || !row.localExists || row.totalFiles === 0 || pushing !== null || savingMapping !== null || deleting !== null"
                aria-label="推送插件"
                @click="push(row)"
              >
                <UploadCloud :size="15" />
              </el-button>
            </el-tooltip>
            <el-tooltip content="删除插件" placement="top">
              <el-button
                text
                class="icon-only-button"
                type="danger"
                size="small"
                :disabled="creating || syncingRuntime || pushing !== null || savingMapping !== null || deleting !== null"
                aria-label="删除插件"
                @click="deleteRemote(row)"
              >
                <Trash2 :size="15" />
              </el-button>
            </el-tooltip>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="暂无插件，请将一级插件目录放入 plugins/ 下" :image-size="72" />
        </template>
      </el-table>
    </section>

    <section v-if="pushing || syncingRuntime" class="fp-card plugin-progress-card">
      <div class="fp-card-title">
        <UploadCloud :size="16" />
        正在{{ pushing ? '推送' : '同步' }} {{ pushing || progress?.pluginName || '插件' }}
      </div>
      <div class="fp-progress-track">
        <div class="fp-progress-fill" :style="{ width: `${progressPercent}%` }" />
      </div>
      <div class="progress-meta">
        <span>{{ progress?.currentFile || '准备连接 FTP...' }}</span>
        <span>{{ progress ? `${progressPercent.toFixed(1)}% · ${progressBytes}` : '准备中' }}</span>
      </div>
      <div v-if="progress" class="plugin-progress-foot">
        <span><CheckCircle2 :size="14" />{{ progress.completedFiles }} / {{ progress.totalFiles }} 个文件</span>
        <span><AlertTriangle :size="14" />同名远程文件将被覆盖</span>
      </div>
    </section>
  </div>
</template>

<style scoped>
.section-desc {
  margin: 2px 0 14px;
  color: var(--fp-text-muted);
  font-size: 12.5px;
  line-height: 1.7;
}

.plugin-root-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border: 1px solid var(--fp-border);
  border-radius: 10px;
  background: rgba(10, 14, 20, 0.45);
}

.plugin-root-value {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}

.plugin-root-value .field-label {
  margin: 0;
}

.plugin-root-value .mono {
  overflow: hidden;
  color: var(--fp-text);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plugin-target {
  margin-left: auto;
  overflow: hidden;
  color: var(--fp-text-muted);
  font-size: 11px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mapping-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  color: var(--fp-text-faint);
  font-size: 11.5px;
}

.plugin-name {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--fp-accent-2);
  font-family: var(--fp-mono);
  font-weight: 600;
}

.mapping-cell {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  justify-content: end;
}

.mapping-input,
.mapping-value {
  width: 150px;
  min-width: 150px;
  max-width: 150px;
}

.mapping-value {
  overflow: hidden;
  padding: 5px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--fp-text);
  font-size: 12px;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: text;
}

.mapping-value:hover,
.mapping-value:focus-visible {
  color: var(--fp-accent-2);
  background: rgba(56, 189, 248, 0.06);
  outline: none;
}

.mapping-target {
  min-width: 0;
  overflow: hidden;
  color: var(--fp-text-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mapping-target.is-dirty {
  color: var(--fp-accent-2);
}

.plugin-progress-card {
  border-color: rgba(45, 212, 191, 0.3);
}

.plugin-progress-foot {
  display: flex;
  gap: 18px;
  margin-top: 12px;
  color: var(--fp-text-muted);
  font-family: var(--fp-mono);
  font-size: 11px;
}

.plugin-progress-foot span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
</style>
