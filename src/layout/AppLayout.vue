<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Calendar, FolderOpened, Lock, Odometer, Setting, Van } from '@element-plus/icons-vue'
import { siteConfig } from '../config'
import { lockVault } from '../services/vault'
import { updateSettings } from '../services/records'
import { applyUpdate, checkForUpdate, updateNotice } from '../services/updater'

const route = useRoute()
const router = useRouter()
const active = computed(() => route.path)

async function lockNow(): Promise<void> {
  lockVault()
  await router.replace({ name: 'unlock' })
  ElMessage.success('保险库已锁定，数据密钥已从内存清除')
}

/* ---------- 版本更新 ---------- */
const updating = ref(false)
const updateProgress = ref('')
const canOneClick = computed(() => Boolean(updateSettings.value?.token && updateSettings.value?.ownRepo))

onMounted(async () => {
  const settings = updateSettings.value
  if (!settings?.enabled) return
  const info = await checkForUpdate(settings.upstream)
  if (info?.hasUpdate) {
    updateNotice.info = info
    updateNotice.visible = true
  }
})

function openNotes(): void {
  if (updateNotice.info?.notesUrl) {
    window.open(updateNotice.info.notesUrl, '_blank', 'noopener')
  }
}

async function runUpdate(): Promise<void> {
  updating.value = true
  updateProgress.value = ''
  try {
    const result = await applyUpdate((message) => {
      updateProgress.value = message
    })
    updateNotice.visible = false
    if (result.files === 0) {
      ElMessage.success('已经是最新代码，没有需要同步的文件')
    } else {
      ElMessage.success(`已提交 ${result.files} 个文件的更新，GitHub 正在重新部署，约 1 分钟后刷新页面生效`)
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '更新失败')
  } finally {
    updating.value = false
    updateProgress.value = ''
  }
}
</script>

<template>
  <div class="app-shell">
    <aside class="app-aside">
      <div class="app-brand">
        <span class="app-brand__name">{{ siteConfig.appName }}</span>
        <span class="app-brand__en">{{ siteConfig.appNameEn }}</span>
      </div>
      <div class="airmail-stripe app-aside__stripe" />
      <el-menu class="app-nav" :default-active="active" router>
        <el-menu-item index="/">
          <el-icon><Odometer /></el-icon>
          <span>概览</span>
        </el-menu-item>
        <el-menu-item index="/events">
          <el-icon><Calendar /></el-icon>
          <span>活动</span>
        </el-menu-item>
        <el-menu-item index="/shipping">
          <el-icon><Van /></el-icon>
          <span>发货</span>
        </el-menu-item>
        <el-menu-item index="/backup">
          <el-icon><FolderOpened /></el-icon>
          <span>备份 / 恢复</span>
        </el-menu-item>
        <el-menu-item index="/settings">
          <el-icon><Setting /></el-icon>
          <span>设置</span>
        </el-menu-item>
      </el-menu>
      <div class="app-aside__foot">
        <el-button plain class="lock-button" @click="lockNow">
          <el-icon><Lock /></el-icon>
          <span>锁定保险库</span>
        </el-button>
        <p class="app-aside__note">数据加密保存在本机浏览器中</p>
      </div>
    </aside>
    <main class="app-main">
      <div class="app-main__inner">
        <router-view />
      </div>
    </main>
  </div>

  <!-- 版本更新提示 -->
  <el-dialog v-model="updateNotice.visible" title="发现新版本" width="540px">
    <div v-if="updateNotice.info" class="update-body">
      <p class="update-versions">
        当前 <span class="mono">v{{ updateNotice.info.currentVersion }}</span>
        <span class="update-arrow">→</span>
        最新 <span class="mono update-latest">v{{ updateNotice.info.latestVersion }}</span>
      </p>
      <p v-if="updateProgress" class="update-progress">{{ updateProgress }}</p>
      <p v-else-if="canOneClick" class="update-hint">
        点「一键更新」会对比上游代码，只同步有变化的文件并提交一次，GitHub Actions 随后自动重新部署（约 1 分钟）。
        更新只改代码，不影响本机数据与收集仓库，你改过的应用名与网站图标会保留。
      </p>
      <template v-else>
        <p class="update-hint">还没有配置更新 Token。到「设置 → 版本更新」配置后可以一键更新，也可以手动同步：</p>
        <ul class="update-steps">
          <li>Fork 用户：在你的仓库首页点 <strong>Sync fork → Update branch</strong>；</li>
          <li>
            模板复制用户：本地执行
            <span class="mono">git remote add upstream https://github.com/{{ updateSettings?.upstream || 'Dreamend1ng/vtuber-address-manage' }}.git</span>
            ，再 <span class="mono">git pull upstream main</span> 并推送。
          </li>
        </ul>
      </template>
    </div>
    <template #footer>
      <el-button @click="updateNotice.visible = false">稍后</el-button>
      <el-button @click="openNotes">查看更新说明</el-button>
      <el-button v-if="canOneClick" type="primary" :loading="updating" @click="runUpdate">一键更新</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.app-shell {
  display: flex;
  min-height: 100vh;
}

.app-aside {
  display: flex;
  flex-direction: column;
  width: 228px;
  flex-shrink: 0;
  background: var(--surface);
  border-right: 1px solid var(--line);
}

.app-brand {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 20px 20px 14px;
}

.app-brand__name {
  font-size: 19px;
  font-weight: 800;
  letter-spacing: 0.02em;
}

.app-brand__en {
  font-family: var(--font-mono);
  font-size: 9.5px;
  letter-spacing: 0.18em;
  color: var(--muted);
}

.app-aside__stripe {
  height: 4px;
  opacity: 0.9;
  margin-bottom: 10px;
}

.app-nav {
  flex: 1;
  border-right: none;
  background: transparent;
}

.app-nav :deep(.el-menu-item) {
  height: 42px;
  margin: 2px 10px;
  border-radius: 8px;
  color: var(--ink-soft);
}

.app-nav :deep(.el-menu-item.is-active) {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-weight: 600;
}

.app-nav :deep(.el-menu-item:hover) {
  background: #f4f6fa;
}

.app-nav :deep(.el-menu-item.is-active:hover) {
  background: var(--el-color-primary-light-9);
}

.app-aside__foot {
  padding: 14px 16px 18px;
  border-top: 1px solid var(--line);
}

.lock-button {
  width: 100%;
}

.app-aside__note {
  margin: 10px 2px 0;
  color: var(--muted);
  font-size: 11.5px;
  line-height: 1.5;
}

.app-main {
  flex: 1;
  min-width: 0;
}

.app-main__inner {
  max-width: 1120px;
  margin: 0 auto;
  padding: 26px 30px 56px;
}

.update-versions {
  margin: 0 0 10px;
  font-size: 14px;
}

.update-arrow {
  margin: 0 8px;
  color: var(--muted);
}

.update-latest {
  color: var(--el-color-primary);
  font-weight: 600;
}

.update-hint {
  margin: 0;
  color: var(--ink-soft);
  font-size: 13px;
  line-height: 1.8;
}

.update-progress {
  margin: 0;
  color: var(--el-color-primary);
  font-size: 13px;
}

.update-steps {
  margin: 10px 0 0;
  padding-left: 18px;
  color: var(--ink-soft);
  font-size: 12.5px;
  line-height: 1.9;
}

@media (max-width: 860px) {
  .app-shell {
    flex-direction: column;
  }
  .app-aside {
    width: 100%;
    border-right: none;
    border-bottom: 1px solid var(--line);
  }

  .app-brand {
    padding: 14px 16px 10px;
  }

  .app-nav {
    display: flex;
    overflow-x: auto;
    flex: none;
  }

  .app-nav :deep(.el-menu-item) {
    flex-shrink: 0;
    margin: 0 4px 8px;
  }

  .app-aside__foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 16px;
  }

  .lock-button {
    width: auto;
  }

  .app-aside__note {
    margin: 0;
  }

  .app-main__inner {
    padding: 18px 16px 48px;
  }
}
</style>
