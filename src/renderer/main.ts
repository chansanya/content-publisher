import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import '@renderer/styles/theme.css'
import App from './App.vue'
import { useProgressStore } from './stores/progress'
import { useLogsStore } from './stores/logs'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.use(ElementPlus)

// 订阅主进程节流后的真实上传进度
useProgressStore(pinia).bind()
useLogsStore(pinia).bindMain()

app.mount('#app')
