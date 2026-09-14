<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Calendar, FolderOpened, Lock, Odometer, Setting, Van } from '@element-plus/icons-vue'
import { siteConfig } from '../config'
import { lockVault } from '../services/vault'

const route = useRoute()
const router = useRouter()
const active = computed(() => route.path)

async function lockNow(): Promise<void> {
  lockVault()
  await router.replace({ name: 'unlock' })
  ElMessage.success('保险库已锁定，数据密钥已从内存清除')
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
