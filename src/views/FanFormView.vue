<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { decodeUrlPayload, utf8Encode } from '../crypto/encoding'
import { encryptEnvelope } from '../crypto/envelope'
import type { FanFormConfig, SubmissionPayload } from '../types/models'
import { GithubError, getFile, putFile, type GithubTarget } from '../services/github'
import { loadAssetBlob } from '../services/assets'
import { siteConfig } from '../config'
import {
  collectDeviceInfo,
  describeDevice,
  deviceFingerprintSource,
  hashText,
  type DeviceInfo,
} from '../utils/device'
import { lookupIpInfo, type IpLookup } from '../utils/ip'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

type Phase = 'loading' | 'error' | 'ready' | 'closed' | 'done'

const route = useRoute()

const phase = ref<Phase>('loading')
const errorMessage = ref('')
const isPreview = ref(false)
const config = ref<FanFormConfig | null>(null)
const backgroundUrl = ref<string | null>(null)
const target = ref<GithubTarget | null>(null)
const formKey = ref('')
const submitting = ref(false)

/* 防捣乱溯源信息：读取配置后开始采集，全部进加密信封 */
const deviceInfo = ref<DeviceInfo | null>(null)
const ipLookup = ref<IpLookup | null>(null)
let ipPromise: Promise<IpLookup | null> | null = null

function startMetaCollection(): void {
  deviceInfo.value = collectDeviceInfo()
  ipPromise = lookupIpInfo()
  void ipPromise.then((result) => {
    ipLookup.value = result
  })
}

/** 同一链接可直接切到单号查询页（预览模式除外） */
const rawPayload = computed(() => (typeof route.query.d === 'string' ? route.query.d : ''))
const trackUrl = computed(() => (!isPreview.value && rawPayload.value ? `#/t?d=${rawPayload.value}` : ''))

const form = reactive({
  douyinId: '',
  recipientName: '',
  phone: '',
  address: '',
  consent: false,
  /** 蜜罐字段：正常粉丝不会看到，填写者视为机器人 */
  trap: '',
})

const errors = reactive<Record<string, string>>({})

const themeStyle = computed(() => ({
  '--fan-theme': config.value?.themeColor ?? '#2e4e9e',
}))

const backdropStyle = computed(() => {
  const theme = config.value?.themeColor ?? '#2e4e9e'
  if (backgroundUrl.value) {
    return {
      backgroundImage: `linear-gradient(rgba(13, 19, 33, 0.45), rgba(13, 19, 33, 0.72)), url(${backgroundUrl.value})`,
    }
  }
  return {
    backgroundImage: `radial-gradient(900px 420px at 50% -80px, ${theme}66, transparent 70%), linear-gradient(160deg, #1a2438, #0f1524)`,
  }
})

function fail(message: string): void {
  errorMessage.value = message
  phase.value = 'error'
}

function validate(): boolean {
  for (const key of Object.keys(errors)) delete errors[key]
  if (form.douyinId.trim() === '') errors.douyinId = '请填写抖音号，用于和活动主核对身份'
  if (form.recipientName.trim() === '') errors.recipientName = '请填写收件人姓名'
  const phone = form.phone.trim()
  if (phone === '') errors.phone = '请填写手机号'
  else if (!/^[\d+\-\s()]{6,20}$/.test(phone)) errors.phone = '手机号格式看起来不对'
  if (form.address.trim().length < 5) errors.address = '请填写完整的收件地址'
  if (!form.consent) errors.consent = '请先同意信息用于本次活动寄送'
  return Object.keys(errors).length === 0
}

async function load(): Promise<void> {
  const raw = route.query.d
  if (typeof raw !== 'string' || raw === '') {
    fail('链接不完整，请向活动主索取完整的收集链接')
    return
  }
  let data: {
    k?: string
    r?: string
    b?: string
    t?: string
    p?: number
    c?: Record<string, unknown>
  }
  try {
    data = decodeUrlPayload(raw)
  } catch {
    fail('链接格式无法识别，请向活动主确认')
    return
  }

  isPreview.value = data.p === 1
  try {
    if (isPreview.value) {
      const c = data.c ?? {}
      config.value = {
        v: 1,
        name: String(c.name ?? '未命名活动'),
        description: String(c.description ?? ''),
        themeColor: String(c.themeColor ?? '#2e4e9e'),
        status: c.status === 'closed' ? 'closed' : 'collecting',
        hasBackground: Boolean(c.bgId),
        publicKey: c.publicKey as JsonWebKey,
        collectMeta: c.collectMeta !== false,
        updatedAt: new Date().toISOString(),
      }
      if (typeof c.bgId === 'string') {
        const blob = await loadAssetBlob(c.bgId)
        if (blob) backgroundUrl.value = URL.createObjectURL(blob)
      }
    } else {
      if (!data.r || !data.t || !data.k) {
        fail('链接不完整，请向活动主索取完整的收集链接')
        return
      }
      formKey.value = data.k
      target.value = { repo: data.r, branch: data.b || 'main', token: data.t }
      const file = await getFile(target.value, `events/${data.k}/config.json`)
      if (!file) {
        fail('表单不存在或已被删除，请向活动主确认')
        return
      }
      config.value = JSON.parse(new TextDecoder().decode(file.bytes)) as FanFormConfig
      if (config.value.hasBackground) {
        const background = await getFile(target.value, `events/${data.k}/background.jpg`)
        if (background) {
          backgroundUrl.value = URL.createObjectURL(new Blob([background.bytes], { type: 'image/jpeg' }))
        }
      }
    }
    phase.value = config.value.status === 'closed' ? 'closed' : 'ready'
    if (config.value.collectMeta) {
      startMetaCollection()
    }
  } catch (error) {
    if (error instanceof GithubError && (error.status === 401 || error.status === 403)) {
      fail('收集链接已失效，请联系活动主更新链接')
    } else if (error instanceof GithubError) {
      fail(error.message)
    } else {
      fail('网络异常，请检查网络后重试')
    }
  }
}

onMounted(load)

async function submit(): Promise<void> {
  if (submitting.value || !config.value) return
  if (!validate()) return
  if (form.trap !== '') {
    // 疑似机器人：静默假装成功
    phase.value = 'done'
    return
  }
  const lastSubmit = Number(localStorage.getItem('dispatch-desk:last-submit') ?? 0)
  if (Date.now() - lastSubmit < 20_000) {
    errorMessage.value = '刚刚已经提交过一次，请稍等片刻再试'
    return
  }

  submitting.value = true
  errorMessage.value = ''
  try {
    const payload: SubmissionPayload = {
      douyinId: form.douyinId.trim(),
      recipientName: form.recipientName.trim(),
      phone: form.phone.trim(),
      address: form.address.trim(),
      consentAt: Date.now(),
    }
    if (config.value.collectMeta) {
      const info = deviceInfo.value ?? collectDeviceInfo()
      const network =
        ipLookup.value ?? (ipPromise ? await Promise.race([ipPromise, sleep(1500).then(() => null)]) : null)
      payload.fingerprint = await hashText(deviceFingerprintSource(info))
      payload.device = describeDevice(info)
      payload.ua = info.ua
      if (network) {
        payload.ip = network.ip
        payload.ipRegion = network.region
        payload.isp = network.isp
      }
    }
    const envelope = await encryptEnvelope(config.value.publicKey, payload)

    if (!isPreview.value && target.value) {
      const filename = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.json`
      await putFile(
        target.value,
        `events/${formKey.value}/submissions/${filename}`,
        utf8Encode(JSON.stringify(envelope)),
        `收到一份表单提交：${formKey.value}`,
      )
      localStorage.setItem('dispatch-desk:last-submit', String(Date.now()))
    } else {
      // 预览模式：只验证加密流程，不上传
      await new Promise((resolve) => setTimeout(resolve, 400))
    }
    phase.value = 'done'
  } catch (error) {
    if (error instanceof GithubError && (error.status === 401 || error.status === 403)) {
      errorMessage.value = '收集已关闭或链接已失效，请联系活动主'
    } else {
      errorMessage.value = '提交失败，请检查网络后重试'
    }
  } finally {
    submitting.value = false
  }
}

function resetForm(): void {
  form.douyinId = ''
  form.recipientName = ''
  form.phone = ''
  form.address = ''
  form.consent = false
  for (const key of Object.keys(errors)) delete errors[key]
  errorMessage.value = ''
  phase.value = 'ready'
}
</script>

<template>
  <div class="fan-screen" :style="[themeStyle, backdropStyle]">
    <div class="fan-shell">
      <!-- 加载中 -->
      <div v-if="phase === 'loading'" class="fan-card fan-card--plain">
        <p class="fan-loading">正在打开表单…</p>
      </div>

      <!-- 出错 -->
      <div v-else-if="phase === 'error'" class="fan-card fan-card--plain">
        <h1 class="fan-title">无法打开表单</h1>
        <p class="fan-error">{{ errorMessage }}</p>
      </div>

      <!-- 已停止收集 -->
      <div v-else-if="phase === 'closed'" class="fan-card fan-card--plain">
        <h1 class="fan-title">{{ config?.name }}</h1>
        <p class="fan-closed">本次活动已停止收集地址，感谢支持！</p>
      </div>

      <!-- 提交成功 -->
      <div v-else-if="phase === 'done'" class="fan-card fan-card--plain fan-result">
        <span class="fan-check" aria-hidden="true">✓</span>
        <h1 class="fan-title">提交成功</h1>
        <p class="fan-done-text">
          你的收件信息已加密发送给活动主，只有活动主能查看。如需修改，可以再次提交一份新的。
        </p>
        <p v-if="isPreview" class="fan-preview-note">当前为主播预览模式，没有真正上传。</p>
        <button class="fan-submit fan-submit--ghost" type="button" @click="resetForm">再填一份</button>
        <p v-if="trackUrl" class="fan-track-row">
          <a class="fan-track-link" :href="trackUrl">查询我的快递单号</a>
        </p>
      </div>

      <!-- 表单 -->
      <form v-else class="fan-card" novalidate @submit.prevent="submit">
        <header class="fan-head">
          <span class="fan-eyebrow">{{ siteConfig.appName }} · 收件信息收集</span>
          <h1 class="fan-title">{{ config?.name }}</h1>
          <p v-if="config?.description" class="fan-desc">{{ config.description }}</p>
        </header>

        <label class="fan-field">
          <span class="fan-label">抖音号 <em>必填</em></span>
          <input
            v-model="form.douyinId"
            class="fan-input"
            type="text"
            placeholder="用于和活动主核对身份"
            maxlength="60"
            autocomplete="off"
          />
          <span v-if="errors.douyinId" class="fan-field-error">{{ errors.douyinId }}</span>
        </label>

        <label class="fan-field">
          <span class="fan-label">收件人姓名 <em>必填</em></span>
          <input
            v-model="form.recipientName"
            class="fan-input"
            type="text"
            placeholder="真实姓名或收件称呼"
            maxlength="60"
            autocomplete="name"
          />
          <span v-if="errors.recipientName" class="fan-field-error">{{ errors.recipientName }}</span>
        </label>

        <label class="fan-field">
          <span class="fan-label">手机号 <em>必填</em></span>
          <input
            v-model="form.phone"
            class="fan-input"
            type="tel"
            inputmode="tel"
            placeholder="快递联系用"
            maxlength="20"
            autocomplete="tel"
          />
          <span v-if="errors.phone" class="fan-field-error">{{ errors.phone }}</span>
        </label>

        <label class="fan-field">
          <span class="fan-label">收件地址 <em>必填</em></span>
          <textarea
            v-model="form.address"
            class="fan-input fan-textarea"
            rows="3"
            placeholder="省 / 市 / 区 + 详细地址（街道、小区、楼栋门牌号）"
            maxlength="200"
          />
          <span v-if="errors.address" class="fan-field-error">{{ errors.address }}</span>
        </label>

        <label class="fan-consent">
          <input v-model="form.consent" type="checkbox" class="fan-checkbox" />
          <span v-if="config?.collectMeta">
            我同意以上信息及提交设备的网络地址、设备信息（用于防恶意提交与核对），仅用于本次活动寄送，活动主可随时删除。
          </span>
          <span v-else>我同意以上信息仅用于本次活动周边的寄送，收到后可由活动主删除。</span>
        </label>
        <span v-if="errors.consent" class="fan-field-error">{{ errors.consent }}</span>

        <!-- 蜜罐字段：对正常访客隐藏 -->
        <input
          v-model="form.trap"
          class="fan-trap"
          type="text"
          tabindex="-1"
          autocomplete="off"
          aria-hidden="true"
        />

        <p v-if="errorMessage" class="fan-submit-error">{{ errorMessage }}</p>

        <button class="fan-submit" type="submit" :disabled="submitting">
          {{ submitting ? '正在加密提交…' : '提交收件信息' }}
        </button>
        <p class="fan-foot">信息会先在本机加密，只有活动主持有密钥可以查看。</p>
        <p v-if="trackUrl" class="fan-foot">
          <a class="fan-track-link" :href="trackUrl">已填写过？查询我的快递单号</a>
        </p>
      </form>
    </div>
  </div>
</template>

<style scoped>
.fan-screen {
  min-height: 100vh;
  padding: 32px 16px 48px;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  background-color: #0f1524;
  background-size: cover;
  background-position: center;
  background-attachment: fixed;
  font-family: var(--font-sans);
}

.fan-shell {
  width: 100%;
  max-width: 440px;
  margin-top: 4vh;
}

.fan-card {
  background: #ffffff;
  border-radius: 18px;
  padding: 26px 24px 24px;
  box-shadow: 0 30px 70px -30px rgba(0, 0, 0, 0.6);
  animation: fan-rise 0.32s ease-out;
}

.fan-card--plain {
  text-align: center;
  padding: 40px 24px;
}

@keyframes fan-rise {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .fan-card {
    animation: none;
  }
}

.fan-head {
  margin-bottom: 20px;
}

.fan-eyebrow {
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.16em;
  color: #8a93a6;
  display: block;
  margin-bottom: 6px;
}

.fan-title {
  margin: 0 0 6px;
  font-size: 22px;
  font-weight: 800;
  color: #16233b;
  letter-spacing: 0.01em;
  line-height: 1.35;
}

.fan-desc {
  margin: 0;
  color: #5c6a83;
  font-size: 13.5px;
  line-height: 1.7;
}

.fan-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 16px;
}

.fan-label {
  font-size: 13.5px;
  font-weight: 600;
  color: #2c3a55;
}

.fan-label em {
  font-style: normal;
  font-size: 11px;
  color: var(--fan-theme);
  margin-left: 4px;
}

.fan-input {
  width: 100%;
  box-sizing: border-box;
  border: 1.5px solid #dfe5ef;
  border-radius: 10px;
  padding: 11px 13px;
  font-size: 16px; /* 避免 iOS 自动放大 */
  font-family: inherit;
  color: #16233b;
  background: #fbfcfe;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.fan-input:focus {
  outline: none;
  border-color: var(--fan-theme);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--fan-theme) 18%, transparent);
  background: #ffffff;
}

.fan-textarea {
  resize: vertical;
  min-height: 76px;
  line-height: 1.6;
}

.fan-field-error {
  color: #c0453c;
  font-size: 12px;
}

.fan-consent {
  display: flex;
  gap: 9px;
  align-items: flex-start;
  font-size: 12.5px;
  line-height: 1.6;
  color: #5c6a83;
  margin: 2px 0 8px;
}

.fan-checkbox {
  margin-top: 3px;
  accent-color: var(--fan-theme);
  width: 15px;
  height: 15px;
  flex-shrink: 0;
}

.fan-trap {
  position: absolute;
  left: -9999px;
  width: 1px;
  height: 1px;
  opacity: 0;
}

.fan-submit {
  width: 100%;
  border: none;
  border-radius: 10px;
  padding: 13px 16px;
  font-size: 15.5px;
  font-weight: 700;
  font-family: inherit;
  color: #ffffff;
  background: var(--fan-theme);
  cursor: pointer;
  transition: filter 0.15s ease, transform 0.05s ease;
}

.fan-submit:hover:not(:disabled) {
  filter: brightness(1.08);
}

.fan-submit:active:not(:disabled) {
  transform: translateY(1px);
}

.fan-submit:disabled {
  opacity: 0.65;
  cursor: default;
}

.fan-submit--ghost {
  margin-top: 18px;
  background: transparent;
  color: var(--fan-theme);
  border: 1.5px solid var(--fan-theme);
}

.fan-submit-error {
  margin: 0 0 10px;
  color: #c0453c;
  font-size: 12.5px;
}

.fan-foot {
  margin: 12px 0 0;
  text-align: center;
  color: #8a93a6;
  font-size: 11.5px;
}

.fan-track-row {
  margin: 14px 0 0;
  text-align: center;
}

.fan-track-link {
  color: var(--fan-theme);
  font-weight: 600;
  text-decoration: none;
}

.fan-loading {
  color: #5c6a83;
  font-size: 14px;
}

.fan-error,
.fan-closed {
  color: #5c6a83;
  font-size: 14px;
  line-height: 1.7;
}

.fan-result .fan-title {
  font-size: 20px;
}

.fan-check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 54px;
  height: 54px;
  border-radius: 50%;
  border: 2.5px solid var(--fan-theme);
  color: var(--fan-theme);
  font-size: 26px;
  font-weight: 700;
  margin-bottom: 14px;
  transform: rotate(-6deg);
}

.fan-done-text {
  color: #5c6a83;
  font-size: 13.5px;
  line-height: 1.7;
}

.fan-preview-note {
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  background: #fdf3e3;
  color: #8a6116;
  font-size: 12px;
}
</style>
