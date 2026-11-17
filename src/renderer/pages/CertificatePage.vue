<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  BadgeCheck,
  CalendarClock,
  CloudUpload,
  Copy,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  Save,
  ShieldCheck,
  Square,
  Trash2,
  X
} from 'lucide-vue-next'
import type { CertificateApplicationDetail, CertificateAutomationState, CertificateMonitorSettings, CertificateInstanceSummary } from '@shared/types'
import { useCertificateStore } from '@renderer/stores/certificate'
import { formatDateTime } from '@renderer/utils/format'
import { certificateConfirmation, certificateInstanceAction, defaultCertificateTargets, deployedCertificateDomains, visibleCertificateInstances } from '@renderer/utils/certificateDeployment'

const certificate = useCertificateStore()
const settings = reactive<CertificateMonitorSettings>({
  enabled: true,
  domain: '',
  checkHour: 7,
  warningDays: 7
})
const credentials = reactive({ accessKeyId: '', accessKeySecret: '' })
const activeTab = ref('settings')
const clock = ref(Date.now())
let clockTimer: ReturnType<typeof setInterval> | undefined

const STATE_META: Record<CertificateAutomationState, { label: string; type: '' | 'success' | 'warning' | 'danger' | 'info' }> = {
  idle: { label: '等待检查', type: 'info' },
  checking: { label: '检查中', type: 'info' },
  deploying: { label: '部署中', type: 'info' },
  verifying: { label: '线上验证中', type: 'info' },
  succeeded: { label: '已完成', type: 'success' },
  failed: { label: '执行失败', type: 'danger' },
  stopped: { label: '已中止', type: 'warning' }
}

const current = computed(() => certificate.status?.certificate)
const stateMeta = computed(() => {
  if (certificate.workflow?.kind === 'monitor' && certificate.workflow.running) return { label: '检查中', type: 'info' as const }
  if (current.value) return { label: '已检查', type: 'success' as const }
  return STATE_META.idle
})
const certificates = computed(() => certificate.status?.certificates ?? [])
const visibleCertificates = computed(() => visibleCertificateInstances(certificates.value, certificate.resources, certificate.resourcesKnown))
function deployedDomains(row: CertificateInstanceSummary): string[] {
  if (!row.certificateId || !certificate.resourcesKnown) return []
  return deployedCertificateDomains(row.certificateId, certificate.resources)
}
const busy = computed(() => certificate.loading || certificate.status?.busy === true || certificate.workflow?.running === true)
let autoResourceLoadAttempted = false
watch(() => [activeTab.value, certificate.status?.credentialsConfigured, certificates.value.length, busy.value] as const, ([tab, configured, count, isBusy]) => {
  if (!configured) autoResourceLoadAttempted = false
  if (tab !== 'certificates' || !configured || !count || isBusy || certificate.resourcesKnown || autoResourceLoadAttempted) return
  autoResourceLoadAttempted = true
  void certificate.loadResources()
}, { immediate: true })
const workflow = computed(() => certificate.workflow)
const workflowSteps = computed(() => workflow.value?.kind === 'monitor' ? ['检查证书'] : workflow.value?.kind === 'apply' ? ['提交申请'] : workflow.value?.kind === 'inspect' ? ['读取验证信息'] : workflow.value?.kind === 'refresh' ? ['刷新证书'] : workflow.value?.kind === 'resources' ? ['读取云资源'] : ['核验证书', '云端部署', '线上验证'])
const workflowStep = computed(() => {
  const phase = workflow.value?.phase ?? 'checking'
  if (workflow.value?.state === 'succeeded') return workflowSteps.value.length
  return ({ checking: 0, deploying: 1, verifying: 2 } as Record<string, number>)[phase] ?? 0
})
const workflowElapsed = computed(() => {
  if (!workflow.value) return '00:00'
  const seconds = Math.max(0, Math.floor(((workflow.value.finishedAt ?? clock.value) - workflow.value.startedAt) / 1000))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
})
const deployDialog = ref(false)
const selectedInstance = ref<CertificateInstanceSummary | null>(null)
const validationDialog = ref(false)
const applicationDetails = ref<CertificateApplicationDetail | null>(null)
const selectedResourceIds = ref<number[]>([])
const resourceKeyword = ref('')
const filteredResources = computed(() => certificate.resources.filter((item) => `${item.domain} ${item.instanceId || ''} ${item.id}`.toLowerCase().includes(resourceKeyword.value.trim().toLowerCase())))
const chosenResources = computed(() => certificate.resources.filter((item) => selectedResourceIds.value.includes(item.id)))
function toggleResource(id: number, checked: unknown): void {
  selectedResourceIds.value = checked ? [...new Set([...selectedResourceIds.value, id])] : selectedResourceIds.value.filter(value => value !== id)
}
const activeTask = computed(() => {
  const task = certificate.status?.automation
  return Boolean(task && (task.instanceId || task.orderId || task.applicationPending || task.deploymentPending || task.deploymentJobId))
})

function canDeploy(row: CertificateInstanceSummary): boolean {
  return certificateInstanceAction(row, certificate.status?.applications ?? []) === 'deploy'
}

function attemptPhase(row: CertificateInstanceSummary): string | undefined {
  return certificate.status?.applications?.find(item => item.instanceId === row.instanceId)?.phase
}

function canApply(row: CertificateInstanceSummary): boolean {
  return certificateInstanceAction(row, certificate.status?.applications ?? []) === 'apply'
}

function instanceLabel(row: CertificateInstanceSummary): string {
  if (canDeploy(row)) return row.certificateStatus === 'willExpire' ? '即将过期' : '已签发'
  const phase = attemptPhase(row)
  if (phase === 'submitted') return '已提交，待验证/签发'
  if (phase && !['configured', 'cleared'].includes(phase)) return '结果待核对'
  if (row.available) return '待申请'
  return ({ pending: '审核中', expired: '已过期', refund: '已退款', closed: '已关闭' } as Record<string, string>)[row.status] || '处理中'
}

async function applyInstance(row: CertificateInstanceSummary): Promise<void> {
  const domain = certificate.status?.settings.domain
  if (!domain) return
  try {
    await ElMessageBox.confirm(`使用实例 ${row.instanceId} 为 ${domain} 提交申请？\n将占用该待申请实例。`, '申请证书', { type: 'warning', confirmButtonText: '提交申请', cancelButtonText: '取消' })
  } catch { return }
  await certificate.applyCertificate(row.instanceId, domain)
}

async function showValidation(row: CertificateInstanceSummary): Promise<void> {
  const details = await certificate.inspectApplication(row.instanceId)
  if (!details) return
  applicationDetails.value = details
  validationDialog.value = true
}

async function refreshValidation(): Promise<void> {
  const instanceId = applicationDetails.value?.instanceId
  if (!instanceId) return
  validationDialog.value = false
  const details = await certificate.inspectApplication(instanceId)
  if (!details) return
  applicationDetails.value = details
  validationDialog.value = true
}

async function copyDnsValue(value: string): Promise<void> {
  const result = await window.ftpApi.copyText(value)
  if (result.ok) ElMessage.success('已复制')
  else ElMessage.error(result.error.message)
}

const canClearUncertainty = computed(() => {
  const details = applicationDetails.value
  if (!details?.available || details.hasValidation) return false
  const attempt = certificate.status?.applications?.find(item => item.instanceId === details.instanceId)
  return Boolean(attempt && ['uncertain', 'configuring', 'submitting'].includes(attempt.phase))
})

async function clearUncertainty(): Promise<void> {
  if (!applicationDetails.value) return
  try {
    await ElMessageBox.confirm('只有确认该实例确未提交时才能解除保护。云端状态可能延迟，重新申请可能重复提交。继续吗？', '解除待核对标记', { type: 'warning', confirmButtonText: '确认解除', cancelButtonText: '取消' })
  } catch { return }
  if (await certificate.clearApplicationUncertainty(applicationDetails.value.instanceId)) validationDialog.value = false
}

async function openDeployment(row: CertificateInstanceSummary): Promise<void> {
  selectedInstance.value = row
  resourceKeyword.value = ''
  if (!await certificate.loadResources()) return
  const defaults = certificate.status?.settings.deploymentResourceIds ?? []
  selectedResourceIds.value = defaultCertificateTargets(certificate.resources, certificate.status?.settings.domain ?? '', defaults)
  deployDialog.value = true
}

async function refreshResources(): Promise<void> {
  // 保留已选 ID；消失的资源明确提示，不悄悄替换部署目标。
  await certificate.loadResources()
}

async function saveDeploymentTargets(): Promise<void> {
  if (!certificate.status || !selectedResourceIds.value.length) return
  if (chosenResources.value.length !== selectedResourceIds.value.length) {
    ElMessage.warning('部分已选资源不再存在，请刷新后重新选择')
    return
  }
  if (await certificate.saveSettings({ ...certificate.status.settings, deploymentResourceIds: [...selectedResourceIds.value] })) syncForm()
}

async function executeDeployment(): Promise<void> {
  const instance = selectedInstance.value
  if (!instance || !selectedResourceIds.value.length || busy.value) return
  if (chosenResources.value.length !== selectedResourceIds.value.length) { ElMessage.warning('部分已选资源不再存在，请重新选择'); return }
  if (!instance.certificateId) return
  try {
    await ElMessageBox.confirm(certificateConfirmation(instance.certificateId, chosenResources.value.map(item => item.domain)), '确认部署', { type: 'warning', confirmButtonText: '确认执行', cancelButtonText: '取消' })
  } catch { return }
  const request = { instanceId: instance.instanceId, certificateId: instance.certificateId, resourceIds: [...selectedResourceIds.value], resourceDomains: selectedResourceIds.value.map(id => certificate.resources.find(item => item.id === id)!.domain) }
  deployDialog.value = false
  await certificate.executeSelected(request)
  if (!certificate.status?.busy) await certificate.loadResources()
}

function syncForm(): void {
  if (!certificate.status) return
  Object.assign(settings, certificate.status.settings)
  credentials.accessKeyId = ''
  credentials.accessKeySecret = ''
}

async function load(): Promise<void> {
  certificate.bind()
  await certificate.load()
  syncForm()
  if (certificate.status?.settings.domain && certificate.status.credentialsConfigured) activeTab.value = 'certificates'
}

async function refreshCertificateList(): Promise<void> {
  await certificate.refreshCertificates()
  if (!certificate.status?.busy) await certificate.loadResources()
}

async function saveSettings(): Promise<void> {
  if (await certificate.saveSettings({ ...settings, deploymentResourceIds: settings.deploymentResourceIds ? [...settings.deploymentResourceIds] : undefined })) syncForm()
}

async function saveCredentials(): Promise<void> {
  if (await certificate.saveCredentials({ ...credentials })) {
    autoResourceLoadAttempted = false
    syncForm()
    if (activeTab.value === 'certificates') await certificate.loadResources()
  }
}

async function confirmResume(): Promise<void> {
  try {
    await ElMessageBox.confirm(`继续 ${certificate.status?.settings.domain} 的部署任务？将复用原任务记录。`, '继续部署', { type: 'warning', confirmButtonText: '继续', cancelButtonText: '取消' })
  } catch { return }
  await certificate.resumeDeployment()
}

async function endLocalTask(): Promise<void> {
  try {
    await ElMessageBox.confirm('结束本地任务并解除锁定？云端申请或部署不会撤销，已用额度不退还。', '结束本地任务', { type: 'warning', confirmButtonText: '结束任务', cancelButtonText: '取消' })
  } catch { return }
  await certificate.endTask()
}

onMounted(() => {
  void load()
  clockTimer = setInterval(() => { clock.value = Date.now() }, 1000)
})
onUnmounted(() => { if (clockTimer) clearInterval(clockTimer) })
</script>

<template>
  <div v-loading="certificate.loading && !certificate.status">
    <el-alert
      v-if="certificate.errorNotice"
      type="error"
      closable
      show-icon
      :title="certificate.errorNotice.message"
      :description="certificate.errorNotice.detail"
      @close="certificate.dismissError()"
      style="margin-bottom: 18px"
    />

    <section class="certificate-hero fp-card">
      <div class="certificate-main">
        <div class="certificate-icon"><ShieldCheck :size="30" /></div>
        <div>
          <div class="certificate-domain mono">{{ current?.domain || settings.domain || '未配置域名' }}</div>
          <div class="certificate-sub">
            {{ current ? `证书到期：${formatDateTime(current.validTo)}` : '保存设置后可检查网站当前证书' }}
          </div>
        </div>
      </div>
      <div class="certificate-state">
        <el-tag :type="stateMeta.type" effect="dark">{{ stateMeta.label }}</el-tag>
        <strong v-if="current" :class="{ danger: current.remainingDays <= settings.warningDays }">
          {{ current.remainingDays }} 天
        </strong>
      </div>
      <div class="certificate-actions">
        <el-tooltip v-if="activeTask" :content="busy ? '请先中止正在运行的任务' : certificate.status?.settling ? '在途请求尚未返回，暂不能清理任务记录' : '结束本地任务并解除锁定，不撤销云端申请或部署'" placement="top"><span>
          <el-button text type="warning" aria-label="结束本地任务" :disabled="busy || certificate.status?.settling" @click="endLocalTask"><template #icon><Trash2 :size="16" /></template>结束任务</el-button>
        </span></el-tooltip>
        <el-tooltip content="立即检查网站证书" placement="top">
          <el-button text type="primary" aria-label="立即检查网站证书" :disabled="busy" @click="certificate.checkNow()">
            <template #icon><RefreshCw :size="19" /></template>
          </el-button>
        </el-tooltip>
        <el-tooltip v-if="certificate.status?.automation.mode === 'deploy-existing'" content="继续已有部署任务" placement="top">
          <el-button text type="success" aria-label="继续证书部署" :disabled="busy || !certificate.status?.credentialsConfigured" @click="confirmResume()">
            <template #icon><CloudUpload :size="19" /></template>
          </el-button>
        </el-tooltip>
      </div>
    </section>

    <section v-if="workflow" class="workflow-panel" :class="{ 'is-failed': workflow.state === 'failed', 'is-complete': workflow.state === 'succeeded' }" :aria-busy="workflow.running">
      <div class="workflow-heading">
        <LoaderCircle v-if="workflow.running" class="workflow-spinner" :size="18" />
        <BadgeCheck v-else-if="workflow.state === 'succeeded'" :size="18" />
        <ShieldCheck v-else :size="18" />
        <strong>{{ STATE_META[workflow.state].label }}</strong>
        <span class="workflow-elapsed mono">{{ workflow.running ? '已用时' : '用时' }} {{ workflowElapsed }}</span>
        <el-tooltip v-if="workflow.running" content="立即中止本地等待，不撤销已发送的云端请求" placement="top"><el-button class="workflow-stop" text type="warning" aria-label="中止证书任务" :disabled="certificate.stopping" @click="certificate.stopTask()"><template #icon><Square :size="15" /></template>{{ certificate.stopping ? '中止中' : '中止' }}</el-button></el-tooltip>
        <el-tooltip v-if="!workflow.running" content="关闭任务提示" placement="top"><el-button class="workflow-dismiss" text aria-label="关闭任务提示" @click="certificate.dismissWorkflow()"><template #icon><X :size="16" /></template></el-button></el-tooltip>
      </div>
      <p class="workflow-message" role="status">{{ workflow.message }}</p>
      <div class="workflow-track" role="progressbar" aria-label="证书任务进度" :aria-valuetext="STATE_META[workflow.state].label">
        <span :class="{ 'is-running': workflow.running }" :style="workflow.running ? undefined : { width: `${Math.min(100, (workflowStep + 1) / workflowSteps.length * 100)}%` }" />
      </div>
      <div class="workflow-steps"><span v-for="(step, index) in workflowSteps" :key="step" :class="{ 'is-done': index < workflowStep, 'is-current': index === workflowStep }">{{ step }}</span></div>
    </section>

    <el-tabs v-model="activeTab" class="certificate-tabs">
      <el-tab-pane label="监控配置" name="settings">
    <div class="certificate-grid">
      <section class="fp-card">
        <div class="fp-card-title"><CalendarClock :size="16" />自动监控</div>
        <el-form label-position="top" :disabled="busy">
          <el-form-item label="网站域名">
            <el-input v-model="settings.domain" placeholder="例如 haveways.com" />
          </el-form-item>
          <div class="form-two-columns">
            <el-form-item label="每日检查时间">
              <el-input-number v-model="settings.checkHour" :min="0" :max="23" controls-position="right" />
            </el-form-item>
            <el-form-item label="到期预警阈值">
              <el-input-number v-model="settings.warningDays" :min="1" :max="60" controls-position="right" />
              <span class="form-suffix">天</span>
            </el-form-item>
          </div>
          <div class="switch-row"><span>启用本地监控</span><el-switch v-model="settings.enabled" /></div>
          <el-button type="primary" @click="saveSettings">
            <template #icon><Save :size="15" /></template>保存设置
          </el-button>
        </el-form>
        <div class="meta-list">
          <span>上次检查：{{ formatDateTime(certificate.status?.automation.lastCheckAt) }}</span>
          <span>下次检查：{{ formatDateTime(certificate.status?.automation.nextCheckAt) }}</span>
          <span v-if="current">签发机构：{{ current.issuer || '--' }}</span>
        </div>
      </section>

      <section class="fp-card">
        <div class="fp-card-title"><KeyRound :size="16" />阿里云凭证</div>
        <el-alert
          v-if="certificate.status?.credentialsConfigured"
          type="success"
          :closable="false"
          :title="`已配置：${certificate.status.accessKeyIdMasked}`"
          style="margin-bottom: 14px"
        />
        <el-form label-position="top" :disabled="busy">
          <el-form-item label="AccessKey ID">
            <el-input v-model="credentials.accessKeyId" autocomplete="off" placeholder="LTAI..." />
          </el-form-item>
          <el-form-item label="AccessKey Secret">
            <el-input v-model="credentials.accessKeySecret" type="password" show-password autocomplete="new-password" />
          </el-form-item>
          <div class="button-row">
            <el-button type="primary" :disabled="!credentials.accessKeyId || !credentials.accessKeySecret" @click="saveCredentials">
              <template #icon><Save :size="15" /></template>加密保存
            </el-button>
            <el-button v-if="certificate.status?.credentialsConfigured" type="danger" text @click="certificate.clearCredentials()">
              <template #icon><Trash2 :size="15" /></template>清除凭证
            </el-button>
          </div>
        </el-form>
      </section>
    </div>
      </el-tab-pane>

      <el-tab-pane label="证书与部署" name="certificates">
    <section class="fp-card certificate-list-card">
      <div class="fp-card-title">
        <BadgeCheck :size="16" />证书实例
        <span style="flex: 1" />
        <el-tag type="success" effect="plain">
          {{ visibleCertificates.length }} 个实例<span v-if="certificates.length > visibleCertificates.length">，已隐藏 {{ certificates.length - visibleCertificates.length }} 个较早到期的证书</span>
        </el-tag>
      </div>
      <el-table :data="visibleCertificates" size="small" empty-text="暂无证书实例，请领取免费实例后刷新" style="margin-top: 14px">
        <el-table-column prop="instanceId" label="V2 实例 ID" min-width="235" show-overflow-tooltip />
        <el-table-column prop="domain" label="已绑定域名" min-width="130" />
        <el-table-column label="状态" width="150"><template #default="{ row }">{{ instanceLabel(row) }}</template></el-table-column>
        <el-table-column label="云主机部署" width="120">
          <template #default="{ row }">
            <el-tooltip v-if="deployedDomains(row).length" :content="deployedDomains(row).join('、')" placement="top">
              <el-tag type="success" effect="plain" size="small">已部署</el-tag>
            </el-tooltip>
            <el-tooltip v-else-if="row.certificateId && !certificate.resourcesKnown" content="云主机资源尚未成功读取，请点击刷新证书重试" placement="top"><span>状态未知</span></el-tooltip>
            <span v-else-if="row.certificateId">未发现部署</span>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column label="证书到期" min-width="170"><template #default="{ row }">{{ formatDateTime(row.certificateExpiresAt) }}</template></el-table-column>
        <el-table-column label="订阅到期" min-width="170"><template #default="{ row }">{{ formatDateTime(row.subscriptionExpiresAt) }}</template></el-table-column>
        <el-table-column label="操作" width="110" align="center" fixed="right">
          <template #default="{ row }">
            <div class="instance-actions">
              <el-tooltip v-if="!deployedDomains(row).length" :content="activeTask ? '请先继续或结束已有任务' : canDeploy(row) ? '选择资源部署已签发证书' : canApply(row) ? '为当前域名提交证书申请' : '查看申请状态和 DNS 验证信息'" placement="top"><span>
                <el-button v-if="canDeploy(row)" text type="success" aria-label="部署已签发证书" :disabled="busy || activeTask || !certificate.status?.settings.domain" @click="openDeployment(row)">
                  <template #icon><CloudUpload :size="16" /></template>部署
                </el-button>
                <el-button v-else-if="canApply(row)" text type="primary" aria-label="申请证书" :disabled="busy || activeTask || !certificate.status?.settings.domain" @click="applyInstance(row)">
                  <template #icon><ShieldCheck :size="16" /></template>申请
                </el-button>
                <el-button v-else text type="primary" aria-label="查看验证信息" :disabled="busy || activeTask" @click="showValidation(row)">
                  <template #icon><BadgeCheck :size="16" /></template>验证
                </el-button>
              </span></el-tooltip>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <div class="certificate-list-actions">
        <el-button type="primary" @click="certificate.openConsole()">
          <template #icon><ExternalLink :size="15" /></template>打开证书控制台
        </el-button>
        <el-button :disabled="!certificate.status?.credentialsConfigured || busy" @click="refreshCertificateList()">
          <template #icon><RefreshCw :size="15" /></template>刷新证书
        </el-button>
      </div>
    </section>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="validationDialog" title="证书验证信息" width="min(820px, 94vw)">
      <div class="deploy-summary"><span class="mono">{{ applicationDetails?.instanceId }}</span><el-tag effect="plain">{{ applicationDetails?.validationMethod || '验证方式待生成' }}</el-tag><el-tag v-if="applicationDetails?.certificateStatus === 'issued' || applicationDetails?.certificateStatus === 'willExpire'" type="success" effect="plain">已签发</el-tag><span>{{ applicationDetails?.domain || '域名待生成' }}</span></div>
      <el-alert v-if="applicationDetails?.validationMethod === 'HTTP'" type="warning" :closable="false" title="该实例当前使用文件验证，请在阿里云控制台核对验证方式。" />
      <el-alert v-else-if="!applicationDetails?.records.length" type="info" :closable="false" title="暂未返回 DNS 记录；可稍后重新查看并刷新状态。若阿里云已自动完成验证，无需手动添加。" />
      <el-table v-else :data="applicationDetails.records" size="small">
        <el-table-column prop="domain" label="验证域名" min-width="130" show-overflow-tooltip />
        <el-table-column prop="type" label="类型" width="75" />
        <el-table-column label="主机记录" min-width="160"><template #default="{ row }"><span class="mono">{{ row.name }}</span><el-tooltip content="复制主机记录"><el-button text aria-label="复制主机记录" @click="copyDnsValue(row.name)"><template #icon><Copy :size="14" /></template></el-button></el-tooltip></template></el-table-column>
        <el-table-column label="记录值" min-width="220"><template #default="{ row }"><span class="mono dns-value">{{ row.value }}</span><el-tooltip content="复制记录值"><el-button text aria-label="复制记录值" @click="copyDnsValue(row.value)"><template #icon><Copy :size="14" /></template></el-button></el-tooltip></template></el-table-column>
        <el-table-column prop="rootDomain" label="根域名" min-width="120" show-overflow-tooltip />
      </el-table>
      <template #footer><el-button v-if="canClearUncertainty" type="warning" plain :disabled="busy" @click="clearUncertainty">解除待核对标记</el-button><el-button :disabled="busy" @click="refreshValidation"><template #icon><RefreshCw :size="15" /></template>刷新验证</el-button><el-button @click="validationDialog = false">关闭</el-button></template>
    </el-dialog>

    <el-dialog v-model="deployDialog" title="云产品部署选择" width="min(980px, 94vw)" :close-on-click-modal="false">
      <div class="deploy-summary">
        <el-tag effect="plain">部署已签发证书</el-tag>
        <span class="mono">{{ selectedInstance?.instanceId }}</span>
        <span v-if="selectedInstance?.certificateId">证书 ID {{ selectedInstance.certificateId }}</span>
      </div>
      <div class="resource-toolbar">
        <el-input v-model="resourceKeyword" clearable placeholder="搜索域名、主机名或资源 ID" :disabled="busy" />
        <span>已选 {{ selectedResourceIds.length }} 个</span>
        <el-tooltip content="刷新阿里云资源列表" placement="top"><el-button aria-label="刷新部署资源" :disabled="busy" @click="refreshResources"><template #icon><RefreshCw :size="16" /></template></el-button></el-tooltip>
        <el-tooltip content="清空选择" placement="top"><el-button aria-label="清空部署资源选择" :disabled="busy" @click="selectedResourceIds = []"><template #icon><Trash2 :size="16" /></template></el-button></el-tooltip>
      </div>
      <el-table :data="filteredResources" max-height="350" size="small" empty-text="暂无云虚拟主机资源，请先在阿里云控制台同步云产品资源">
        <el-table-column width="48"><template #default="{ row }"><el-checkbox :model-value="selectedResourceIds.includes(row.id)" :aria-label="`选择 ${row.domain}`" :disabled="busy" @change="toggleResource(row.id, $event)" /></template></el-table-column>
        <el-table-column prop="domain" label="域名" min-width="170" show-overflow-tooltip />
        <el-table-column prop="instanceId" label="主机名" min-width="145" show-overflow-tooltip />
        <el-table-column prop="id" label="资源 ID" width="100" />
        <el-table-column label="已部署证书" min-width="180"><template #default="{ row }"><div>{{ row.certificateName || '—' }}</div><small>{{ row.certificateId ? `ID ${row.certificateId}` : '尚无证书' }}</small><div v-if="row.certificateEndTime"><small>到期 {{ row.certificateEndTime }}</small></div></template></el-table-column>
      </el-table>
      <div class="selected-targets"><el-tag v-for="id in selectedResourceIds" :key="id" closable @close="selectedResourceIds = selectedResourceIds.filter(value => value !== id)">{{ certificate.resources.find(item => item.id === id)?.domain || `资源 ${id}（已不可见，请移除）` }}</el-tag></div>
      <template #footer>
        <el-tooltip content="保存为默认部署目标，不触发部署" placement="top"><el-button aria-label="保存默认部署目标" :disabled="busy || !selectedResourceIds.length" @click="saveDeploymentTargets"><template #icon><Save :size="16" /></template></el-button></el-tooltip>
        <el-button :disabled="busy" @click="deployDialog = false">取消</el-button>
        <el-button type="primary" :disabled="busy || !selectedResourceIds.length" @click="executeDeployment"><template #icon><CloudUpload :size="16" /></template>部署所选证书</el-button>
      </template>
    </el-dialog>

  </div>
</template>

<style scoped>
.certificate-hero { display: flex; align-items: center; gap: 18px; }
.certificate-main { display: flex; align-items: center; gap: 14px; min-width: 0; flex: 1; }
.certificate-icon { display: grid; place-items: center; width: 54px; height: 54px; border-radius: 16px; color: var(--fp-accent); background: rgba(45, 212, 191, .09); border: 1px solid rgba(45, 212, 191, .2); }
.certificate-domain { font-size: 19px; font-weight: 750; color: var(--fp-text); }
.certificate-sub { margin-top: 5px; color: var(--fp-text-muted); font-size: 12.5px; }
.certificate-state { display: flex; align-items: center; gap: 12px; }
.certificate-state strong { font: 700 22px/1 var(--fp-mono); color: var(--fp-success); }
.certificate-state strong.danger { color: var(--fp-danger); }
.certificate-actions { display: flex; }
.instance-actions { display: flex; flex-wrap: nowrap; align-items: center; justify-content: center; gap: 4px; white-space: nowrap; }
.instance-actions > span { display: inline-flex; flex-shrink: 0; }
.instance-actions :deep(.el-button) { min-width: 68px; height: 30px; padding: 0 8px; margin: 0; }
.certificate-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: stretch; gap: 16px; }
.certificate-grid > .fp-card { min-width: 0; margin: 0; }
.form-two-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.form-suffix { margin-left: 8px; color: var(--fp-text-muted); }
.switch-row { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-top: 1px solid var(--fp-border); color: var(--fp-text-muted); font-size: 13px; }
.meta-list { display: grid; gap: 6px; margin-top: 16px; color: var(--fp-text-faint); font: 11.5px/1.5 var(--fp-mono); }
.button-row, .certificate-list-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.certificate-tabs { margin-top: 20px; }
.certificate-list-card { margin: 0; }
.workflow-panel { margin-top: 16px; padding: 16px 18px; border: 1px solid rgba(45, 212, 191, .22); border-radius: 12px; background: linear-gradient(115deg, rgba(45, 212, 191, .06), rgba(56, 189, 248, .025)); color: var(--fp-accent); }
.workflow-heading { display: flex; align-items: center; gap: 9px; }
.workflow-heading strong { font-size: 13px; }
.workflow-elapsed { margin-left: auto; color: var(--fp-text-muted); font-size: 12px; }
.workflow-dismiss { width: 26px; height: 26px; padding: 0; margin: 0; color: var(--fp-text-muted); }
.workflow-stop { height: 26px; padding: 0 8px; margin: 0; white-space: nowrap; }
.workflow-message { margin: 10px 0 12px; color: var(--fp-text-muted); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.workflow-track { position: relative; height: 5px; overflow: hidden; border-radius: 8px; background: rgba(148, 163, 184, .12); }
.workflow-track > span { display: block; height: 100%; border-radius: inherit; background: var(--fp-accent-gradient); }
.workflow-track > span.is-running { width: 35%; animation: workflow-progress 1.6s ease-in-out infinite; }
.workflow-spinner { animation: workflow-spin 1s linear infinite; }
.workflow-steps { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px 14px; margin-top: 11px; color: var(--fp-text-faint); font-size: 11px; }
.workflow-steps .is-current { color: var(--fp-accent); }
.workflow-steps .is-done { color: var(--fp-text-muted); }
.workflow-panel.is-failed { border-color: rgba(248, 113, 113, .25); color: var(--fp-danger); }
.workflow-panel.is-failed .workflow-track > span { background: var(--fp-danger); }
.workflow-panel.is-complete { color: var(--fp-success); }
@keyframes workflow-progress { from { transform: translateX(-105%); } to { transform: translateX(390%); } }
@keyframes workflow-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .workflow-track > span.is-running { width: 100%; animation: none; opacity: .6; } .workflow-spinner { animation: none; } }
.certificate-list-actions { margin-top: 16px; }
.deploy-summary, .resource-toolbar, .selected-targets { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin: 14px 0; }
.deploy-summary { color: var(--fp-text-muted); font-size: 12px; }
.dns-value { overflow-wrap: anywhere; }
.resource-toolbar .el-input { flex: 1; min-width: 180px; }
.resource-toolbar > span { color: var(--fp-text-muted); font-size: 12px; }
.selected-targets { min-height: 28px; gap: 8px; }
@media (max-width: 1100px) { .certificate-grid { grid-template-columns: 1fr; } }
</style>
