import { base64ToBytes, bytesToBase64, utf8Decode, utf8Encode, type Bytes } from './encoding'

/** PBKDF2 迭代次数（OWASP 对 SHA-256 的推荐下限） */
export const KDF_ITERATIONS = 600_000
const KDF_HASH = 'SHA-256'
const AES_KEY_BITS = 256
const IV_BYTES = 12

/** 一段使用 AES-GCM 加密后的密文（Base64 存储） */
export interface EncryptedPayload {
  /** 随机初始化向量 */
  iv: string
  /** 密文（含 GCM 认证标签） */
  data: string
}

export interface KdfConfig {
  algorithm: 'PBKDF2'
  hash: string
  iterations: number
  salt: string
}

/**
 * 保险库的加密配置，会原样保存到本地数据库（以及备份文件）中。
 * 其中只有密文和 KDF 参数，没有任何密码本身。
 */
export interface VaultCryptoConfig {
  cryptoVersion: 1
  kdf: KdfConfig
  /** 用主密码派生的 KEK 包裹的数据密钥 */
  wrappedDek: EncryptedPayload
  /** 用恢复码派生的密钥包裹的数据密钥 */
  wrappedDekByRecovery: EncryptedPayload
}

export function generateSalt(): Bytes {
  return crypto.getRandomValues(new Uint8Array(16))
}

/** 随机生成 256 位数据密钥（DEK）的原始字节 */
export function generateDekBytes(): Bytes {
  return crypto.getRandomValues(new Uint8Array(AES_KEY_BITS / 8))
}

/**
 * 从口令派生 KEK（密钥加密密钥）。
 * 口令只是本地计算的输入，永远不会被保存或发送。
 */
export async function deriveKek(
  password: string,
  salt: Bytes,
  iterations: number = KDF_ITERATIONS,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', utf8Encode(password), 'PBKDF2', false, [
    'deriveKey',
  ])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: KDF_HASH },
    material,
    { name: 'AES-GCM', length: AES_KEY_BITS },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** 用 KEK 包裹 DEK，得到可安全落盘的密文 */
export async function wrapDek(kek: CryptoKey, dekBytes: Bytes): Promise<EncryptedPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, dekBytes)
  return { iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(data)) }
}

/**
 * 解包 DEK。密码错误时 GCM 认证失败并抛出异常，
 * 因此不需要保存任何密码哈希来做校验。
 */
export async function unwrapDek(kek: CryptoKey, wrapped: EncryptedPayload): Promise<Bytes> {
  const data = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(wrapped.iv) },
    kek,
    base64ToBytes(wrapped.data),
  )
  return new Uint8Array(data)
}

/** 导入为不可导出的会话密钥，防止脚本再次读取密钥字节 */
export async function importDek(dekBytes: Bytes): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    dekBytes,
    { name: 'AES-GCM', length: AES_KEY_BITS },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptJson(dek: CryptoKey, value: unknown): Promise<EncryptedPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const plaintext = utf8Encode(JSON.stringify(value))
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, dek, plaintext)
  return { iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(cipher)) }
}

export async function decryptJson<T>(dek: CryptoKey, payload: EncryptedPayload): Promise<T> {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(payload.iv) },
    dek,
    base64ToBytes(payload.data),
  )
  return JSON.parse(utf8Decode(plain)) as T
}
