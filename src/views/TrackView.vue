<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { decodeUrlPayload } from '../crypto/encoding'
import type { FanFormConfig } from '../types/models'
import { GithubError, getFile, type GithubTarget } from '../services/github'
import {
  derivePhoneKey,
  normalizePhone,
  phoneTail,
  tryDecryptTrackingPayload,
  type EncryptedEntry,
  type TrackingPayload,
} from '../utils/tracking'
import { siteConfig } from '../config'
import { copyText } from '../utils/clipboard'

interface TrackingFile {
  v: number
  updatedAt: string
  salt: string
  entries: EncryptedEntry[]
}

type Phase = 'loading' | 'error' | 'no-data' | 'ready'

const route = useRoute()

const phase = ref<Phase>('loading')
const errorMessage = ref('')
const eventName = ref('')
const themeColor = ref('#2e4e9e')
const tracking = ref<TrackingFile | null>(null)
const rawPayload = ref('')
const formKey = ref('')

const phone = ref('')
const querying = ref(false)
const searched = ref(false)
const searchedTail = ref('')
const results = ref<TrackingPayload[]>([])
const noDataHint = ref('活动主还没有发布快递单号。发货完成后即可用手机号查询，请稍后再来。')

const themeStyle = computed(() => ({ '--fan-theme': themeColor.value }))

const backdropStyle = computed(() => ({
  backgroundImage: `radial-gradient(900px 420px at 50% -80px, ${themeColor.value}66, transparent 70%), linear-gradient(160deg, #1a2438, #0f1524)`,
}))

function fail(message: string): void {
  errorMessage.value = message
  phase.value = 'error'
}

onMounted(async () => {
  const raw = route.query.d
  if (typeof raw !== 'string' || raw === '') {
    fail('链接不完整，请向活动主索取完整的查询链接')
    return
  }
  rawPayload.value = raw
  let data: { k?: string; r?: string; b?: string; t?: string }
  try {
    data = decodeUrlPayload(raw)
  } catch {
    fail('链接格式无法识别，请向活动主确认')
    return
  }
  if (!data.k || !data.r || !data.t) {
    fail('链接不完整，请向活动主索取完整的查询链接')
    return
  }
  formKey.value = data.k
  const target: GithubTarget = { repo: data.r, branch: data.b || 'main', token: data.t }

  try {
    const [configFile, trackingFile] = await Promise.all([
      getFile(target, `events/${data.k}/config.json`),
      getFile(target, `events/${data.k}/tracking.json`),
    ])
    if (configFile) {
      const config = JSON.parse(new TextDecoder().decode(configFile.bytes)) as FanFormConfig
      eventName.value = config.name
      themeColor.value = config.themeColor || '#2e4e9e'
    }
    if (!trackingFile) {
      phase.value = 'no-data'
      return
    }
    const parsed = JSON.parse(new TextDecoder().decode(trackingFile.bytes)) as TrackingFile
    if (parsed.v !== 2 || !Array.isArray(parsed.entries)) {
      // 旧版（v1）数据可被离线快速爆破，已被弃用
      noDataHint.value = '查询数据格式已升级，请活动主在「发货」页点击「更新查询数据」后重试。'
      phase.value = 'no-data'
      return
    }
    tracking.value = parsed
    phase.value = 'ready'
  } catch (error) {
    if (error instanceof GithubError && (error.status === 401 || error.status === 403)) {
      fail('查询链接已失效，请联系活动主更新链接')
    } else if (error instanceof GithubError) {
      fail(error.message)
    } else {
      fail('网络异常，请检查网络后重试')
    }
  }
})

async function search(): Promise<void> {
  if (querying.value) return
  const input = phone.value.trim()
  if (normalizePhone(input).length < 6) {
    errorMessage.value = '请输入填表时使用的手机号'
    return
  }
  errorMessage.value = ''
  querying.value = true
  try {
    const current = tracking.value
    if (!current) return
    // 用输入的手机号派生一次密钥，再逐条尝试解密（只有本人那条能被解开）
    const key = await derivePhoneKey(input, current.salt)
    const found: TrackingPayload[] = []
    for (const entry of current.entries) {
      const payload = await tryDecryptTrackingPayload(key, entry)
      if (payload) found.push(payload)
    }
    results.value = found
    searchedTail.value = phoneTail(input)
    searched.value = true
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '查询失败，请稍后重试'
  } finally {
    querying.value = false
  }
}

async function copyTracking(entry: TrackingPayload): Promise<void> {
  await copyText(entry.trackingNo)
}

const formLink = computed(() => (rawPayload.value ? `#/f?d=${rawPayload.value}` : ''))

function formatTime(timestamp: number): string {
  if (!timestamp) return ''
  return new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
</script>

<template>
  <div class="track-screen" :style="[themeStyle, backdropStyle]">
    <main class="track-shell">
      <div v-if="phase === 'loading'" class="fan-card fan-card--plain">
        <p class="track-muted">正在读取快递单号…</p>
      </div>

      <div v-else-if="phase === 'error'" class="fan-card fan-card--plain">
        <h1 class="track-title">无法打开查询页</h1>
        <p class="track-muted">{{ errorMessage }}</p>
      </div>

      <div v-else-if="phase === 'no-data'" class="fan-card fan-card--plain">
        <h1 class="track-title">{{ eventName || '快递单号查询' }}</h1>
        <p class="track-muted">{{ noDataHint }}</p>
        <a v-if="formLink" class="track-link" :href="formLink">返回填写收件信息</a>
      </div>

      <div v-else class="fan-card">
        <header class="track-head">
          <span class="track-eyebrow">{{ siteConfig.appName }} · 快递单号查询</span>
          <h1 class="track-title">{{ eventName || '快递单号查询' }}</h1>
          <p class="track-desc">输入你填表时使用的手机号，即可查询你的快递单号。</p>
        </header>

        <label class="fan-field">
          <span class="fan-label">手机号</span>
          <input
            v-model="phone"
            class="fan-input"
            type="tel"
            inputmode="tel"
            placeholder="填表时填写的手机号"
            maxlength="20"
            autocomplete="tel"
            @keyup.enter="search"
          />
        </label>

        <p v-if="errorMessage" class="track-error">{{ errorMessage }}</p>

        <button class="fan-submit" type="button" :disabled="querying" @click="search">
          {{ querying ? '查询中…' : '查询我的快递单号' }}
        </button>

        <div v-if="searched" class="track-results">
          <div v-if="results.length === 0" class="track-empty">
            没有查到记录。请确认手机号与填表时一致；如果仍未找到，请联系活动主。
          </div>
          <div v-for="(entry, index) in results" :key="index" class="track-result">
            <div class="track-result__head">
              <span class="track-result__name">{{ entry.mask || '收件人' }}</span>
              <span v-if="searchedTail" class="track-result__tail mono">手机号 …{{ searchedTail }}</span>
            </div>
            <div class="track-result__no-row">
              <span class="track-result__no mono">{{ entry.trackingNo }}</span>
              <button class="track-copy" type="button" @click="copyTracking(entry)">复制</button>
            </div>
            <div class="track-result__meta">
              <span v-if="entry.carrier">{{ entry.carrier }}</span>
              <span v-if="entry.shippedAt">发货于 {{ formatTime(entry.shippedAt) }}</span>
            </div>
          </div>
          <p v-if="results.length > 0" class="track-note">
            包裹可能还在运输途中，请以快递公司的官方查询结果为准。
          </p>
        </div>

        <p class="track-foot">
          为保护隐私，这里只显示快递公司与单号，不会显示你的收货地址。
          <template v-if="formLink">
            还没填写收件信息？<a class="track-link" :href="formLink">去填写</a>
          </template>
        </p>
      </div>
    </main>
  </div>
</template>

<style scoped>
.track-screen {
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

.track-shell {
  width: 100%;
  max-width: 440px;
  margin-top: 4vh;
}

.fan-card {
  background: #ffffff;
  border-radius: 18px;
  padding: 26px 24px 24px;
  box-shadow: 0 30px 70px -30px rgba(0, 0, 0, 0.6);
  animation: track-rise 0.32s ease-out;
}

.fan-card--plain {
  text-align: center;
  padding: 40px 24px;
}

@keyframes track-rise {
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

.track-head {
  margin-bottom: 20px;
}

.track-eyebrow {
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.16em;
  color: #5f6b7d;
  display: block;
  margin-bottom: 6px;
}

.track-title {
  margin: 0 0 6px;
  font-size: 22px;
  font-weight: 800;
  color: #16233b;
  letter-spacing: 0.01em;
}

.track-desc {
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

.fan-input {
  width: 100%;
  box-sizing: border-box;
  border: 1.5px solid #dfe5ef;
  border-radius: 10px;
  padding: 11px 13px;
  font-size: 16px;
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
}

.fan-submit:disabled {
  opacity: 0.65;
  cursor: default;
}

.track-muted {
  color: #5c6a83;
  font-size: 14px;
  line-height: 1.7;
}

.track-error {
  margin: 0 0 10px;
  color: #c0453c;
  font-size: 12.5px;
}

.track-results {
  margin-top: 18px;
}

.track-empty {
  padding: 14px;
  border-radius: 10px;
  background: #fdf3e3;
  color: #8a6116;
  font-size: 12.5px;
  line-height: 1.7;
}

.track-result {
  border: 1.5px solid color-mix(in srgb, var(--fan-theme) 28%, #e2e7f0);
  border-radius: 12px;
  padding: 14px 14px 12px;
  margin-bottom: 10px;
}

.track-result__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.track-result__name {
  font-weight: 700;
  color: #16233b;
}

.track-result__tail {
  color: #5f6b7d;
  font-size: 12px;
}

.track-result__no-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  background: #f6f8fc;
  border-radius: 8px;
  padding: 9px 11px;
}

.track-result__no {
  font-size: 16px;
  font-weight: 600;
  color: #16233b;
  word-break: break-all;
}

.track-copy {
  flex-shrink: 0;
  border: 1px solid var(--fan-theme);
  color: var(--fan-theme);
  background: transparent;
  border-radius: 6px;
  padding: 3px 10px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
}

.track-result__meta {
  display: flex;
  gap: 10px;
  margin-top: 8px;
  color: #5f6b7d;
  font-size: 12px;
}

.track-note {
  margin: 4px 0 0;
  color: #5f6b7d;
  font-size: 11.5px;
  line-height: 1.7;
}

.track-foot {
  margin: 16px 0 0;
  color: #5f6b7d;
  font-size: 11.5px;
  line-height: 1.7;
}

.track-link {
  color: var(--fan-theme);
  text-decoration: none;
  font-weight: 600;
}
</style>
