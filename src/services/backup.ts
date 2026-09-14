import { base64ToBytes, bytesToBase64 } from '../crypto/encoding'
import { decryptJson, deriveKek, encryptJson, importDek, unwrapDek } from '../crypto/vault'
import {
  getAllAssets,
  getAllRecords,
  getVaultMeta,
  putAssets,
  putRecords,
  replaceAll,
  type AssetRecord,
  type StoredRecord,
  type VaultMeta,
} from '../storage/db'
import type { Address } from '../types/models'
import { requireDek } from './vault'

const BACKUP_MAGIC = 'dispatch-desk-backup'
const BACKUP_VERSION = 2

/** 背景图等本地资源在备份文件中的形态（base64） */
export interface BackupAsset {
  id: string
  mime: string
  createdAt: number
  data: string
}

export interface BackupFile {
  magic: typeof BACKUP_MAGIC
  version: number
  exportedAt: string
  /** 包含 KDF 参数与包裹后的密钥，全部是密文，不含密码 */
  vault: VaultMeta
  /** 全部记录密文 */
  records: StoredRecord[]
  /** 本地资源（表单背景图等） */
  assets: BackupAsset[]
}

async function assetToBackup(asset: AssetRecord): Promise<BackupAsset> {
  const bytes = new Uint8Array(await asset.blob.arrayBuffer())
  return { id: asset.id, mime: asset.mime, createdAt: asset.createdAt, data: bytesToBase64(bytes) }
}

function backupToAsset(asset: BackupAsset): AssetRecord {
  return {
    id: asset.id,
    mime: asset.mime,
    createdAt: asset.createdAt,
    blob: new Blob([base64ToBytes(asset.data)], { type: asset.mime }),
  }
}

export async function buildBackup(): Promise<BackupFile> {
  const vault = await getVaultMeta()
  if (!vault) throw new Error('本机没有可导出的保险库')
  const assets = await getAllAssets()
  return {
    magic: BACKUP_MAGIC,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    vault,
    records: await getAllRecords(),
    assets: await Promise.all(assets.map(assetToBackup)),
  }
}

export function parseBackup(text: string): BackupFile {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('文件不是有效的备份（JSON 解析失败）')
  }
  const backup = data as Partial<BackupFile>
  const crypto = backup?.vault?.crypto
  if (
    !backup ||
    backup.magic !== BACKUP_MAGIC ||
    !Array.isArray(backup.records) ||
    !crypto?.wrappedDek?.data ||
    !crypto?.kdf?.salt
  ) {
    throw new Error('文件不是本应用的加密备份，或文件已损坏')
  }
  return { ...(backup as BackupFile), assets: Array.isArray(backup.assets) ? backup.assets : [] }
}

/**
 * 整体恢复：用备份替换本机全部数据。
 * 恢复后需要用备份的主密码（或恢复码）解锁，调用方应随后重新初始化保险库状态。
 */
export async function restoreBackup(backup: BackupFile): Promise<void> {
  await replaceAll(backup.vault, backup.records, backup.assets.map(backupToAsset))
}

export interface MergeResult {
  added: number
  updated: number
  skipped: number
  assets: number
}

/**
 * 合并导入：用备份自己的密码解出记录，再用当前保险库密钥重新加密，
 * 按 id + updatedAt 保留较新的版本；背景图按 id 覆盖写入。
 */
export async function mergeBackup(backup: BackupFile, backupPassword: string): Promise<MergeResult> {
  const kdf = backup.vault.crypto.kdf
  const kek = await deriveKek(backupPassword, base64ToBytes(kdf.salt), kdf.iterations)
  let dekBytes: Uint8Array<ArrayBuffer>
  try {
    dekBytes = await unwrapDek(kek, backup.vault.crypto.wrappedDek)
  } catch (error) {
    throw new Error('备份的主密码不正确', { cause: error })
  }
  const backupDek = await importDek(dekBytes)
  const localRecords = new Map((await getAllRecords()).map((record) => [record.id, record]))
  const result: MergeResult = { added: 0, updated: 0, skipped: 0, assets: 0 }
  const toWrite: StoredRecord[] = []

  for (const record of backup.records) {
    const existing = localRecords.get(record.id)
    if (existing && existing.updatedAt >= record.updatedAt) {
      result.skipped += 1
      continue
    }
    let value: Address
    try {
      value = await decryptJson<Address>(backupDek, record.payload)
    } catch {
      result.skipped += 1
      continue
    }
    toWrite.push({
      id: record.id,
      type: record.type,
      updatedAt: record.updatedAt,
      payload: await encryptJson(requireDek(), value),
    })
    if (existing) {
      result.updated += 1
    } else {
      result.added += 1
    }
  }

  await putRecords(toWrite)
  if (backup.assets.length > 0) {
    await putAssets(backup.assets.map(backupToAsset))
    result.assets = backup.assets.length
  }
  return result
}
