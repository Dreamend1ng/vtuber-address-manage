<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import { lockVault, touchActivity, vaultState } from './services/vault'
import { clearRecords, loadRecords } from './services/records'

const router = useRouter()

watch(
  () => vaultState.status,
  (status, previous) => {
    if (status === 'unlocked' && previous !== 'unlocked') {
      void loadRecords()
    }
    if (status !== 'unlocked') {
      clearRecords()
    }
  },
  { immediate: true },
)

let timer: ReturnType<typeof setInterval> | undefined

/** 检查模式：每 30 分钟检查一次，检查时刻前 1 分钟内有操作就不锁定 */
const AUTO_LOCK_CHECK_INTERVAL_MS = 30 * 60 * 1000
const AUTO_LOCK_CHECK_WINDOW_MS = 60 * 1000
let nextCheckAt = 0

function lockWithMessage(reason: string): void {
  lockVault()
  clearRecords()
  void router.replace({ name: 'unlock' })
  ElMessage.warning(reason)
}

function checkAutoLock(): void {
  if (vaultState.status !== 'unlocked') {
    nextCheckAt = 0
    return
  }
  const now = Date.now()

  if (vaultState.autoLockMode === 'interval') {
    if (nextCheckAt === 0) {
      nextCheckAt = now + AUTO_LOCK_CHECK_INTERVAL_MS
      return
    }
    if (now < nextCheckAt) return
    nextCheckAt = now + AUTO_LOCK_CHECK_INTERVAL_MS
    if (now - vaultState.lastActivity > AUTO_LOCK_CHECK_WINDOW_MS) {
      lockWithMessage('检查时最近 1 分钟没有操作，保险库已锁定')
    }
    return
  }

  nextCheckAt = 0
  if (vaultState.autoLockMinutes <= 0) return
  if (now - vaultState.lastActivity > vaultState.autoLockMinutes * 60_000) {
    lockWithMessage('长时间未操作，保险库已自动锁定')
  }
}

function handleActivity(): void {
  if (vaultState.status === 'unlocked') touchActivity()
}

onMounted(() => {
  timer = setInterval(checkAutoLock, 10_000)
  window.addEventListener('pointerdown', handleActivity)
  window.addEventListener('keydown', handleActivity)
})

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
  window.removeEventListener('pointerdown', handleActivity)
  window.removeEventListener('keydown', handleActivity)
})
</script>

<template>
  <el-config-provider :locale="zhCn">
    <router-view />
  </el-config-provider>
</template>
