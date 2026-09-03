<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { ArrowRight, FileCode2, FolderOpen, Plus, Replace, RotateCcw, Save, Trash2 } from 'lucide-vue-next'
import type { ReplacementConfig, ReplacementRule } from '@shared/types'
import { useLogsStore } from '@renderer/stores/logs'

interface FileRow {
  path: string
  from: string
  to: string
}

const logs = useLogsStore()
const loading = ref(true)
const saving = ref(false)
const dirty = ref(false)
const globalRows = ref<ReplacementRule[]>([])
const fileRows = ref<FileRow[]>([])

function markDirty(): void {
  dirty.value = true
}

function addGlobalRow(): void {
  globalRows.value.push({ from: '', to: '' })
  dirty.value = true
}

function addFileRow(): void {
  fileRows.value.push({ path: '', from: '', to: '' })
  dirty.value = true
}

function removeRow<T>(rows: T[], index: number): void {
  rows.splice(index, 1)
  dirty.value = true
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const res = await window.ftpApi.getReplacements()
    if (!res.ok) {
      ElMessage.error(res.error.message)
      return
    }
    globalRows.value = res.data ? res.data.global.map((rule) => ({ ...rule })) : []
    fileRows.value = res.data
      ? res.data.files.flatMap((file) => file.rules.map((rule) => ({ path: file.path, from: rule.from, to: rule.to })))
      : []
    dirty.value = false
  } finally {
    loading.value = false
  }
}

async function save(): Promise<void> {
  for (const [index, row] of globalRows.value.entries()) {
    if (!row.from.trim()) {
      ElMessage.warning(`全局规则第 ${index + 1} 条的查找内容不能为空`)
      return
    }
  }
  for (const [index, row] of fileRows.value.entries()) {
    if (!row.path.trim() || !row.from.trim()) {
      ElMessage.warning(`指定文件规则第 ${index + 1} 条的文件路径与查找内容不能为空`)
      return
    }
  }

  saving.value = true
  try {
    const grouped = new Map<string, ReplacementRule[]>()
    for (const row of fileRows.value) {
      const rel = row.path.trim().replace(/\\/g, '/')
      const rules = grouped.get(rel) ?? []
      rules.push({ from: row.from, to: row.to })
      grouped.set(rel, rules)
    }
    const config: ReplacementConfig = {
      global: globalRows.value
        .filter((row) => row.from.trim() !== '')
        .map((row) => ({ from: row.from, to: row.to })),
      files: [...grouped.entries()].map(([path, rules]) => ({ path, rules }))
    }
    const res = await window.ftpApi.saveReplacements(config)
    if (!res.ok) {
      ElMessage.error(res.error.message)
      return
    }
    ElMessage.success('替换规则已保存')
    logs.log('success', 'publish', `替换规则已更新 · 全局 ${config.global.length} 条 · 指定文件 ${config.files.length} 个`)
    dirty.value = false
  } finally {
    saving.value = false
  }
}

async function openRuleFile(): Promise<void> {
  const res = await window.ftpApi.openReplacementsFile()
  if (!res.ok) ElMessage.error(res.error.message)
}

onMounted(load)
</script>

<template>
  <div v-loading="loading">
    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="规则在发布准备阶段生效：解压 ZIP / 复制文件夹内容时，对文本文件执行替换后再打包上传"
      description="仅 html / css / js / php / json / svg 等文本类型生效，图片、字体等二进制文件原样保留。"
      style="margin-bottom: 18px"
    />

    <section class="fp-card">
      <div class="fp-card-title">
        <Replace :size="16" />
        全局替换规则
      </div>
      <p class="section-desc">对所有文本文件内容执行查找替换，例如把误打包的绝对域名替换为相对路径。</p>

      <div v-if="globalRows.length === 0" class="empty-hint">暂无全局规则，点击下方按钮新增</div>
      <div v-for="(row, index) in globalRows" :key="index" class="rule-row">
        <el-input v-model="row.from" placeholder="查找内容，如 https://xxxxx:111" @input="markDirty" />
        <ArrowRight :size="15" class="rule-arrow" />
        <el-input v-model="row.to" placeholder="替换为（留空即删除该段内容）" @input="markDirty" />
        <el-tooltip content="删除此规则" placement="top">
          <el-button text type="danger" @click="removeRow(globalRows, index)">
            <template #icon><Trash2 :size="15" /></template>
          </el-button>
        </el-tooltip>
      </div>
      <el-button size="small" class="add-btn" @click="addGlobalRow">
        <template #icon><Plus :size="14" /></template>
        新增全局规则
      </el-button>
    </section>

    <section class="fp-card">
      <div class="fp-card-title">
        <FileCode2 :size="16" />
        指定文件规则
      </div>
      <p class="section-desc">按发布根相对路径精确匹配文件，在全局规则之上叠加独立替换。</p>

      <div v-if="fileRows.length === 0" class="empty-hint">暂无指定文件规则</div>
      <div v-for="(row, index) in fileRows" :key="index" class="rule-row">
        <el-input v-model="row.path" class="rule-path" placeholder="文件相对路径，如 config.php" @input="markDirty" />
        <el-input v-model="row.from" placeholder="查找内容" @input="markDirty" />
        <ArrowRight :size="15" class="rule-arrow" />
        <el-input v-model="row.to" placeholder="替换为（可留空）" @input="markDirty" />
        <el-tooltip content="删除此规则" placement="top">
          <el-button text type="danger" @click="removeRow(fileRows, index)">
            <template #icon><Trash2 :size="15" /></template>
          </el-button>
        </el-tooltip>
      </div>
      <el-button size="small" class="add-btn" @click="addFileRow">
        <template #icon><Plus :size="14" /></template>
        新增指定文件规则
      </el-button>
    </section>

    <div class="save-bar">
      <div class="save-status">
        <span class="save-hint" :class="{ 'is-dirty': dirty }">{{ dirty ? '有未保存的修改' : '规则已与文件同步' }}</span>
        <el-tooltip content="打开规则文件所在目录（.env 同目录）" placement="top">
          <el-button size="small" text @click="openRuleFile">
            <template #icon><FolderOpen :size="15" /></template>
          </el-button>
        </el-tooltip>
      </div>
      <el-button :disabled="!dirty" @click="load">
        <template #icon><RotateCcw :size="15" /></template>
        放弃修改
      </el-button>
      <el-button type="primary" :loading="saving" :disabled="!dirty" @click="save">
        <template #icon><Save :size="15" /></template>
        保存规则
      </el-button>
    </div>
  </div>
</template>

<style scoped>
.section-desc {
  margin: 2px 0 14px;
  color: var(--fp-text-muted);
  font-size: 12.5px;
}

.rule-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}

.rule-row :deep(.el-input) {
  flex: 1;
  min-width: 0;
}

.rule-row :deep(.el-input.rule-path) {
  flex: 1.2;
}

.rule-arrow {
  flex-shrink: 0;
  color: var(--fp-text-faint);
}

.empty-hint {
  margin-bottom: 12px;
  padding: 14px;
  border: 1px dashed var(--fp-border);
  border-radius: 10px;
  color: var(--fp-text-faint);
  font-size: 12.5px;
  text-align: center;
}

.add-btn {
  margin-top: 4px;
}

.save-bar {
  position: sticky;
  bottom: 0;
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: flex-end;
  padding: 12px 0 4px;
  background: linear-gradient(to top, var(--fp-bg) 55%, transparent);
}

.save-status {
  display: flex;
  gap: 4px;
  align-items: center;
  margin-right: auto;
}

.save-hint {
  color: var(--fp-text-faint);
  font-size: 12.5px;
}

.save-hint.is-dirty {
  color: var(--fp-accent-2);
}
</style>
