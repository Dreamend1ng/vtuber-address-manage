import { reactive, readonly, toRaw } from 'vue'
import {
  KDF_ITERATIONS,
  deriveKek,
  importDek,
  unwrapDek,
  wrapDek,
  type VaultCryptoConfig,
} from '../crypto/vault'
import { generateRecoveryCode, normalizeRecoveryCode } from '../crypto/recovery'
import { base64ToBytes, bytesToBase64, type Bytes } from '../crypto/encoding'
import { getVaultMeta, saveVaultMeta, wipeDatabase, type VaultMeta } from '../storage/db'
import { loadPrefs, savePrefs } from '../utils/prefs'

export type VaultStatus = 'loading' | 'empty' | 'locked' | 'unlocked'

interface VaultState {
  status: VaultStatus
  meta: VaultMeta | null
  /** 数据密钥只存在于内存中，锁定后立即丢弃 */
  dek: CryptoKey | null
  unlockedAt: number | null
  lastActivity: number
  autoLockMinutes: number
  clipboardClearSeconds: number
}

const state = reactive<VaultState>({
  status: 'loading',
  meta: null,
  dek: null,
  unlockedAt: null,
  lastActivity: Date.now(),
  autoLockMinutes: 15,
  clipboardClearSeconds: 30,
})

let failedAttempts = 0

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function requireMeta(): VaultMeta {
  if (!state.meta) throw new Error('保险库尚未初始化')
  // 返回原始对象：Vue 的响应式代理无法被 IndexedDB 的结构化克隆处理
  return toRaw(state.meta)
}

async function buildCryptoConfig(
  dekBytes: Bytes,
  password: string,
  recoveryCode: string,
  salt: Bytes,
): Promise<VaultCryptoConfig> {
  const kek = await deriveKek(password, salt, KDF_ITERATIONS)
  const recoveryKek = await deriveKek(normalizeRecoveryCode(recoveryCode), salt, KDF_ITERATIONS)
  return {
    cryptoVersion: 1,
    kdf: {
      algorithm: 'PBKDF2',
      hash: 'SHA-256',
      iterations: KDF_ITERATIONS,
      salt: bytesToBase64(salt),
    },
    wrappedDek: await wrapDek(kek, dekBytes),
    wrappedDekByRecovery: await wrapDek(recoveryKek, dekBytes),
  }
}

async function applyUnlocked(dekBytes: Bytes): Promise<void> {
  state.dek = await importDek(dekBytes)
  state.status = 'unlocked'
  state.unlockedAt = Date.now()
  state.lastActivity = Date.now()
  failedAttempts = 0
}

/** 应用启动时调用：读出本机是否已有保险库（同时清空内存中的会话密钥） */
export async function initializeVault(): Promise<void> {
  const prefs = loadPrefs()
  state.autoLockMinutes = prefs.autoLockMinutes
  state.clipboardClearSeconds = prefs.clipboardClearSeconds
  state.dek = null
  state.unlockedAt = null
  const meta = await getVaultMeta()
  state.meta = meta ?? null
  state.status = meta ? 'locked' : 'empty'
}

/** 首次使用：设置主密码并创建保险库，返回一次性恢复码 */
export async function setupVault(password: string): Promise<{ recoveryCode: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const dekBytes = crypto.getRandomValues(new Uint8Array(32))
  const recoveryCode = generateRecoveryCode()
  const cryptoConfig = await buildCryptoConfig(dekBytes, password, recoveryCode, salt)
  const now = Date.now()
  const meta: VaultMeta = { id: 'config', crypto: cryptoConfig, createdAt: now, updatedAt: now }
  await saveVaultMeta(meta)
  state.meta = meta
  await applyUnlocked(dekBytes)
  return { recoveryCode }
}

/** 用主密码解锁 */
export async function unlockVault(password: string): Promise<void> {
  const meta = requireMeta()
  if (failedAttempts > 0) {
    await delay(Math.min(2 ** failedAttempts * 400, 8000))
  }
  try {
    const kek = await deriveKek(password, base64ToBytes(meta.crypto.kdf.salt), meta.crypto.kdf.iterations)
    const dekBytes = await unwrapDek(kek, meta.crypto.wrappedDek)
    await applyUnlocked(dekBytes)
  } catch (error) {
    failedAttempts += 1
    throw new Error('主密码不正确', { cause: error })
  }
}

/** 忘记密码时的恢复流程：用恢复码解包，并就地重置主密码 */
export async function recoverVault(recoveryCode: string, newPassword: string): Promise<void> {
  const meta = requireMeta()
  const salt = base64ToBytes(meta.crypto.kdf.salt)
  const recoveryKek = await deriveKek(
    normalizeRecoveryCode(recoveryCode),
    salt,
    meta.crypto.kdf.iterations,
  )
  let dekBytes: Bytes
  try {
    dekBytes = await unwrapDek(recoveryKek, meta.crypto.wrappedDekByRecovery)
  } catch (error) {
    throw new Error('恢复码不正确，请核对后重试', { cause: error })
  }
  const cryptoConfig = await buildCryptoConfig(dekBytes, newPassword, recoveryCode, salt)
  const updated: VaultMeta = { ...meta, crypto: cryptoConfig, updatedAt: Date.now() }
  await saveVaultMeta(updated)
  state.meta = updated
  await applyUnlocked(dekBytes)
}

/** 修改主密码（需要当前密码验证；恢复码保持不变） */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const meta = requireMeta()
  const salt = base64ToBytes(meta.crypto.kdf.salt)
  let dekBytes: Bytes
  try {
    const currentKek = await deriveKek(currentPassword, salt, meta.crypto.kdf.iterations)
    dekBytes = await unwrapDek(currentKek, meta.crypto.wrappedDek)
  } catch (error) {
    throw new Error('当前密码不正确', { cause: error })
  }
  const kek = await deriveKek(newPassword, salt, meta.crypto.kdf.iterations)
  const updated: VaultMeta = {
    ...meta,
    crypto: { ...meta.crypto, wrappedDek: await wrapDek(kek, dekBytes) },
    updatedAt: Date.now(),
  }
  await saveVaultMeta(updated)
  state.meta = updated
}

/** 重新生成恢复码（需要主密码验证），旧恢复码随即失效 */
export async function regenerateRecoveryCode(currentPassword: string): Promise<{ recoveryCode: string }> {
  const meta = requireMeta()
  const salt = base64ToBytes(meta.crypto.kdf.salt)
  let dekBytes: Bytes
  try {
    const kek = await deriveKek(currentPassword, salt, meta.crypto.kdf.iterations)
    dekBytes = await unwrapDek(kek, meta.crypto.wrappedDek)
  } catch (error) {
    throw new Error('主密码不正确', { cause: error })
  }
  const recoveryCode = generateRecoveryCode()
  const recoveryKek = await deriveKek(normalizeRecoveryCode(recoveryCode), salt, meta.crypto.kdf.iterations)
  const updated: VaultMeta = {
    ...meta,
    crypto: { ...meta.crypto, wrappedDekByRecovery: await wrapDek(recoveryKek, dekBytes) },
    updatedAt: Date.now(),
  }
  await saveVaultMeta(updated)
  state.meta = updated
  return { recoveryCode }
}

export function lockVault(): void {
  state.dek = null
  state.status = state.meta ? 'locked' : 'empty'
}

/** 清空本机所有数据（数据库整体删除） */
export async function wipeVault(): Promise<void> {
  await wipeDatabase()
  state.meta = null
  state.dek = null
  state.status = 'empty'
}

export function touchActivity(): void {
  state.lastActivity = Date.now()
}

export function updatePrefs(next: Partial<Pick<VaultState, 'autoLockMinutes' | 'clipboardClearSeconds'>>): void {
  if (typeof next.autoLockMinutes === 'number') state.autoLockMinutes = next.autoLockMinutes
  if (typeof next.clipboardClearSeconds === 'number') state.clipboardClearSeconds = next.clipboardClearSeconds
  savePrefs({ autoLockMinutes: state.autoLockMinutes, clipboardClearSeconds: state.clipboardClearSeconds })
}

export function requireDek(): CryptoKey {
  if (!state.dek) throw new Error('保险库处于锁定状态')
  return state.dek
}

export function useVault() {
  return readonly(state)
}

export { state as vaultState }
