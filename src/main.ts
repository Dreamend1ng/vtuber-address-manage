import { createApp } from 'vue'
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
  app.use(router)
  app.mount('#app')
}

void bootstrap()
