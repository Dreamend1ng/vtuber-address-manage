import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import './style.css'
import App from './App.vue'
import { router } from './router'
import { siteConfig } from './config'
import { initializeVault } from './services/vault'
import { applyPrimaryColor } from './utils/theme'

async function bootstrap(): Promise<void> {
  applyPrimaryColor(siteConfig.primaryColor)
  try {
    await initializeVault()
  } catch (error) {
    console.error('无法打开本地数据库', error)
  }
  const app = createApp(App)
  app.use(ElementPlus, { locale: zhCn })
  app.use(router)
  app.mount('#app')
}

void bootstrap()
