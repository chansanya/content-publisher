<script setup lang="ts">
import { onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Eye, Globe2, History, LoaderCircle, RefreshCcw, RefreshCw, RotateCcw, Trash2 } from 'lucide-vue-next'
import type { PublishRecord } from '@shared/types'
import { useProgressStore } from '@renderer/stores/progress'
import { useRecordsStore } from '@renderer/stores/records'
import { isLastAppliedArtifact } from '@renderer/utils/proxyRecord'
import { useConnectionStore } from '@renderer/stores/connection'
import { useProxyStore } from '@renderer/stores/proxy'
import { usePublishStore } from '@renderer/stores/publish'
import { useUiStore } from '@renderer/stores/ui'
import StatusBadge from '@renderer/components/StatusBadge.vue'
import { formatBytes, formatDateTime, formatDuration } from '@renderer/utils/format'

const records = useRecordsStore()
const progress = useProgressStore()
const connection = useConnectionStore()
const proxy = useProxyStore()
const publish = usePublishStore()
const ui = useUiStore()

onMounted(() => {
  records.load()
  proxy.load()
})

async function confirmRollback(row: PublishRecord): Promise<void> {
  await connection.loadConfig()
  const remoteRoot = connection.config?.remoteRoot
  if (!remoteRoot) {
    ElMessage.error('当前 FTP 配置不可用，无法回滚')
    return
  }
  try {
    await ElMessageBox.confirm(
      `将上传历史 ZIP「${row.sourceName}」（${row.artifactId}），并由服务器解压替换 ${remoteRoot} 内的站点内容。操作不可恢复。`,
      '确认回滚',
      {
        type: 'warning',
        confirmButtonText: '清空并回滚',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger'
      }
    )
  } catch {
    return
  }
  await records.rollback(row.artifactId, row.sourceName)
}

async function rollbackFromDetail(): Promise<void> {
  if (records.detail) await confirmRollback(records.detail)
}

async function openRepublish(row: PublishRecord): Promise<void> {
  const loaded = await publish.loadRepublish(row.id)
  if (!loaded) return
  records.drawerOpen = false
  ui.go('publish')
}

async function confirmApplyToProxy(row: PublishRecord): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `将清空本地代理目录 ${proxy.status?.rootDir ?? '.web'} 并应用历史版本「${row.sourceName}」（${row.artifactId}）。历史 ZIP 会保留。`,
      '应用到本地代理',
      {
        type: 'warning',
        confirmButtonText: '清空并应用',
        cancelButtonText: '取消'
      }
    )
  } catch {
    return
  }
  await proxy.applyArtifact(row.artifactId, row.sourceName)
}

async function applyDetailToProxy(): Promise<void> {
  if (records.detail) await confirmApplyToProxy(records.detail)
}

async function confirmDelete(row: PublishRecord): Promise<void> {
  const hint =
    row.kind === 'publish'
      ? '该版本对应的本地归档（artifact.zip）若不再被其它记录引用，将一并删除。'
      : '仅删除该回滚记录，目标版本的归档不会被删除。'
  try {
    await ElMessageBox.confirm(
      `确定删除记录「${row.sourceName}」吗？删除后不可恢复。${hint}`,
      '删除发布记录',
      {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger'
      }
    )
  } catch {
    return
  }
  await records.remove(row.id)
}

async function deleteFromDetail(): Promise<void> {
  if (records.detail) await confirmDelete(records.detail)
}
</script>

<template>
  <div>
    <el-alert
      v-if="records.rollbackBusy"
      type="info"
      :closable="false"
      show-icon
      title="回滚执行中"
      style="margin-bottom: 18px"
    >
      <div class="fp-progress-track" style="margin-top: 6px">
        <div class="fp-progress-fill" :style="{ width: `${progress.displayPercentage}%` }" />
      </div>
      <div class="progress-meta mono" style="font-size: 11px">
        <span>{{ progress.latest?.currentFile || '清空 / 上传中' }}</span>
        <span>{{ progress.displayPercentage.toFixed(1) }}%</span>
      </div>
    </el-alert>

    <el-alert
      v-if="records.rollbackError"
      type="error"
      :closable="false"
      show-icon
      :title="`回滚失败: ${records.rollbackError.message}`"
      :description="records.rollbackError.detail"
      style="margin-bottom: 18px"
    />

    <section class="fp-card">
      <div class="fp-card-title">
        <History :size="16" />
        历史记录
        <span style="flex: 1" />
        <el-tooltip content="刷新" placement="top">
          <el-button
            circle
            size="small"
            class="icon-only-button"
            aria-label="刷新"
            :disabled="records.loading"
            @click="records.load()"
          >
            <LoaderCircle v-if="records.loading" :size="15" class="toolbar-spinner" />
            <RefreshCw v-else :size="15" />
          </el-button>
        </el-tooltip>
      </div>

      <el-table
        v-loading="records.loading"
        :data="records.records"
        size="small"
      >
        <el-table-column label="类型"  align="center" width="76">
          <template #default="{ row }">
            <el-tag size="small" :type="row.kind === 'rollback' ? 'warning' : 'info'" effect="plain">
              {{ row.kind === 'rollback' ? '回滚' : '发布' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态"  align="center" width="110">
          <template #default="{ row }">
            <StatusBadge :status="row.status" />
          </template>
        </el-table-column>
        <el-table-column label="开始时间"  align="center" width="165">
          <template #default="{ row }">{{ formatDateTime(row.startedAt) }}</template>
        </el-table-column>
        <el-table-column label="耗时" align="center" width="80">
          <template #default="{ row }">{{ row.durationMs != null ? formatDuration(row.durationMs) : '--' }}</template>
        </el-table-column>
        <el-table-column label="来源" min-width="170" align="center" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="mono">{{ row.sourceName }}</span>
            <el-tag
              v-if="isLastAppliedArtifact(row, proxy.status?.lastAppliedArtifactId)"
              size="small"
              type="success"
              effect="plain"
              style="margin-left: 8px"
            >
              最近应用
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="文件数" align="center" width="80">
          <template #default="{ row }">{{ row.totalFiles }}</template>
        </el-table-column>
        <el-table-column label="容量" align="center" width="100">
          <template #default="{ row }">{{ formatBytes(row.totalBytes) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="250" align="center" fixed="right">
          <template #default="{ row }">
            <el-tooltip content="详情" placement="top">
              <el-button size="small" text type="primary" @click="records.openDetail(row.id)">
                <template #icon><Eye :size="16" /></template>
              </el-button>
            </el-tooltip>
            <el-tooltip v-if="row.status === 'failed' || row.status === 'interrupted'" content="再次发布" placement="top">
              <el-button
                size="small"
                text
                type="warning"
                :loading="publish.loadingRepublishId === row.id"
                :disabled="records.rollbackBusy || publish.loadingRepublishId !== null"
                @click="openRepublish(row)"
              >
                <template #icon><RefreshCcw :size="16" /></template>
              </el-button>
            </el-tooltip>
            <el-tooltip content="回滚" placement="top">
              <el-button
                size="small"
                text
                type="danger"
                v-if="row.status == 'succeeded'"
                :disabled="row.status !== 'succeeded' || records.rollbackBusy || publish.loadingRepublishId !== null"
                @click="confirmRollback(row)"
              >
                <template #icon><RotateCcw :size="16" /></template>
              </el-button>
            </el-tooltip>
            <el-tooltip content="应用代理" placement="top">
              <el-button
                size="small"
                text
                type="success"
                :loading="proxy.applyingArtifactId === row.artifactId"
                :disabled="proxy.busy"
                @click="confirmApplyToProxy(row)"
              >
                <template #icon><Globe2 :size="16" /></template>
              </el-button>
            </el-tooltip>
            <el-tooltip content="删除" placement="top">
              <el-button size="small" text type="info" @click="confirmDelete(row)">
                <template #icon><Trash2 :size="16" /></template>
              </el-button>
            </el-tooltip>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="暂无发布记录" :image-size="72" />
        </template>
      </el-table>
    </section>

    <!-- 记录详情抽屉 -->
    <el-drawer v-model="records.drawerOpen" size="460px" title="记录详情" :with-header="true">
      <template v-if="records.detail">
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="记录 ID"><span class="mono">{{ records.detail.id }}</span></el-descriptions-item>
          <el-descriptions-item label="类型">{{ records.detail.kind === 'rollback' ? '回滚' : '发布' }}</el-descriptions-item>
          <el-descriptions-item label="状态"><StatusBadge :status="records.detail.status" /></el-descriptions-item>
          <el-descriptions-item label="版本 ID"><span class="mono">{{ records.detail.artifactId }}</span></el-descriptions-item>
          <el-descriptions-item v-if="records.detail.rollbackFromId" label="回滚目标">
            <span class="mono">{{ records.detail.rollbackFromId }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="来源"><span class="mono">{{ records.detail.sourceName }}</span>（{{ records.detail.sourceType === 'zip' ? 'ZIP' : '文件夹' }}）</el-descriptions-item>
          <el-descriptions-item label="远程根目录"><span class="mono">{{ records.detail.remoteRoot }}</span></el-descriptions-item>
          <el-descriptions-item label="开始时间">{{ formatDateTime(records.detail.startedAt) }}</el-descriptions-item>
          <el-descriptions-item label="结束时间">{{ formatDateTime(records.detail.finishedAt) }}</el-descriptions-item>
          <el-descriptions-item label="耗时">{{ records.detail.durationMs != null ? formatDuration(records.detail.durationMs) : '--' }}</el-descriptions-item>
          <el-descriptions-item label="文件数">{{ records.detail.uploadedFiles }} / {{ records.detail.totalFiles }}</el-descriptions-item>
          <el-descriptions-item label="容量">{{ formatBytes(records.detail.uploadedBytes) }} / {{ formatBytes(records.detail.totalBytes) }}</el-descriptions-item>
        </el-descriptions>

        <el-alert
          v-if="records.detail.error"
          type="error"
          :closable="false"
          show-icon
          :title="`[${records.detail.error.code}] ${records.detail.error.message}`"
          :description="records.detail.error.detail"
          style="margin-top: 14px"
        />

        <div style="margin-top: 18px; text-align: right">
          <el-button
            v-if="records.detail.status === 'failed' || records.detail.status === 'interrupted'"
            type="warning"
            :loading="publish.loadingRepublishId === records.detail.id"
            :disabled="records.rollbackBusy || publish.loadingRepublishId !== null"
            @click="openRepublish(records.detail)"
          >
            <template #icon><RefreshCcw :size="15" /></template>
            再次发布
          </el-button>
          <el-button
            v-if="records.detail.status === 'succeeded'"
            type="success"
            :loading="proxy.applyingArtifactId === records.detail.artifactId"
            :disabled="proxy.busy"
            @click="applyDetailToProxy()"
          >
            <template #icon><Globe2 :size="15" /></template>
            应用到本地代理
          </el-button>
          <el-button
            v-if="records.detail.status === 'succeeded'"
            type="danger"
            :loading="records.rollbackBusy"
            @click="rollbackFromDetail()"
          >
            <template #icon><RotateCcw :size="15" /></template>
            回滚到此版本
          </el-button>
          <el-button type="info" @click="deleteFromDetail()">
            <template #icon><Trash2 :size="15" /></template>
            删除记录
          </el-button>
        </div>
      </template>
    </el-drawer>
  </div>
</template>
