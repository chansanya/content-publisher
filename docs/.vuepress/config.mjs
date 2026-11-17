import { viteBundler } from '@vuepress/bundler-vite'
import { defaultTheme } from '@vuepress/theme-default'
import { defineUserConfig } from 'vuepress'

export default defineUserConfig({
  base: '/content-publisher/',
  lang: 'zh-CN',
  title: '内容发布工具',
  description:
    '面向阿里云虚拟云主机应用发布的 Windows x64 Electron 工具，支持 FTP 上传发布、历史回滚、本地 Web 预览与证书申请/监控/部署。',

  bundler: viteBundler(),

  theme: defaultTheme({
    repo: 'chansanya/content-publisher',
    docsBranch: 'master',
    docsDir: 'docs',
    navbar: [
      { text: '首页', link: '/' },
      { text: '指南', link: '/guide/' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: '指南',
          children: [
            '/guide/README.md',
            '/guide/configuration.md',
            '/guide/certificate.md',
            '/guide/plugins.md',
            '/guide/architecture.md',
          ],
        },
      ],
    },
  }),
})
