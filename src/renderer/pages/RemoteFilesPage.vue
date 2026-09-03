<script setup lang="ts">
import { onMounted } from 'vue'
import { ElMessageBox } from 'element-plus'
import {
  ArrowUp,
  Download,
  File,
  FileSymlink,
  Folder,
  FolderTree,
  LoaderCircle,
  RefreshCw,
  Trash2,
  Upload
} from 'lucide-vue-next'
import type { RemoteEntry } from '@shared/types'
import { useConnectionStore } from '@renderer/stores/connection'
import { useRemoteStore } from '@renderer/stores/remote'
import { formatBytes, formatDateTime } from '@renderer/utils/format'

const remote = useRemoteStore()
const connection = useConnectionStore()

// 列表由启动连接成功后预加载；切回页面仅在尚无数据时兜底加载，否则保留当前目录状态
onMounted(() => {
  if (!remote.listing) remote.load('')
})

function iconOf(entry: RemoteEntry) {
  if (entry.type === 'directory') return Folder
  if (entry.type === 'link') return FileSymlink
  return File
}

async function confirmClearRoot(): Promise<void> {
  const root = connection.config?.remoteRoot ?? remote.listing?.remotePath ?? '--'
  try {
    await ElMessageBox.confirm(
      `将清空远程根目录「${root}」下的全部内容，仅保留 .ftppublisher 部署控制目录。该操作不进入回收站，无法恢复。`,
      '确认清空远程根目录',
      {
        type: 'warning',
        confirmButtonText: '清空全部内容',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger'
      }
    )
  } catch {
    return
  }
  await remote.clearRoot()
}

async function confirmDelete(entry: RemoteEntry): Promise<void> {
  const targetType = entry.type === 'directory' ? '目录及其中全部内容' : entry.type === 'link' ? '链接' : '文件'
  try {
    await ElMessageBox.confirm(
      `确定永久删除远程${targetType}「${entry.path}」？该操作不进入回收站，无法恢复。`,
      entry.type === 'directory' ? '确认递归删除目录' : '确认删除文件',
      {
        type: 'warning',
        confirmButtonText: '永久删除',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger'
      }
    )
  } catch {
    return
  }
  await remote.remove(entry)
}

async function confirmUpload(): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `文件将上传到「${remote.listing?.remotePath ?? '--'}」，同名远程文件会被直接覆盖。`,
      '上传文件到当前目录',
      {
        type: 'warning',
        confirmButtonText: '选择文件',
        cancelButtonText: '取消'
      }
    )
  } catch {
    return
  }
  await remote.uploadFiles()
}
</script>

<template>
  <div>
    <el-alert
      v-if="remote.error"
      type="error"
      :closable="false"
      show-icon
      :title="remote.error.message"
      :description="remote.error.detail"
      style="margin-bottom: 18px"
    />

    <section class="fp-card">
      <div class="fp-card-title">
        <FolderTree :size="16" />
        远程目录
        <span class="remote-path mono">{{ remote.listing?.remotePath ?? '--' }}</span>
        <span style="flex: 1" />
        <el-tooltip content="上传文件" placement="top">
          <el-button
            circle
            size="small"
            class="remote-toolbar-button"
            type="primary"
            aria-label="上传文件"
            :loading="remote.uploading"
            :disabled="remote.loading || remote.deletingPath !== null || remote.downloadingPath !== null"
            @click="confirmUpload()"
          >
            <Upload :size="15" />
          </el-button>
        </el-tooltip>
        <el-tooltip content="上一级" placement="top">
          <el-button
            circle
            size="small"
            class="remote-toolbar-button"
            aria-label="上一级"
            :disabled="!remote.canGoUp || remote.loading"
            @click="remote.goUp()"
          >
            <ArrowUp :size="15" />
          </el-button>
        </el-tooltip>
        <el-tooltip content="刷新" placement="top">
          <el-button
            circle
            size="small"
            class="remote-toolbar-button"
            aria-label="刷新"
            :disabled="remote.loading"
            @click="remote.load()"
          >
            <LoaderCircle v-if="remote.loading" :size="15" class="toolbar-spinner" />
            <RefreshCw v-else :size="15" />
          </el-button>
        </el-tooltip>
        <el-tooltip content="清空站点" placement="top">
          <el-button
            circle
            size="small"
            class="remote-toolbar-button"
            type="danger"
            plain
            aria-label="清空站点"
            :loading="remote.clearing"
            :disabled="remote.loading || remote.deletingPath !== null || remote.downloadingPath !== null || remote.uploading"
            @click="confirmClearRoot()"
          >
            <Trash2 :size="15" />
          </el-button>
        </el-tooltip>
      </div>

      <el-table
        v-loading="remote.loading"
        :data="remote.listing?.entries ?? []"
        size="small"
        row-key="path"
        @row-dblclick="remote.open"
      >
        <el-table-column label="名称" min-width="300">
          <template #default="{ row }">
            <button
              class="entry-name"
              :class="{ 'is-directory': row.type === 'directory' }"
              @click="remote.open(row)"
            >
              <component :is="iconOf(row)" :size="16" />
              <span>{{ row.name }}</span>
            </button>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="90">
          <template #default="{ row }">
            {{ row.type === 'directory' ? '目录' : row.type === 'link' ? '链接' : '文件' }}
          </template>
        </el-table-column>
        <el-table-column label="大小" width="120" align="right">
          <template #default="{ row }">{{ row.type === 'file' ? formatBytes(row.size) : '--' }}</template>
        </el-table-column>
        <el-table-column label="修改时间" width="180">
          <template #default="{ row }">{{ formatDateTime(row.modifiedAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="{ row }">
            <el-button
              text
              type="primary"
              size="small"
              :loading="remote.downloadingPath === row.path"
              :disabled="row.type === 'directory' || remote.downloadingPath !== null || remote.deletingPath !== null || remote.uploading"
              @click="remote.download(row)"
            >
              <template #icon><Download :size="14" /></template>
              下载
            </el-button>
            <el-button
              text
              type="danger"
              size="small"
              :loading="remote.deletingPath === row.path"
              :disabled="remote.deletingPath !== null || remote.downloadingPath !== null || remote.uploading"
              @click="confirmDelete(row)"
            >
              <template #icon><Trash2 :size="14" /></template>
              删除
            </el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="远程目录为空" :image-size="72" />
        </template>
      </el-table>
    </section>
  </div>
</template>

<style scoped>
.remote-path {
  margin-left: 6px;
  color: var(--fp-text-muted);
  font-size: 12px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entry-name {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  max-width: 100%;
  padding: 0;
  border: 0;
  background: none;
  color: var(--fp-text);
  font: inherit;
  cursor: default;
}

.entry-name.is-directory {
  color: var(--fp-accent-2);
  cursor: pointer;
}

.entry-name span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.remote-toolbar-button.el-button {
  border-color: transparent;
  background: transparent;
  box-shadow: none;
}

.remote-toolbar-button.el-button:hover:not(:disabled),
.remote-toolbar-button.el-button:focus-visible {
  border-color: transparent;
  background: transparent;
  box-shadow: none;
}

.remote-toolbar-button.el-button:active:not(:disabled) {
  border-color: transparent;
  background: transparent;
  box-shadow: none;
}
</style>
