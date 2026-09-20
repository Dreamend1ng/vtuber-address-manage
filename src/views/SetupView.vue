<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { siteConfig } from '../config'
import { setupVault } from '../services/vault'
import { saveCollectionSettings } from '../services/records'
import { testCollection } from '../services/events'
import { isValidRepo, normalizeRepo } from '../services/github'
import { copyText } from '../utils/clipboard'
import { downloadText, timestampForFilename } from '../utils/download'

const router = useRouter()

const step = ref(0)
const password = ref('')
const confirmPassword = ref('')
const busy = ref(false)
const recoveryCode = ref('')
const savedConfirmed = ref(false)

const passwordValid = computed(() => password.value.length >= 8)
const confirmValid = computed(
  () => confirmPassword.value !== '' && confirmPassword.value === password.value,
)
const strength = computed(() => {
  const value = password.value
  if (value.length === 0) return 0
  let score = 0
  if (value.length >= 8) score += 1
  if (value.length >= 12) score += 1
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1
  if (/\d/.test(value)) score += 1
  if (/[^A-Za-z0-9]/.test(value)) score += 1
  return Math.min(score, 4)
})
const strengthLabel = computed(() => ['太弱', '较弱', '一般', '较强', '很强'][strength.value])

async function createVault(): Promise<void> {
  if (!passwordValid.value || !confirmValid.value || busy.value) return
  busy.value = true
  try {
    const result = await setupVault(password.value)
    recoveryCode.value = result.recoveryCode
    step.value = 1
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '创建保险库失败')
  } finally {
    busy.value = false
  }
}

async function copyRecoveryCode(): Promise<void> {
  await copyText(recoveryCode.value)
  ElMessage.success('恢复码已复制，请粘贴到密码管理器或离线保存')
}

function downloadRecoveryCode(): void {
  downloadText(
    `${siteConfig.appName}-恢复码-${timestampForFilename()}.txt`,
    [
      `${siteConfig.appName} 恢复码`,
      '======================================',
      recoveryCode.value,
      '======================================',
      '忘记主密码时，用此恢复码重设密码并恢复全部数据。',
      '请离线保存（打印、手抄或密码管理器），不要拍照后上传到网盘、聊天软件等任何在线位置。',
    ].join('\n'),
  )
}

function finishSetup(): void {
  if (!savedConfirmed.value) return
  step.value = 2
}

/* 第 3 步：全局收集仓库 */
const collecting = reactive({ repo: '', branch: 'main', token: '' })
const testingRepo = ref(false)
const savingRepo = ref(false)

async function testRepo(): Promise<void> {
  if (collecting.repo.trim() === '' || collecting.token.trim() === '') {
    ElMessage.warning('请先填写仓库和 Token')
    return
  }
  testingRepo.value = true
  try {
    const info = await testCollection(collecting.repo, collecting.token)
    ElMessage.success(`连接成功：${info}`)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '连接失败')
  } finally {
    testingRepo.value = false
  }
}

async function finishWithRepo(): Promise<void> {
  const repo = normalizeRepo(collecting.repo)
  if (repo === '' || collecting.token.trim() === '') {
    ElMessage.warning('请填写仓库和 Token，或点击「稍后配置」跳过')
    return
  }
  if (!isValidRepo(repo)) {
    ElMessage.warning('仓库格式不正确，应为 owner/name，例如 yourname/vam-collect')
    return
  }
  savingRepo.value = true
  try {
    await saveCollectionSettings({
      repo,
      branch: collecting.branch.trim() || 'main',
      token: collecting.token.trim(),
    })
    collecting.repo = repo
    ElMessage.success('收集仓库已保存，之后所有活动都会使用它')
    step.value = 3
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败')
  } finally {
    savingRepo.value = false
  }
}

function skipRepo(): void {
  step.value = 3
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

          <el-steps
            class="setup-steps"
            :active="step"
            simple
            :space="0"
          >
            <el-step title="设置主密码" />
            <el-step title="保存恢复码" />
            <el-step title="收集仓库" />
            <el-step title="完成" />
          </el-steps>

          <!-- 第 1 步：主密码 -->
          <div v-if="step === 0" class="setup-section">
            <el-form label-position="top" @submit.prevent="createVault">
              <el-form-item label="主密码">
                <el-input
                  v-model="password"
                  type="password"
                  show-password
                  placeholder="至少 8 位"
                  autocomplete="new-password"
                  @keyup.enter="createVault"
                />
                <div v-if="password" class="strength">
                  <span class="strength__track">
                    <span
                      class="strength__bar"
                      :style="{ width: `${(strength / 4) * 100}%` }"
                      :data-level="strength"
                    />
                  </span>
                  <span class="strength__label">{{ strengthLabel }}</span>
                </div>
              </el-form-item>
              <el-form-item label="再输入一次">
                <el-input
                  v-model="confirmPassword"
                  type="password"
                  show-password
                  placeholder="确认主密码"
                  autocomplete="new-password"
                  @keyup.enter="createVault"
                />
                <div v-if="confirmPassword && !confirmValid" class="form-hint form-hint--warn">
                  两次输入的密码不一致
                </div>
              </el-form-item>
            </el-form>

            <div class="notice">
              <p>
                主密码只用于在本机派生加密密钥，不会被保存，也无法找回。下一步会生成一次性的
                <strong>恢复码</strong>，那是忘记密码后唯一的补救方式。
              </p>
            </div>

            <el-button
              type="primary"
              class="auth-action"
              size="large"
              :disabled="!passwordValid || !confirmValid"
              :loading="busy"
              @click="createVault"
            >
              创建加密保险库
            </el-button>
          </div>

          <!-- 第 2 步：恢复码 -->
          <div v-else-if="step === 1" class="setup-section">
            <p class="setup-lead">
              请立即抄写或下载恢复码。它只显示这一次，离开此页面后就无法再次查看。
            </p>
            <div class="recovery-box mono">{{ recoveryCode }}</div>
            <div class="recovery-actions">
              <el-button @click="copyRecoveryCode">复制恢复码</el-button>
              <el-button @click="downloadRecoveryCode">下载为文本文件</el-button>
            </div>
            <el-checkbox v-model="savedConfirmed" class="recovery-confirm">
              我已把恢复码保存在离线、安全的地方
            </el-checkbox>
            <el-button
              type="primary"
              class="auth-action"
              size="large"
              :disabled="!savedConfirmed"
              @click="finishSetup"
            >
              下一步
            </el-button>
          </div>

          <!-- 第 3 步：全局收集仓库 -->
          <div v-else-if="step === 2" class="setup-section">
            <p class="setup-lead">
              配置一个 GitHub 专用私有仓库作为粉丝表单的收集通道，之后所有活动共用。也可以稍后在「设置」里再配。
            </p>
            <el-form label-position="top" @submit.prevent="finishWithRepo">
              <el-form-item label="仓库（owner/name）">
                <el-input v-model="collecting.repo" placeholder="例如：yourname/vam-collect" spellcheck="false" />
              </el-form-item>
              <div class="setup-grid">
                <el-form-item label="分支">
                  <el-input v-model="collecting.branch" placeholder="main" spellcheck="false" />
                </el-form-item>
                <el-form-item label="Token">
                  <el-input
                    v-model="collecting.token"
                    type="password"
                    show-password
                    placeholder="github_pat_..."
                    spellcheck="false"
                  />
                </el-form-item>
              </div>
            </el-form>
            <div class="setup-actions setup-actions--inline">
              <el-button text :loading="testingRepo" @click="testRepo">测试连接</el-button>
            </div>
            <div class="setup-actions">
              <el-button
                type="primary"
                size="large"
                class="auth-action setup-primary"
                :loading="savingRepo"
                @click="finishWithRepo"
              >
                保存并完成
              </el-button>
              <el-button size="large" @click="skipRepo">稍后配置</el-button>
            </div>
            <p class="setup-note">
              还没有仓库或 Token？
              <a href="https://github.com/new" target="_blank" rel="noopener noreferrer">新建私有仓库</a>
              ·
              <a
                href="https://github.com/settings/personal-access-tokens/new"
                target="_blank"
                rel="noopener noreferrer"
              >创建 fine-grained Token</a>
              <br />
              Token 只需勾选该仓库的 Contents: Read and write。收集链接会携带它，所以务必使用专用仓库。
              <br />
              如果「测试连接」提示无法连接 GitHub，通常是当前网络拦截了 api.github.com，请更换网络或配置代理。
            </p>
          </div>

          <!-- 第 4 步：完成 -->
          <div v-else class="setup-section">
            <h2 class="done-title">保险库已就绪</h2>
            <ul class="done-list">
              <li>地址与活动信息会以 AES-256-GCM 加密后保存在这台设备的浏览器中。</li>
              <li>离开电脑前可手动锁定；长时间无操作也会自动锁定。</li>
              <li>浏览器数据可能被清理，请定期到「备份 / 恢复」页导出加密备份。</li>
            </ul>
            <el-button type="primary" class="auth-action" size="large" @click="router.replace({ name: 'dashboard' })">
              进入{{ siteConfig.appName }}
            </el-button>
          </div>
        </div>
      </div>
      <p class="auth-footer">
        所有数据仅加密保存在本机浏览器 · 不会上传到任何服务器
      </p>
    </div>
  </div>
</template>

<style scoped>
.setup-steps {
  margin: 22px 0 4px;
  --el-color-primary: var(--airmail-blue);
  border-radius: 8px;
  overflow: hidden;
}

.setup-section {
  padding-top: 14px;
}

.setup-lead {
  margin: 4px 0 14px;
  color: var(--ink-soft);
  font-size: 13.5px;
}

.strength {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin-top: 6px;
}

.strength__track {
  flex: 1;
  height: 4px;
  border-radius: 2px;
  background: var(--line);
  overflow: hidden;
}

.strength__bar {
  display: block;
  height: 100%;
  border-radius: 2px;
  background: var(--stamp-red);
  transition: width 0.2s ease;
}

.strength__bar[data-level='2'] {
  background: var(--stamp-amber);
}

.strength__bar[data-level='3'] {
  background: var(--airmail-blue);
}

.strength__bar[data-level='4'] {
  background: var(--stamp-green);
}

.strength__label {
  font-size: 12px;
  color: var(--muted);
  min-width: 28px;
}

.form-hint {
  font-size: 12px;
  color: var(--muted);
  line-height: 1.6;
}

.form-hint--warn {
  color: var(--stamp-red);
}

.notice {
  margin: 2px 0 18px;
  padding: 12px 14px;
  border: 1px dashed var(--line-strong);
  border-radius: 8px;
  background: #f8fafd;
  color: var(--ink-soft);
  font-size: 12.5px;
}

.notice p {
  margin: 0;
}

.auth-action {
  width: 100%;
}

.recovery-box {
  padding: 16px;
  border: 1px dashed var(--line-strong);
  border-radius: 8px;
  background: #f8fafd;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-align: center;
  word-break: break-all;
  user-select: all;
}

.recovery-actions {
  display: flex;
  gap: 8px;
  margin: 12px 0 6px;
}

.recovery-confirm {
  display: flex;
  margin: 10px 0 16px;
  height: auto;
  white-space: normal;
}

.recovery-confirm :deep(.el-checkbox__label) {
  white-space: normal;
  line-height: 1.5;
}

.done-title {
  margin: 8px 0 10px;
  font-size: 18px;
}

.done-list {
  margin: 0 0 20px;
  padding-left: 18px;
  color: var(--ink-soft);
  font-size: 13px;
}

.done-list li {
  margin-bottom: 6px;
}

.setup-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 14px;
}

.setup-actions {
  display: flex;
  gap: 10px;
  margin-top: 4px;
}

.setup-actions--inline {
  margin-top: -4px;
  margin-bottom: 4px;
}

.setup-primary {
  width: auto;
  flex: 1;
}

.setup-note {
  margin: 12px 0 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}

@media (max-width: 640px) {
  .setup-grid {
    grid-template-columns: 1fr;
  }
}
</style>
