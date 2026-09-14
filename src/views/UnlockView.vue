<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { siteConfig } from '../config'
import { recoverVault, unlockVault } from '../services/vault'
import { formatRecoveryCode, isRecoveryCodeComplete } from '../crypto/recovery'

const router = useRouter()

const mode = ref<'password' | 'recovery'>('password')
const password = ref('')
const busy = ref(false)
const errorMessage = ref('')

const recoveryCode = ref('')
const newPassword = ref('')
const confirmPassword = ref('')

const recoveryComplete = computed(() => isRecoveryCodeComplete(recoveryCode.value))
const newPasswordValid = computed(() => newPassword.value.length >= 8)
const confirmValid = computed(
  () => confirmPassword.value !== '' && confirmPassword.value === newPassword.value,
)

function switchMode(next: 'password' | 'recovery'): void {
  mode.value = next
  errorMessage.value = ''
}

async function unlock(): Promise<void> {
  if (password.value === '' || busy.value) return
  busy.value = true
  errorMessage.value = ''
  try {
    await unlockVault(password.value)
    password.value = ''
    ElMessage.success('已解锁')
    await router.replace({ name: 'dashboard' })
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '解锁失败'
  } finally {
    busy.value = false
  }
}

function handleRecoveryInput(value: string): void {
  recoveryCode.value = formatRecoveryCode(value)
}

async function recover(): Promise<void> {
  if (!recoveryComplete.value || !newPasswordValid.value || !confirmValid.value || busy.value) return
  busy.value = true
  errorMessage.value = ''
  try {
    await recoverVault(recoveryCode.value, newPassword.value)
    recoveryCode.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
    ElMessage.success('已通过恢复码重设主密码并解锁')
    await router.replace({ name: 'dashboard' })
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '恢复失败'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="auth-screen">
    <div>
      <div class="auth-card">
        <div class="airmail-stripe" />
        <div class="auth-card__body">
          <div class="auth-brand">
            <span class="auth-brand__name">{{ siteConfig.appName }}</span>
            <span class="auth-brand__en">{{ siteConfig.appNameEn }}</span>
          </div>
          <p class="auth-tagline">{{ siteConfig.tagline }}</p>

          <template v-if="mode === 'password'">
            <el-form class="unlock-form" label-position="top" @submit.prevent="unlock">
              <el-form-item label="主密码">
                <el-input
                  v-model="password"
                  type="password"
                  show-password
                  size="large"
                  placeholder="输入主密码解锁"
                  autocomplete="current-password"
                  autofocus
                  @keyup.enter="unlock"
                />
              </el-form-item>
            </el-form>
            <p v-if="errorMessage" class="unlock-error">{{ errorMessage }}</p>
            <el-button type="primary" size="large" class="auth-action" :loading="busy" @click="unlock">
              解锁
            </el-button>
            <div class="unlock-links">
              <el-link type="primary" :underline="false" @click="switchMode('recovery')">
                忘记主密码？使用恢复码重设
              </el-link>
            </div>
          </template>

          <template v-else>
            <p class="recovery-lead">
              输入创建保险库时保存的恢复码，并设置一个新的主密码。恢复码本身保持不变，仍可继续使用。
            </p>
            <el-form label-position="top" @submit.prevent="recover">
              <el-form-item label="恢复码">
                <el-input
                  :model-value="recoveryCode"
                  class="mono"
                  placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                  autocomplete="off"
                  spellcheck="false"
                  @update:model-value="handleRecoveryInput"
                />
              </el-form-item>
              <el-form-item label="新的主密码">
                <el-input
                  v-model="newPassword"
                  type="password"
                  show-password
                  placeholder="至少 8 位"
                  autocomplete="new-password"
                />
              </el-form-item>
              <el-form-item label="再输入一次">
                <el-input
                  v-model="confirmPassword"
                  type="password"
                  show-password
                  placeholder="确认新密码"
                  autocomplete="new-password"
                  @keyup.enter="recover"
                />
              </el-form-item>
            </el-form>
            <p v-if="errorMessage" class="unlock-error">{{ errorMessage }}</p>
            <el-button
              type="primary"
              size="large"
              class="auth-action"
              :disabled="!recoveryComplete || !newPasswordValid || !confirmValid"
              :loading="busy"
              @click="recover"
            >
              用恢复码解锁
            </el-button>
            <div class="unlock-links">
              <el-link type="primary" :underline="false" @click="switchMode('password')">
                返回密码解锁
              </el-link>
            </div>
          </template>
        </div>
      </div>
      <p class="auth-footer">主密码不会被保存，只在本机参与密钥计算</p>
    </div>
  </div>
</template>

<style scoped>
.unlock-form {
  margin-top: 22px;
}

.recovery-lead {
  margin: 20px 0 14px;
  font-size: 13px;
  color: var(--ink-soft);
}

.auth-action {
  width: 100%;
  margin-top: 2px;
}

.unlock-error {
  margin: 0 0 12px;
  color: var(--stamp-red);
  font-size: 13px;
}

.unlock-links {
  margin-top: 14px;
  text-align: center;
}
</style>
