<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { FormInstance, FormRules } from 'element-plus'
import { siteConfig } from '../config'
import { addresses, collectionSettings, saveCollectionSettings, saveUpdateSettings, updateSettings } from '../services/records'
import { testCollection } from '../services/events'
import { checkForUpdate, defaultUpstream, detectOwnRepo, showUpdateNotice } from '../services/updater'
import { isValidRepo, normalizeRepo } from '../services/github'
import {
  changePassword,
  regenerateRecoveryCode,
  updatePrefs,
  vaultState,
  wipeVault,
} from '../services/vault'
import { copyText } from '../utils/clipboard'
import { downloadText, timestampForFilename } from '../utils/download'
import { formatDateTime } from '../utils/format'

const router = useRouter()

const shippedCount = computed(() => addresses.value.filter((address) => address.shippedAt).length)

/* ---------- 收集仓库（全局） ---------- */
const collect = reactive({ repo: '', branch: 'main', token: '' })
const savingCollect = ref(false)
const testingCollection = ref(false)

watch(
  collectionSettings,
  (value) => {
    if (!value) return
    collect.repo = value.repo
    collect.branch = value.branch || 'main'
    collect.token = value.token
  },
  { immediate: true },
)

async function saveCollect(): Promise<void> {
  const repo = normalizeRepo(collect.repo)
  if (!isValidRepo(repo)) {
    ElMessage.warning('仓库格式不正确，应为 owner/name，例如 yourname/vam-collect')
    return
  }
  if (collect.token.trim() === '') {
    ElMessage.warning('请填写 Token')
    return
  }
  savingCollect.value = true
  try {
    await saveCollectionSettings({
      repo,
      branch: collect.branch.trim() || 'main',
      token: collect.token.trim(),
      recordAntiAbuse: collectionSettings.value?.recordAntiAbuse ?? true,
    })
    collect.repo = repo
    ElMessage.success('收集仓库已保存，所有活动立即生效')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败')
  } finally {
    savingCollect.value = false
  }
}

const antiAbuse = computed({
  get: () => collectionSettings.value?.recordAntiAbuse !== false,
  set: (value: boolean) => {
    void applyAntiAbuse(value)
  },
})

async function applyAntiAbuse(value: boolean): Promise<void> {
  const current = collectionSettings.value
  if (!current) {
    ElMessage.warning('请先填写并保存仓库和 Token')
    return
  }
  await saveCollectionSettings({
    repo: current.repo,
    branch: current.branch,
    token: current.token,
    recordAntiAbuse: value,
  })
  ElMessage.success(value ? '将记录提交者 IP 与设备信息' : '已关闭 IP 与设备信息收集')
}

/* ---------- 版本更新 ---------- */
const updateForm = reactive({ upstream: defaultUpstream(), ownRepo: detectOwnRepo(), token: '' })
const savingUpdate = ref(false)
const checkingUpdate = ref(false)

watch(
  updateSettings,
  (value) => {
    if (!value) return
    updateForm.upstream = value.upstream || defaultUpstream()
    updateForm.ownRepo = value.ownRepo || detectOwnRepo()
    updateForm.token = value.token
  },
  { immediate: true },
)

const updateEnabled = computed({
  get: () => updateSettings.value?.enabled === true,
  set: (value: boolean) => {
    void saveUpdateForm(value, value ? '已开启更新检查' : '已关闭更新检查')
  },
})

async function saveUpdateForm(enabled: boolean, message: string): Promise<void> {
  savingUpdate.value = true
  try {
    await saveUpdateSettings({
      enabled,
      upstream: updateForm.upstream.trim() || defaultUpstream(),
      ownRepo: normalizeRepo(updateForm.ownRepo),
      token: updateForm.token.trim(),
    })
    updateForm.ownRepo = normalizeRepo(updateForm.ownRepo)
    ElMessage.success(message)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败')
  } finally {
    savingUpdate.value = false
  }
}

async function saveUpdate(): Promise<void> {
  await saveUpdateForm(updateSettings.value?.enabled === true, '更新设置已保存')
}

async function checkNow(): Promise<void> {
  checkingUpdate.value = true
  try {
    const info = await checkForUpdate(updateForm.upstream || defaultUpstream())
    if (!info) {
      ElMessage.warning('无法获取上游版本信息，请检查网络后重试')
      return
    }
    if (!info.hasUpdate) {
      ElMessage.success(`当前已是最新版本 v${info.currentVersion}`)
      return
    }
    showUpdateNotice(info)
  } finally {
    checkingUpdate.value = false
  }
}

async function testConnection(): Promise<void> {
  if (collect.repo.trim() === '' || collect.token.trim() === '') {
    ElMessage.warning('请先填写仓库和 Token')
    return
  }
  testingCollection.value = true
  try {
    const info = await testCollection(collect.repo, collect.token)
    ElMessage.success(`连接成功：${info}`)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '连接失败')
  } finally {
    testingCollection.value = false
  }
}

/* ---------- 修改主密码 ---------- */
const passwordDialog = ref(false)
const passwordForm = reactive({ current: '', next: '', confirm: '' })
const passwordSaving = ref(false)
const passwordFormRef = ref<FormInstance>()

const passwordRules: FormRules = {
  current: [{ required: true, message: '请输入当前主密码', trigger: 'blur' }],
  next: [
    { required: true, message: '请输入新主密码', trigger: 'blur' },
    { min: 8, message: '新主密码至少 8 位', trigger: 'blur' },
  ],
}

const confirmValid = computed(
  () => passwordForm.confirm !== '' && passwordForm.confirm === passwordForm.next,
)

async function submitPasswordChange(): Promise<void> {
  const instance = passwordFormRef.value
  if (!instance) return
  const valid = await instance.validate().catch(() => false)
  if (!valid || !confirmValid.value) return
  passwordSaving.value = true
  try {
    await changePassword(passwordForm.current, passwordForm.next)
    ElMessage.success('主密码已更新，恢复码保持不变')
    passwordDialog.value = false
    passwordForm.current = ''
    passwordForm.next = ''
    passwordForm.confirm = ''
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '修改失败')
  } finally {
    passwordSaving.value = false
  }
}

/* ---------- 重新生成恢复码 ---------- */
const regenDialog = ref(false)
const regenPassword = ref('')
const regenBusy = ref(false)
const newCodeDialog = ref(false)
const newRecoveryCode = ref('')

async function submitRegenerate(): Promise<void> {
  if (regenPassword.value === '' || regenBusy.value) return
  regenBusy.value = true
  try {
    const result = await regenerateRecoveryCode(regenPassword.value)
    newRecoveryCode.value = result.recoveryCode
    regenDialog.value = false
    regenPassword.value = ''
    newCodeDialog.value = true
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '生成失败')
  } finally {
    regenBusy.value = false
  }
}

async function copyNewCode(): Promise<void> {
  await copyText(newRecoveryCode.value)
  ElMessage.success('恢复码已复制，请离线保存')
}

function downloadNewCode(): void {
  downloadText(
    `${siteConfig.appName}-恢复码-${timestampForFilename()}.txt`,
    `${siteConfig.appName} 恢复码\n======================================\n${newRecoveryCode.value}\n======================================\n忘记主密码时，用此恢复码重设密码并恢复全部数据。请离线保存。`,
  )
}

/* ---------- 偏好设置 ---------- */
const autoLock = computed({
  get: () => {
    if (vaultState.autoLockMode === 'interval') return 'interval'
    return vaultState.autoLockMinutes === 0 ? 'never' : `idle:${vaultState.autoLockMinutes}`
  },
  set: (value: string) => {
    if (value === 'interval') {
      updatePrefs({ autoLockMode: 'interval' })
      ElMessage.success('已设为每 30 分钟检查一次：检查时刻前 1 分钟内有操作就不锁定')
      return
    }
    if (value === 'never') {
      updatePrefs({ autoLockMode: 'idle', autoLockMinutes: 0 })
      ElMessage.success('已关闭自动锁定')
      return
    }
    const minutes = Number(value.split(':')[1] ?? 15)
    updatePrefs({ autoLockMode: 'idle', autoLockMinutes: minutes })
    ElMessage.success(`已设为 ${minutes} 分钟无操作后自动锁定`)
  },
})

const clipboardClear = computed({
  get: () => vaultState.clipboardClearSeconds,
  set: (value: number) => {
    updatePrefs({ clipboardClearSeconds: value })
    ElMessage.success(value === 0 ? '复制后不再自动清空剪贴板' : `复制后 ${value} 秒自动清空剪贴板`)
  },
})

const autoLockOptions = [
  { label: '1 分钟无操作', value: 'idle:1' },
  { label: '5 分钟无操作', value: 'idle:5' },
  { label: '15 分钟无操作', value: 'idle:15' },
  { label: '30 分钟无操作', value: 'idle:30' },
  { label: '60 分钟无操作', value: 'idle:60' },
  { label: '每 30 分钟检查一次', value: 'interval' },
  { label: '永不自动锁定', value: 'never' },
]

const clipboardOptions = [
  { label: '15 秒', value: 15 },
  { label: '30 秒', value: 30 },
  { label: '60 秒', value: 60 },
  { label: '120 秒', value: 120 },
  { label: '不自动清空', value: 0 },
]

/* ---------- 清空数据 ---------- */
async function wipeData(): Promise<void> {
  try {
    await ElMessageBox.prompt(
      '此操作会永久删除本机全部地址与活动，无法撤销。如果还没有备份，请先到「备份 / 恢复」页导出加密备份。',
      '清空所有数据',
      {
        type: 'error',
        confirmButtonText: '永久删除',
        cancelButtonText: '取消',
        inputPlaceholder: '输入「删除所有数据」以确认',
        inputValidator: (value: string) => value === '删除所有数据' || '请输入完整的确认短语',
        confirmButtonClass: 'el-button--danger',
      },
    )
  } catch {
    return
  }
  await wipeVault()
  await router.replace({ name: 'setup' })
  ElMessage.success('本机数据已全部清空')
}
</script>

<template>
  <div>
    <header class="page-header">
      <div>
        <h1 class="page-title">设置</h1>
        <p class="page-desc">管理收集仓库、主密码、恢复码与数据安全选项。</p>
      </div>
    </header>

    <section class="panel panel-pad">
      <h2 class="panel-title">收集仓库</h2>
      <p class="panel-desc">
        所有活动的粉丝表单共用这个 GitHub 专用私有仓库：生成链接、发布表单、同步提交都使用它，配置一次即可，创建新活动时无需重复填写。
      </p>
      <el-form label-position="top" class="collect-form">
        <el-form-item label="仓库（owner/name）">
          <el-input v-model="collect.repo" placeholder="例如：yourname/vam-collect" spellcheck="false" />
        </el-form-item>
        <div class="collect-grid">
          <el-form-item label="分支">
            <el-input v-model="collect.branch" placeholder="main" spellcheck="false" />
          </el-form-item>
          <el-form-item label="Token">
            <el-input
              v-model="collect.token"
              type="password"
              show-password
              placeholder="github_pat_..."
              spellcheck="false"
            />
          </el-form-item>
        </div>
      </el-form>
      <div class="collect-actions">
        <el-button type="primary" :loading="savingCollect" @click="saveCollect">保存</el-button>
        <el-button :loading="testingCollection" @click="testConnection">测试连接</el-button>
        <span v-if="collectionSettings" class="collect-updated">
          上次更新 {{ formatDateTime(collectionSettings.updatedAt) }}
        </span>
      </div>
      <p class="collect-links">
        还没有仓库或 Token？
        <a href="https://github.com/new" target="_blank" rel="noopener noreferrer">新建私有仓库</a>
        ·
        <a
          href="https://github.com/settings/personal-access-tokens/new"
          target="_blank"
          rel="noopener noreferrer"
        >创建 fine-grained Token</a>
      </p>
      <p class="collect-links">
        连接失败时：提示「无法连接 GitHub」通常是当前网络拦截了 api.github.com，请更换网络或配置代理；仓库名或 Token 的问题会显示为单独的提示。仓库地址可以直接粘贴 GitHub 页面地址，会自动整理。
      </p>
      <div class="anti-abuse-row">
        <div class="setting-info">
          <span class="setting-label">记录提交者 IP 与设备信息</span>
          <span class="setting-desc">
            表单提交时采集网络地址、设备指纹与 User-Agent（全部进加密信封），用于防止捣乱与事后溯源；粉丝端会显示对应的同意文案。
            修改后需要回到活动里重新「发布表单」才会生效。
          </span>
        </div>
        <el-switch v-model="antiAbuse" :disabled="!collectionSettings" aria-label="记录提交者 IP 与设备信息" />
      </div>

      <el-alert type="warning" :closable="false" class="collect-alert">
        <template #title>安全说明</template>
        <p>
          收集链接里会携带这个 Token（粉丝浏览器需要它写入仓库），因此请务必使用<strong>专用私有仓库 + 专用 Token</strong>，不要授权到主仓库。提交内容已用各活动的公钥加密，即使 Token 或仓库泄漏，地址也无法被他人读取；活动结束后可以在 GitHub 上直接吊销 Token。
        </p>
      </el-alert>
    </section>

    <section class="panel panel-pad">
      <h2 class="panel-title">版本更新</h2>
      <p class="panel-desc">
        开启后每次解锁会检查上游是否有新版本。配置更新 Token 可以直接一键更新自己的站点。更新只同步代码，不影响本机数据与收集仓库。
      </p>

      <div class="anti-abuse-row">
        <div class="setting-info">
          <span class="setting-label">开启更新检查</span>
          <span class="setting-desc">关闭后不再请求上游版本信息，仍可手动点「检查更新」。</span>
        </div>
        <el-switch v-model="updateEnabled" :loading="savingUpdate" aria-label="开启更新检查" />
      </div>

      <el-form label-position="top" class="collect-form">
        <el-form-item label="上游仓库">
          <el-input v-model="updateForm.upstream" placeholder="Dreamend1ng/vtuber-address-manage" spellcheck="false" />
        </el-form-item>
        <el-form-item label="你的站点仓库">
          <el-input
            v-model="updateForm.ownRepo"
            placeholder="你的用户名/仓库名（部署在 GitHub Pages 时会自动识别）"
            spellcheck="false"
          />
        </el-form-item>
        <el-form-item label="更新 Token（选填）">
          <el-input v-model="updateForm.token" type="password" show-password placeholder="github_pat_..." spellcheck="false" />
        </el-form-item>
      </el-form>

      <div class="collect-actions">
        <el-button type="primary" :loading="savingUpdate" @click="saveUpdate">保存</el-button>
        <el-button :loading="checkingUpdate" @click="checkNow">检查更新</el-button>
        <span class="collect-updated">当前版本 v{{ siteConfig.version }}</span>
      </div>

      <p class="collect-links">
        还没有更新 Token？
        <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">
          创建 fine-grained Token
        </a>
        ：Repository access 只勾选<strong>你自己的站点仓库</strong>（不是收集仓库），权限只需 <strong>Contents: Read and write</strong>。
      </p>

      <el-alert type="info" :closable="false" class="collect-alert">
        <template #title>一键更新会做什么</template>
        <p>
          对比上游与你的仓库，只同步有变化的代码文件并提交一次，由 GitHub Actions 自动重新部署（约 1 分钟）。
          <strong>docs/、README、TUTORIAL 不会被同步</strong>；你改过的 <span class="mono">src/config.ts</span>（应用名、主题色）与网站图标会保留。
        </p>
      </el-alert>
    </section>

    <section class="panel panel-pad">
      <h2 class="panel-title">安全</h2>

      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">主密码</span>
          <span class="setting-desc">修改后恢复码保持不变，已解锁状态不受影响。</span>
        </div>
        <el-button @click="passwordDialog = true">修改主密码</el-button>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">恢复码</span>
          <span class="setting-desc">重新生成后，旧恢复码立即失效，新恢复码只显示一次。</span>
        </div>
        <el-button @click="regenDialog = true">重新生成恢复码</el-button>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">自动锁定</span>
          <span class="setting-desc">
            默认按无操作时长锁定；「每 30 分钟检查一次」指检查时刻前 1 分钟内有操作就不锁定，最长 30 分钟才锁一次。
          </span>
        </div>
        <el-select v-model="autoLock" style="width: 210px" aria-label="自动锁定">
          <el-option v-for="option in autoLockOptions" :key="option.value" :label="option.label" :value="option.value" />
        </el-select>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">剪贴板自动清除</span>
          <span class="setting-desc">复制地址后在设定时间内自动清空剪贴板内容。</span>
        </div>
        <el-select v-model="clipboardClear" style="width: 210px" aria-label="剪贴板自动清除">
          <el-option v-for="option in clipboardOptions" :key="option.value" :label="option.label" :value="option.value" />
        </el-select>
      </div>

      <div class="setting-row setting-row--last">
        <div class="setting-info">
          <span class="setting-label">加密参数</span>
          <span class="setting-desc">
            AES-256-GCM · PBKDF2-SHA256 600,000 次
            <template v-if="vaultState.meta"> · 创建于 {{ formatDateTime(vaultState.meta.createdAt) }}</template>
          </span>
        </div>
      </div>
    </section>

    <section class="panel panel-pad">
      <h2 class="panel-title">数据</h2>
      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">本机数据</span>
          <span class="setting-desc">
            {{ addresses.length }} 条地址 · 已发货 {{ shippedCount }} 条，全部为密文存储。
          </span>
        </div>
        <el-button @click="router.push({ name: 'backup' })">前往备份 / 恢复</el-button>
      </div>
      <div class="setting-row setting-row--last">
        <div class="setting-info">
          <span class="setting-label">清空所有数据</span>
          <span class="setting-desc">删除本机保险库与全部记录，操作不可撤销。</span>
        </div>
        <el-button type="danger" plain @click="wipeData">清空</el-button>
      </div>
    </section>

    <section class="panel panel-pad panel-pad--last">
      <h2 class="panel-title">关于</h2>
      <p class="about-line">
        {{ siteConfig.appName }} <span class="mono">v{{ siteConfig.version }}</span> · {{ siteConfig.tagline }}
      </p>
      <ul class="about-list">
        <li>纯前端应用：没有服务器、没有账号，托管方与任何人都拿不到你的数据。</li>
        <li>主密码只在本机参与密钥派生，不保存、不传输，连密码哈希都不落盘。</li>
        <li>安全性来自加密而非隐藏，因此全部代码公开也不影响数据安全。</li>
      </ul>
    </section>

    <!-- 修改主密码 -->
    <el-dialog v-model="passwordDialog" title="修改主密码" width="460px">
      <el-form ref="passwordFormRef" :model="passwordForm" :rules="passwordRules" label-position="top">
        <el-form-item label="当前主密码" prop="current">
          <el-input v-model="passwordForm.current" type="password" show-password autocomplete="current-password" />
        </el-form-item>
        <el-form-item label="新主密码" prop="next">
          <el-input v-model="passwordForm.next" type="password" show-password autocomplete="new-password" />
        </el-form-item>
        <el-form-item label="确认新主密码">
          <el-input
            v-model="passwordForm.confirm"
            type="password"
            show-password
            autocomplete="new-password"
            @keyup.enter="submitPasswordChange"
          />
          <div v-if="passwordForm.confirm && !confirmValid" class="form-warn">两次输入的密码不一致</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="passwordDialog = false">取消</el-button>
        <el-button
          type="primary"
          :loading="passwordSaving"
          :disabled="passwordForm.current === '' || passwordForm.next.length < 8 || !confirmValid"
          @click="submitPasswordChange"
        >
          更新主密码
        </el-button>
      </template>
    </el-dialog>

    <!-- 重新生成恢复码：验证密码 -->
    <el-dialog v-model="regenDialog" title="重新生成恢复码" width="460px">
      <p class="dialog-desc">请输入当前主密码以确认身份。生成后旧恢复码会立即失效。</p>
      <el-input
        v-model="regenPassword"
        type="password"
        show-password
        placeholder="当前主密码"
        autocomplete="current-password"
        @keyup.enter="submitRegenerate"
      />
      <template #footer>
        <el-button @click="regenDialog = false">取消</el-button>
        <el-button type="primary" :loading="regenBusy" :disabled="regenPassword === ''" @click="submitRegenerate">
          生成新恢复码
        </el-button>
      </template>
    </el-dialog>

    <!-- 新恢复码展示 -->
    <el-dialog v-model="newCodeDialog" title="新的恢复码" width="520px" :close-on-click-modal="false">
      <p class="dialog-desc">请立即抄写或下载，它只显示这一次。旧恢复码已失效。</p>
      <div class="recovery-box mono">{{ newRecoveryCode }}</div>
      <template #footer>
        <el-button @click="copyNewCode">复制</el-button>
        <el-button @click="downloadNewCode">下载为文本文件</el-button>
        <el-button type="primary" @click="newCodeDialog = false">我已保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.panel-pad {
  padding: 20px 22px;
  margin-bottom: 16px;
}

.panel-desc {
  margin: 0 0 14px;
  color: var(--ink-soft);
  font-size: 13px;
  line-height: 1.7;
  /* 中文一行约 1em/字，用 em 控制行宽；78ch 对中文太窄会造成早换行 */
  max-width: 68em;
}

.collect-form {
  max-width: 620px;
}

.collect-grid {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 0 14px;
}

.collect-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.collect-updated {
  color: var(--muted);
  font-size: 12.5px;
}

.collect-links {
  margin: 12px 0 0;
  color: var(--muted);
  font-size: 12.5px;
}

.collect-alert {
  margin-top: 16px;
  /* 与上方说明文字保持同一行宽，避免中文过早换行 */
  max-width: 68em;
}

.anti-abuse-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 14px 0;
  border-top: 1px solid var(--line);
  margin-top: 6px;
}

.collect-alert p {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.8;
}

.panel-pad--last {
  margin-bottom: 0;
}

.panel-title {
  margin: 0 0 8px;
  font-size: 15px;
  font-weight: 700;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 14px 0;
  border-bottom: 1px solid var(--line);
}

.setting-row--last {
  border-bottom: none;
  padding-bottom: 2px;
}

.setting-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.setting-label {
  font-weight: 600;
  font-size: 13.5px;
}

.setting-desc {
  color: var(--muted);
  font-size: 12.5px;
  line-height: 1.6;
}

.form-warn {
  color: var(--stamp-red);
  font-size: 12px;
  margin-top: 4px;
}

.dialog-desc {
  margin: 0 0 12px;
  color: var(--ink-soft);
  font-size: 13px;
}

.recovery-box {
  padding: 16px;
  border: 1px dashed var(--line-strong);
  border-radius: 8px;
  background: #f8fafd;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-align: center;
  word-break: break-all;
  user-select: all;
}

.about-line {
  margin: 0 0 10px;
  font-size: 13.5px;
}

.about-list {
  margin: 0;
  padding-left: 18px;
  color: var(--ink-soft);
  font-size: 12.5px;
  line-height: 1.8;
}

@media (max-width: 640px) {
  .setting-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }

  .collect-grid {
    grid-template-columns: 1fr;
  }
}
</style>
