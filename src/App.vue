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

function checkAutoLock(): void {
  if (vaultState.status !== 'unlocked' || vaultState.autoLockMinutes <= 0) return
  if (Date.now() - vaultState.lastActivity > vaultState.autoLockMinutes * 60_000) {
    lockVault()
    clearRecords()
    void router.replace({ name: 'unlock' })
    ElMessage.warning('长时间未操作，保险库已自动锁定')
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
