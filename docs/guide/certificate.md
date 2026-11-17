# 证书申请、监控与部署

软件支持使用已领取的 V2 免费实例提交证书申请、查看 DNS 验证信息、刷新签发状态，以及部署已签发证书。申请提交后本地任务立即结束，不轮询等待验证或签发；软件不新增、修改或删除 DNS 解析记录。

## 使用流程

1. 在软件中保存域名和阿里云凭证，进入「证书与部署」，点击「刷新证书」。
2. 对待申请实例点击「申请」并确认，程序配置 DNS 验证并提交一次申请。
3. 点击「验证」查看阿里云返回的记录，必要时在实际 DNS 服务商配置后手动刷新状态。
4. 签发后点击「部署」，勾选云虚拟主机资源并确认，程序等待部署完成并核对线上证书。

## 监控

「监控配置」页保留域名、每日检查时间、到期预警天数与本地监控开关，默认每天 07:00 检查，启动和电脑唤醒时补检；定时任务只读取网站 TLS 证书，不触发云端部署。

## 建议授予的 CAS 动作

```text
yundun-cert:ListInstances
yundun-cert:GetInstanceDetail
yundun-cert:GetCertificateDetail
yundun-cert:UpdateInstance
yundun-cert:ApplyCertificate
yundun-cert:ListCloudResources
yundun-cert:ListContact
yundun-cert:CreateDeploymentJob
yundun-cert:DescribeDeploymentJob
yundun-cert:UpdateDeploymentJobStatus
yundun-cert:DescribeDeploymentJobStatus
yundun-cert:ListWorkerResource
```

## 安全说明

AccessKey 存放在 `.env`，Secret 为明文，不通过状态接口返回、不写入日志；证书列表与详情接口不获取私钥内容。
