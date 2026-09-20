import { encodeUrlPayload, utf8Decode, utf8Encode, type Bytes } from '../crypto/encoding'
import { decryptEnvelope, generateEventKeyPair, type EnvelopeFile } from '../crypto/envelope'
import { siteConfig } from '../config'
import type {
  Address,
  CollectionEvent,
  CollectionSettings,
  EventStatus,
  FanFormConfig,
  SubmissionPayload,
} from '../types/models'
import { loadAssetBlob } from './assets'
import { GithubError, checkGithubReachability, getFile, getRepo, isValidRepo, listDirectory, normalizeRepo, putFile, type GithubTarget } from './github'
import { addresses, collectionSettings, createAddress, createEvent, saveEvent } from './records'
import { buildXlsx } from '../utils/xlsx'
import { downloadBlob, timestampForFilename } from '../utils/download'
import { hashText } from '../utils/device'
import { derivePhoneKey, encryptTrackingPayload, maskName, type EncryptedEntry } from '../utils/tracking'

const KEY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

function randomKey(length = 10): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (byte) => KEY_ALPHABET[byte % KEY_ALPHABET.length]).join('')
}

/** 创建一个活动，同时生成活动专属密钥对 */
export async function createEventWithKeys(name: string, description = ''): Promise<CollectionEvent> {
  const { publicKey, privateKey } = await generateEventKeyPair()
  return createEvent({
    name,
    description,
    status: 'collecting',
    formKey: randomKey(),
    themeColor: siteConfig.primaryColor,
    backgroundAssetId: null,
    keys: { publicKey, privateKey },
    lastPublishedAt: null,
    lastSyncedAt: null,
    importedRemotePaths: [],
  })
}

/* ---------- 全局收集设置 ---------- */

export function collectionReady(settings: CollectionSettings | null): boolean {
  return Boolean(settings && settings.repo.trim() !== '' && settings.token.trim() !== '')
}

function requireSettings(): CollectionSettings {
  const settings = collectionSettings.value
  if (!collectionReady(settings)) {
    throw new Error('还没有配置收集仓库，请到「设置 → 收集仓库」里填写')
  }
  return settings as CollectionSettings
}

export function targetOf(): GithubTarget {
  const settings = requireSettings()
  return {
    repo: normalizeRepo(settings.repo),
    branch: settings.branch.trim() || 'main',
    token: settings.token.trim(),
  }
}

export async function testCollection(repo: string, token: string): Promise<string> {
  const normalized = normalizeRepo(repo)
  if (!isValidRepo(normalized)) {
    throw new Error('仓库格式不正确，应为 owner/name，例如 yourname/vam-collect')
  }
  try {
    const info = await getRepo({ repo: normalized, token: token.trim(), branch: 'main' })
    return `${info.full_name}（${info.private ? '私有仓库' : '公开仓库，不建议'}，默认分支 ${info.default_branch}）`
  } catch (error) {
    if (error instanceof GithubError && error.status === undefined) {
      // 网络层失败：进一步探测 GitHub 是否可达，把原因说清楚
      const reachable = await checkGithubReachability()
      throw new Error(
        reachable
          ? 'GitHub 可以访问，但这次请求被拦截了（可能是浏览器插件或代理）。请关闭拦截插件或更换浏览器后重试。'
          : '无法连接 GitHub：当前网络禁止访问 api.github.com。请更换网络环境或配置代理后重试。',
      )
    }
    throw error
  }
}

/* ---------- 发布与同步 ---------- */

async function putFileEnsuring(
  target: GithubTarget,
  path: string,
  bytes: Uint8Array,
  message: string,
): Promise<void> {
  const existing = await getFile(target, path)
  await putFile(target, path, bytes, message, existing?.sha)
}

/** 发布 / 更新表单到收集仓库（配置 + 背景图） */
export async function publishEvent(event: CollectionEvent): Promise<void> {
  const target = targetOf()
  const config: FanFormConfig = {
    v: 1,
    name: event.name,
    description: event.description,
    themeColor: event.themeColor,
    status: event.status,
    publicKey: event.keys.publicKey,
    hasBackground: event.backgroundAssetId !== null,
    collectMeta: collectionSettings.value?.recordAntiAbuse !== false,
    customFields: event.customFields ?? [],
    updatedAt: new Date().toISOString(),
  }
  await putFileEnsuring(
    target,
    `events/${event.formKey}/config.json`,
    utf8Encode(JSON.stringify(config, null, 2)),
    `发布表单：${event.name}`,
  )
  if (event.backgroundAssetId) {
    const blob = await loadAssetBlob(event.backgroundAssetId)
    if (blob) {
      await putFileEnsuring(
        target,
        `events/${event.formKey}/background.jpg`,
        new Uint8Array(await blob.arrayBuffer()),
        `更新表单背景：${event.name}`,
      )
    }
  }
  event.lastPublishedAt = Date.now()
  await saveEvent(event)
}

export interface SyncResult {
  added: number
  skipped: number
  failed: number
  /** 文件名或结构不符合提交格式的无效文件（已记录，不会重复处理） */
  invalid: number
  /** 本次达到单次上限，还有待同步文件 */
  hasMore: boolean
}

type ProgressCallback = (done: number, total: number) => void

/** 单次同步最多处理的文件数，避免大量积压把浏览器卡住 */
const MAX_FILES_PER_SYNC = 300
/** 表单页生成的文件名：毫秒时间戳 + 8 位随机 hex */
const SUBMISSION_NAME_RE = /^\d{10,20}-[0-9a-f]{8}\.json$/
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/

/** 校验提交文件：文件名格式、体积上限、信封结构与 base64 字段 */
function isValidSubmissionFile(fileName: string, bytes: Bytes): boolean {
  if (!SUBMISSION_NAME_RE.test(fileName)) return false
  if (bytes.length === 0 || bytes.length > 8 * 1024) return false
  try {
    const parsed = JSON.parse(utf8Decode(bytes)) as Partial<EnvelopeFile>
    return (
      parsed?.v === 1 &&
      parsed.alg === 'RSA-OAEP-256+A256GCM' &&
      typeof parsed.wrapped === 'string' &&
      BASE64_RE.test(parsed.wrapped) &&
      typeof parsed.iv === 'string' &&
      BASE64_RE.test(parsed.iv) &&
      typeof parsed.data === 'string' &&
      BASE64_RE.test(parsed.data)
    )
  } catch {
    return false
  }
}

/** 从收集仓库同步粉丝提交：只处理未导入过的文件 */
export async function syncEventSubmissions(
  event: CollectionEvent,
  onProgress?: ProgressCallback,
): Promise<SyncResult> {
  const target = targetOf()
  await assertRemoteConfigMatches(event, target)
  const entries = await listDirectory(target, `events/${event.formKey}/submissions`)
  const seen = new Set(event.importedRemotePaths)
  const pendingAll = entries.filter((entry) => !seen.has(entry.path))
  const pending = pendingAll.slice(0, MAX_FILES_PER_SYNC)
  const result: SyncResult = {
    added: 0,
    skipped: 0,
    failed: 0,
    invalid: 0,
    hasMore: pendingAll.length > pending.length,
  }

  for (let index = 0; index < pending.length; index += 1) {
    const entry = pending[index]
    onProgress?.(index + 1, pending.length)
    const fileName = entry.path.split('/').pop() ?? ''
    if (!SUBMISSION_NAME_RE.test(fileName)) {
      // 持有链接的人可以绕过表单页直接往仓库写文件，文件名不符的一律视为无效提交
      event.importedRemotePaths.push(entry.path)
      result.invalid += 1
      continue
    }
    let file
    try {
      file = await getFile(target, entry.path)
    } catch (error) {
      if (error instanceof GithubError && error.status === 404) {
        result.skipped += 1
        continue
      }
      result.failed += 1
      continue
    }
    if (!file) {
      result.skipped += 1
      continue
    }
    if (!isValidSubmissionFile(fileName, file.bytes)) {
      event.importedRemotePaths.push(entry.path)
      result.invalid += 1
      continue
    }
    try {
      const envelope = JSON.parse(utf8Decode(file.bytes)) as EnvelopeFile
      const payload = await decryptEnvelope<SubmissionPayload>(event.keys.privateKey, envelope)
      const extra: Record<string, string> = {}
      if (payload.extra && typeof payload.extra === 'object') {
        for (const [key, value] of Object.entries(payload.extra)) {
          if (typeof value === 'string' && value.trim() !== '') extra[key] = value.trim()
        }
      }
      await createAddress({
        name: (payload.recipientName ?? '').trim(),
        phone: (payload.phone ?? '').trim(),
        province: '',
        city: '',
        district: '',
        detail: (payload.address ?? '').trim(),
        postalCode: '',
        tags: [],
        notes: '',
        source: 'form',
        eventId: event.id,
        douyinId: (payload.douyinId ?? '').trim(),
        submittedAt: Number.isFinite(Date.parse(envelope.submittedAt))
          ? Date.parse(envelope.submittedAt)
          : Date.now(),
        remotePath: entry.path,
        submitterIp: payload.ip,
        submitterRegion: payload.ipRegion,
        submitterIsp: payload.isp,
        deviceId: payload.fingerprint,
        deviceInfo: payload.device,
        userAgent: payload.ua,
        extra: Object.keys(extra).length > 0 ? extra : undefined,
      })
      event.importedRemotePaths.push(entry.path)
      result.added += 1
    } catch {
      // 无法解析或解密的文件标记为已处理，避免反复失败
      event.importedRemotePaths.push(entry.path)
      result.failed += 1
    }
  }

  event.lastSyncedAt = Date.now()
  await saveEvent(event)
  return result
}

/* ---------- 快递单号查询 ---------- */

async function ensureTrackingSalt(event: CollectionEvent): Promise<string> {
  if (event.trackingSalt) return event.trackingSalt
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  event.trackingSalt = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  await saveEvent(event)
  return event.trackingSalt
}

/** 公钥指纹：用于校验远端表单配置是否被替换 */
export async function publicKeyFingerprint(key: JsonWebKey): Promise<string> {
  return hashText(JSON.stringify([key.kty, key.n, key.e]))
}

/**
 * 同步前校验远端 config.json 的公钥与本地活动密钥一致。
 * 若收集链接被转发后有人替换了公钥，后续粉丝提交会被加密到攻击者密钥——
 * 这里发现不一致就中止同步并告警。
 */
async function assertRemoteConfigMatches(event: CollectionEvent, target: GithubTarget): Promise<void> {
  const file = await getFile(target, `events/${event.formKey}/config.json`)
  if (!file) return
  let config: FanFormConfig
  try {
    config = JSON.parse(utf8Decode(file.bytes)) as FanFormConfig
  } catch {
    throw new Error('远端表单配置无法解析，收集仓库可能已被篡改，请检查后重新发布表单')
  }
  if (!config.publicKey) {
    throw new Error('远端表单配置缺少公钥，收集仓库可能已被篡改，请检查后重新发布表单')
  }
  const [localFingerprint, remoteFingerprint] = await Promise.all([
    publicKeyFingerprint(event.keys.publicKey),
    publicKeyFingerprint(config.publicKey),
  ])
  if (localFingerprint !== remoteFingerprint) {
    throw new Error('远端表单公钥与本地活动密钥不一致：收集仓库可能被篡改，已停止同步。请检查仓库并重新发布表单')
  }
}

/**
 * 把已发货的单号发布到收集仓库供粉丝查询。
 * 每条记录都以「手机号 + 活动盐值」派生的密钥加密（PBKDF2 高迭代 + AES-GCM），
 * 文件中没有明文手机号，也没有可被快速比对的哈希；未猜中手机号时连掩码与单号都看不到。
 */
export async function publishTracking(event: CollectionEvent): Promise<number> {
  const target = targetOf()
  const salt = await ensureTrackingSalt(event)
  const list = addresses.value.filter(
    (address) => address.eventId === event.id && address.shippedAt && address.trackingNo,
  )
  const entries: EncryptedEntry[] = []
  const CONCURRENCY = 4
  for (let index = 0; index < list.length; index += CONCURRENCY) {
    const batch = list.slice(index, index + CONCURRENCY)
    const encrypted = await Promise.all(
      batch.map(async (address) => {
        const key = await derivePhoneKey(address.phone, salt)
        return encryptTrackingPayload(key, {
          mask: maskName(address.name),
          carrier: address.carrier ?? '',
          trackingNo: address.trackingNo ?? '',
          shippedAt: address.shippedAt ?? 0,
        })
      }),
    )
    entries.push(...encrypted)
  }
  const payload = { v: 2, updatedAt: new Date().toISOString(), salt, entries }
  await putFileEnsuring(
    target,
    `events/${event.formKey}/tracking.json`,
    utf8Encode(JSON.stringify(payload, null, 2)),
    `更新快递单号查询：${event.name}`,
  )
  event.lastTrackingPublishedAt = Date.now()
  await saveEvent(event)
  return entries.length
}

/* ---------- 分享链接 ---------- */

export interface FanLinkPayload {
  k: string
  r: string
  b: string
  t: string
}

export interface PreviewLinkPayload {
  k: string
  p: 1
  c: {
    name: string
    description: string
    themeColor: string
    status: EventStatus
    bgId: string | null
    /** 预览也使用真实公钥，完整走一遍加密流程 */
    publicKey: JsonWebKey
    /** 与正式表单一致的防捣乱采集开关 */
    collectMeta: boolean
  }
}

function baseUrl(): string {
  return `${location.origin}${location.pathname}`
}

/** 发布/查询链接共用的载荷（含全局收集仓库与 Token，仓库专用、可随时吊销） */
function encodeLinkPayload(event: CollectionEvent): string {
  const settings = requireSettings()
  const payload: FanLinkPayload = {
    k: event.formKey,
    r: settings.repo.trim(),
    b: settings.branch.trim() || 'main',
    t: settings.token.trim(),
  }
  return encodeUrlPayload(payload)
}

/** 发给粉丝的收集链接 */
export function shareUrlFor(event: CollectionEvent): string {
  return `${baseUrl()}#/f?d=${encodeLinkPayload(event)}`
}

/** 快递单号查询链接 */
export function trackUrlFor(event: CollectionEvent): string {
  return `${baseUrl()}#/t?d=${encodeLinkPayload(event)}`
}

/** 主播本机预览：不需要仓库与 Token，不真正上传 */
export function previewUrlFor(event: CollectionEvent): string {
  const payload: PreviewLinkPayload = {
    k: event.formKey,
    p: 1,
    c: {
      name: event.name,
      description: event.description,
      themeColor: event.themeColor,
      status: event.status,
      bgId: event.backgroundAssetId,
      publicKey: event.keys.publicKey,
      collectMeta: collectionSettings.value?.recordAntiAbuse !== false,
    },
  }
  return `${baseUrl()}#/f?d=${encodeUrlPayload(payload)}`
}

/* ---------- 导出 ---------- */

export function exportEventSubmissionsXlsx(event: CollectionEvent, list: Address[]): void {
  const customFields = event.customFields ?? []
  const rows: (string | number)[][] = [
    ['抖音ID', '收件名', '手机号', '收件地址', ...customFields.map((field) => field.label), '快递单号', '提交时间'],
  ]
  for (const address of list) {
    rows.push([
      address.douyinId ?? '',
      address.name,
      address.phone,
      [address.province, address.city, address.district, address.detail].filter(Boolean).join(''),
      ...customFields.map((field) => address.extra?.[field.id] ?? ''),
      address.trackingNo ?? '',
      address.submittedAt ? new Date(address.submittedAt).toLocaleString('zh-CN') : '',
    ])
  }
  const blob = buildXlsx([{ name: event.name.slice(0, 28) || '活动地址', rows }])
  downloadBlob(`${event.name}·地址-${timestampForFilename()}.xlsx`, blob)
}

/** 手动补录时把活动信息带入地址记录 */
export async function addManualSubmission(
  event: CollectionEvent,
  input: { douyinId: string; recipientName: string; phone: string; address: string; extra?: Record<string, string> },
): Promise<void> {
  await createAddress({
    name: input.recipientName,
    phone: input.phone,
    province: '',
    city: '',
    district: '',
    detail: input.address,
    postalCode: '',
    tags: [],
    notes: '',
    source: 'manual',
    eventId: event.id,
    douyinId: input.douyinId,
    submittedAt: Date.now(),
    extra: input.extra && Object.keys(input.extra).length > 0 ? input.extra : undefined,
  })
}
