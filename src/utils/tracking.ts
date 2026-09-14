import { base64ToBytes, bytesToBase64, utf8Decode, utf8Encode } from '../crypto/encoding'

/**
 * 查单数据的密钥派生迭代次数。
 * 查询页只需为「自己输入的手机号」派生一次（约 0.2~0.5 秒），
 * 而离线爆破者每猜一个号码都要付出同样的成本，从而大幅抬高批量还原手机号的门槛。
 */
const TRACKING_KDF_ITERATIONS = 600_000

/** 归一化手机号：去掉非数字；带国际区号的取后 11 位主体 */
export function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, '')
  if (digits.length > 11 && digits.startsWith('86')) return digits.slice(-11)
  return digits
}

/** 姓名脱敏：保留首字，其余用 * 代替（最多两个） */
export function maskName(name: string): string {
  const chars = Array.from(name.trim())
  if (chars.length === 0) return ''
  return chars[0] + '*'.repeat(Math.min(Math.max(chars.length - 1, 0), 2))
}

export function phoneTail(phone: string): string {
  return normalizePhone(phone).slice(-4)
}

/** 查询数据的加解密依赖安全上下文（HTTPS / localhost），否则应明确失败而不是降级 */
export function requireSecureCrypto(): void {
  if (!globalThis.crypto?.subtle) {
    throw new Error('当前页面不是安全环境（需要 HTTPS 或 localhost），无法安全地处理快递查询数据')
  }
}

export interface EncryptedEntry {
  iv: string
  data: string
}

/** 一条查单记录解密后的内容（全部字段都在密文里） */
export interface TrackingPayload {
  mask: string
  carrier: string
  trackingNo: string
  shippedAt: number
}

/** 用「手机号 + 活动盐值」派生一把 AES-GCM 密钥（PBKDF2，高迭代） */
export async function derivePhoneKey(phone: string, salt: string): Promise<CryptoKey> {
  requireSecureCrypto()
  const material = await crypto.subtle.importKey('raw', utf8Encode(normalizePhone(phone)), 'PBKDF2', false, [
    'deriveKey',
  ])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: utf8Encode(salt), iterations: TRACKING_KDF_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptTrackingPayload(
  key: CryptoKey,
  payload: TrackingPayload,
): Promise<EncryptedEntry> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, utf8Encode(JSON.stringify(payload)))
  return { iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(data)) }
}

/** 尝试用派生密钥解开一条记录；密钥不对时 GCM 认证失败，返回 null */
export async function tryDecryptTrackingPayload(
  key: CryptoKey,
  entry: EncryptedEntry,
): Promise<TrackingPayload | null> {
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(entry.iv) },
      key,
      base64ToBytes(entry.data),
    )
    return JSON.parse(utf8Decode(plain)) as TrackingPayload
  } catch {
    return null
  }
}
