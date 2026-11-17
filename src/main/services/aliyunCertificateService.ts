import CasClient, {
  CreateDeploymentJobRequest,
  DescribeDeploymentJobStatusRequest,
  DescribeDeploymentJobRequest,
  ListCloudResourcesRequest,
  ListContactRequest,
  ListWorkerResourceRequest,
  ListInstancesRequest,
  GetInstanceDetailRequest,
  GetCertificateDetailRequest,
  UpdateInstanceRequest,
  ApplyCertificateRequest,
  UpdateDeploymentJobStatusRequest
} from '@alicloud/cas20200407'
import { $OpenApiUtil } from '@alicloud/openapi-core'
import type { CertificateApplicationDetail, CertificateCloudResource, CertificateCredentialInput, CertificateInstanceSummary } from '@shared/types'
import { ServiceError } from './errors'
import { assertCertificateTaskRunning, certificateCoversDomain, safeCertificateError, normalizeCertificateDomain } from './certificatePolicy'


export interface IssuedCertificate {
  certificateId: string
  domains: string[]
  serialNumber: string
  validTo: string
}

export interface CertificateDeploymentStatus {
  workerCount: number
  successCount: number
  failedCount: number
  finished: boolean
  success: boolean
  errors: string[]
}

function sdkErrorDetail(err: unknown): string {
  if (err && typeof err === 'object') {
    const item = err as { code?: unknown; message?: unknown; data?: unknown }
    return [item.code, item.message].filter((value) => typeof value === 'string' && value).join(': ') || String(err)
  }
  return String(err)
}

export class AliyunCertificateService {
  private readonly client: CasClient
  private readonly secrets: string[]

  constructor(credentials: CertificateCredentialInput) {
    this.secrets = [credentials.accessKeyId, credentials.accessKeySecret]
    this.client = new CasClient(
      new $OpenApiUtil.Config({
        accessKeyId: credentials.accessKeyId,
        accessKeySecret: credentials.accessKeySecret,
        regionId: 'cn-hangzhou',
        endpoint: 'cas.aliyuncs.com',
        connectTimeout: 15_000,
        readTimeout: 30_000
      })
    )
  }


  private errorDetail(err: unknown): string {
    return safeCertificateError(new Error(sdkErrorDetail(err)), this.secrets).message
  }

  async listCertificates(): Promise<CertificateInstanceSummary[]> {
    try {
      const instances = new Map<string, CertificateInstanceSummary>()
      let fetched = 0
      for (let page = 1; page <= 100; page++) {
        const response = await this.client.listInstances(new ListInstancesRequest({ currentPage: page, showSize: 100 }))
        const rows = response.body?.instanceList ?? []
        fetched += rows.length
        for (const item of rows) {
          const signed = Boolean(item.certificateId && ['issued', 'willExpire'].includes(item.certificateStatus || ''))
          const testInstance = (!item.instanceType || item.instanceType === 'TEST') && (!item.versionType || item.versionType === 'basic')
          if (!item.instanceId || (!signed && !testInstance)) continue
          const expiry = item.certificateNotAfter
          const subscription = item.orderEndTime || item.instanceEndTime
          const subscriptionMillis = subscription ? (subscription < 1e12 ? subscription * 1000 : subscription) : 0
          instances.set(item.instanceId, { instanceId: item.instanceId, name: item.certificateName || item.instanceId,
            status: item.status || '', domain: item.certificateDomain || item.domain || '', certificateId: item.certificateId,
            certificateStatus: item.certificateStatus,
            certificateExpiresAt: expiry ? new Date(expiry < 1e12 ? expiry * 1000 : expiry).toISOString() : undefined,
            subscriptionExpiresAt: subscriptionMillis ? new Date(subscriptionMillis).toISOString() : undefined,
            available: testInstance && item.status === 'inactive' && !item.certificateId && !item.certificateStatus && (!subscriptionMillis || subscriptionMillis > Date.now()) })
        }
        const total = response.body?.totalCount
        if (total !== undefined ? fetched >= total : rows.length < 100) return [...instances.values()]
        if (!rows.length) break
      }
      throw new ServiceError('CERT_INSTANCES_INCOMPLETE', '证书列表分页不完整，请重新刷新')
    } catch (err) {
      if (err instanceof ServiceError) throw err
      throw new ServiceError('CERT_INSTANCE_QUERY_FAILED', '查询证书实例失败，请确认 ListInstances 权限', this.errorDetail(err))
    }
  }

  async getApplicationDetails(instanceId: string): Promise<CertificateApplicationDetail> {
    try {
      const detail = (await this.client.getInstanceDetail(new GetInstanceDetailRequest({ instanceId }))).body
      if (!detail || detail.instanceId !== instanceId) throw new ServiceError('CERT_INSTANCE_INVALID', '证书实例详情不完整')
      const expiry = detail.orderEndTime || detail.instanceEndTime
      const expired = Boolean(expiry && (expiry < 1e12 ? expiry * 1000 : expiry) <= Date.now())
      const certExpiry = detail.certificateNotAfter
      const records = (detail.domainValidationList ?? []).filter(item => ['TXT', 'CNAME'].includes(item.validationType || '') && item.validationKey && item.validationValue).map(item => ({ domain: item.domain || '', rootDomain: item.rootDomain || '', type: item.validationType!, name: item.validationKey!, value: item.validationValue! }))
      return { instanceId, domain: detail.domain || '', status: detail.status || '', certificateStatus: detail.certificateStatus || '', certificateId: detail.certificateId,
        certificateExpiresAt: certExpiry ? new Date(certExpiry < 1e12 ? certExpiry * 1000 : certExpiry).toISOString() : undefined, validationMethod: detail.validationMethod || '', records,
        hasValidation: (detail.domainValidationList ?? []).some(item => Boolean(item.validationKey || item.validationValue)),
        available: detail.status === 'inactive' && !detail.certificateId && !detail.certificateStatus && !expired && (!detail.instanceType || detail.instanceType === 'TEST') && (!detail.versionType || detail.versionType === 'basic') }
    } catch (err) {
      if (err instanceof ServiceError) throw err
      throw new ServiceError('CERT_APPLICATION_DETAILS_FAILED', '读取证书申请和验证信息失败', this.errorDetail(err))
    }
  }

  async configureApplication(instanceId: string, domain: string, signal?: AbortSignal): Promise<void> {
    try {
      assertCertificateTaskRunning(signal)
      const detail = (await this.client.getInstanceDetail(new GetInstanceDetailRequest({ instanceId }))).body
      assertCertificateTaskRunning(signal)
      const expiry = detail?.orderEndTime || detail?.instanceEndTime
      const expired = Boolean(expiry && (expiry < 1e12 ? expiry * 1000 : expiry) <= Date.now())
      if (!detail || detail.instanceId !== instanceId || detail.status !== 'inactive' || detail.certificateId || detail.certificateStatus || expired || (detail.instanceType && detail.instanceType !== 'TEST') || (detail.versionType && detail.versionType !== 'basic')) throw new ServiceError('CERT_INSTANCE_UNAVAILABLE', '该实例不可申请，请刷新后核对')
      if (detail.domain && detail.domain.toLowerCase() !== domain) throw new ServiceError('CERT_INSTANCE_DOMAIN_MISMATCH', '该实例已绑定其他域名，不能覆盖')
      if ((detail.domainValidationList ?? []).some(item => item.validationKey || item.validationValue)) throw new ServiceError('CERT_INSTANCE_ALREADY_SUBMITTED', '该实例已有验证信息，请查看状态，不会重复申请')
      const contacts = detail.contactIdList?.length ? detail.contactIdList : [await this.getContactId()]
      assertCertificateTaskRunning(signal)
      await this.client.updateInstance(new UpdateInstanceRequest({ instanceId, domain, contactIdList: contacts, validationMethod: 'DNS', generateCsrMethod: 'online', keyAlgorithm: 'RSA_2048' }))
    } catch (err) {
      if (err instanceof ServiceError) throw err
      throw new ServiceError('CERT_APPLICATION_CONFIG_FAILED', '配置证书实例失败，请核对实例状态后再操作', this.errorDetail(err))
    }
  }

  async submitApplication(instanceId: string, signal?: AbortSignal): Promise<void> {
    try {
      assertCertificateTaskRunning(signal)
      await this.client.applyCertificate(new ApplyCertificateRequest({ instanceId }))
    } catch (err) {
      if (err instanceof ServiceError) throw err
      throw new ServiceError('CERT_APPLICATION_SUBMIT_UNKNOWN', '申请结果未确认，请核对该实例，禁止重复提交', this.errorDetail(err))
    }
  }

  async getIssuedCertificate(instanceId: string, domain: string): Promise<IssuedCertificate> {
    try {
      const detail = (await this.client.getInstanceDetail(new GetInstanceDetailRequest({ instanceId }))).body
      if (!detail || detail.instanceId !== instanceId || !detail.certificateId || !['issued', 'willExpire'].includes(detail.certificateStatus || '')) {
        throw new ServiceError('CERT_NOT_ISSUED', '所选实例没有可部署的已签发证书，请刷新列表')
      }
      const cert = (await this.client.getCertificateDetail(new GetCertificateDetailRequest({ certificateId: detail.certificateId }))).body
      const domains = cert?.subjectAlternativeNames?.length ? cert.subjectAlternativeNames : [cert?.domain || detail.domain || '']
      const millis = (value: number) => value < 1e12 ? value * 1000 : value
      if (!cert || cert.certificateId !== detail.certificateId || (cert.instanceId && cert.instanceId !== instanceId) || !['issued', 'willExpire'].includes(cert.certificateStatus || '') || !cert.existPrivateKey || !cert.serial || !cert.notBefore || !cert.notAfter || millis(cert.notBefore) > Date.now() || millis(cert.notAfter) <= Date.now()) {
        throw new ServiceError('CERT_NOT_DEPLOYABLE', '所选证书尚未生效、已过期、缺少私钥或详情不完整，不能部署')
      }
      if (!certificateCoversDomain(domains, domain)) throw new ServiceError('CERT_CERTIFICATE_DOMAIN_MISMATCH', '所选证书不覆盖监控域名，不能部署')
      return { certificateId: String(detail.certificateId), domains, serialNumber: cert.serial, validTo: new Date(millis(cert.notAfter)).toISOString() }
    } catch (err) {
      if (err instanceof ServiceError) throw err
      throw new ServiceError('CERT_DETAIL_FAILED', '读取已签发证书详情失败', this.errorDetail(err))
    }
  }

  async listWebHostingResources(): Promise<CertificateCloudResource[]> {
    try {
      const results = new Map<number, CertificateCloudResource>()
      let fetched = 0
      for (let page = 1; page <= 100; page++) {
        const response = await this.client.listCloudResources(new ListCloudResourcesRequest({ cloudName: 'aliyun', cloudProduct: 'webHosting', currentPage: page, showSize: 100 }))
        const rows = response.body?.data ?? []
        fetched += rows.length
        for (const item of rows) {
          if (item.cloudProduct !== 'webHosting' || !Number.isSafeInteger(item.id) || !item.id || !item.domain) continue
          const domain = normalizeCertificateDomain(item.domain)
          const resource: CertificateCloudResource = { id: item.id, domain, instanceId: item.instanceId, regionId: item.regionId || item.cloudRegion || '', certificateId: item.certId, certificateName: item.certName, certificateEndTime: item.certEndTime }
          if (results.has(item.id) && JSON.stringify(results.get(item.id)) !== JSON.stringify(resource)) throw new ServiceError('CERT_RESOURCE_AMBIGUOUS', '同一云资源 ID 返回了不同域名，请在控制台核对')
          results.set(item.id, resource)
        }
        const total = response.body?.total
        if (total !== undefined ? fetched >= total : rows.length < 100) return [...results.values()]
        if (!rows.length) break
      }
      throw new ServiceError('CERT_RESOURCES_INCOMPLETE', '云虚拟主机资源分页不完整，请重新同步云产品资源')
    } catch (err) {
      if (err instanceof ServiceError) throw err
      throw new ServiceError('CERT_RESOURCE_QUERY_FAILED', '查询云虚拟主机资源失败，请确认控制台已同步资源及 ListCloudResources 权限', this.errorDetail(err))
    }
  }



  async getContactId(): Promise<number> {
    try {
      const response = await this.client.listContact(new ListContactRequest({ currentPage: 1, showSize: 50 }))
      const contacts = response.body?.contactList ?? []
      const verified = contacts.find((item) => item.emailStatus === 1 || item.mobileStatus === 1) ?? contacts[0]
      const contactId = Number(verified?.contactId ?? 0)
      if (!contactId) {
        throw new ServiceError('CERT_CONTACT_MISSING', '阿里云证书服务尚未配置联系人')
      }
      return contactId
    } catch (err) {
      if (err instanceof ServiceError) throw err
      throw new ServiceError('CERT_CONTACT_QUERY_FAILED', '查询证书联系人失败', this.errorDetail(err))
    }
  }

  async createDeployment(certificateId: string, resourceId: number | number[], contactId: number, domain: string): Promise<number> {
    try {
      const response = await this.client.createDeploymentJob(
        new CreateDeploymentJobRequest({
          name: `auto-cert-${domain}-${new Date().toISOString().slice(0, 10)}`,
          jobType: 'user',
          certIds: certificateId,
          resourceIds: Array.isArray(resourceId) ? resourceId.join(',') : String(resourceId),
          contactIds: String(contactId)
        })
      )
      const jobId = Number(response.body?.jobId ?? 0)
      if (!jobId) throw new Error('接口未返回 JobId')
      return jobId
    } catch (err) {
      throw new ServiceError('CERT_DEPLOY_CREATE_FAILED', '创建证书部署任务失败', this.errorDetail(err))
    }
  }

  async startDeployment(jobId: number, signal?: AbortSignal): Promise<void> {
    try {
      assertCertificateTaskRunning(signal)
      const job = await this.client.describeDeploymentJob(new DescribeDeploymentJobRequest({ jobId }))
      assertCertificateTaskRunning(signal)
      if (job.body?.status === 'editing') {
        await this.client.updateDeploymentJobStatus(new UpdateDeploymentJobStatusRequest({ jobId, status: 'scheduling' }))
      } else if (!['pending', 'scheduling', 'running', 'processing', 'success'].includes(String(job.body?.status))) {
        throw new Error(`部署任务状态不可启动: ${job.body?.status ?? 'unknown'}`)
      }
    } catch (err) {
      if (err instanceof ServiceError) throw err
      throw new ServiceError('CERT_DEPLOY_START_FAILED', '启动证书部署任务失败', this.errorDetail(err))
    }
  }

  async getDeploymentStatus(jobId: number): Promise<CertificateDeploymentStatus> {
    try {
      const response = await this.client.describeDeploymentJobStatus(
        new DescribeDeploymentJobStatusRequest({ jobId })
      )
      const body = response.body
      const workerCount = Number(body?.workerCount ?? 0)
      const successCount = Number(body?.successCount ?? 0)
      const failedCount = Number(body?.failedCount ?? 0)
      const errors: string[] = []
      const worker = await this.client.listWorkerResource(
        new ListWorkerResourceRequest({ jobId, currentPage: 1, showSize: 100 })
      )
      const workers = worker.body?.data ?? []
      for (const item of workers) {
        const status = String(item.status ?? '').toLowerCase()
        if (status === 'error' || status === 'failed') {
          errors.push(`${item.resourceDomain ?? item.certDomain ?? '未知资源'}: 部署失败`)
        }
      }
      const totalWorkers = Math.max(Number(worker.body?.total ?? 0), workers.length, workerCount)
      const completedWorkers = workers.length
        ? workers.filter((item) => ['success', 'error', 'failed'].includes(String(item.status ?? '').toLowerCase())).length
        : successCount + failedCount
      const completedSuccess = workers.length
        ? workers.filter((item) => String(item.status ?? '').toLowerCase() === 'success').length
        : successCount
      return {
        workerCount: totalWorkers,
        successCount: completedSuccess,
        failedCount: Math.max(failedCount, errors.length),
        finished: totalWorkers > 0 && completedWorkers >= totalWorkers,
        success: totalWorkers > 0 && completedSuccess >= totalWorkers && errors.length === 0,
        errors
      }
    } catch (err) {
      throw new ServiceError('CERT_DEPLOY_STATE_FAILED', '查询证书部署状态失败', this.errorDetail(err))
    }
  }
}
