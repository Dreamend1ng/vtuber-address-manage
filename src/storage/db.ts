import { openDB, type IDBPDatabase } from 'idb'
import type { EncryptedPayload, VaultCryptoConfig } from '../crypto/vault'
import type { RecordType } from '../types/models'

export interface VaultMeta {
  id: 'config'
  crypto: VaultCryptoConfig
  createdAt: number
  updatedAt: number
}

/** 本地数据库中的一条记录：除 id 和更新时间外全部是密文 */
export interface StoredRecord {
  id: string
  type: RecordType
  updatedAt: number
  payload: EncryptedPayload
}

/** 本地资源（如表单背景图）。不含隐私信息，单独存放 */
export interface AssetRecord {
  id: string
  mime: string
  blob: Blob
  createdAt: number
}

interface DispatchDB {
  vault: { key: string; value: VaultMeta }
  records: { key: string; value: StoredRecord; indexes: { 'by-type': RecordType } }
  assets: { key: string; value: AssetRecord }
}

const DB_NAME = 'dispatch-desk'
const DB_VERSION = 2

let dbPromise: Promise<IDBPDatabase<DispatchDB>> | null = null

function db(): Promise<IDBPDatabase<DispatchDB>> {
  dbPromise ??= openDB<DispatchDB>(DB_NAME, DB_VERSION, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) {
        database.createObjectStore('vault', { keyPath: 'id' })
        const records = database.createObjectStore('records', { keyPath: 'id' })
        records.createIndex('by-type', 'type')
      }
      if (oldVersion < 2) {
        database.createObjectStore('assets', { keyPath: 'id' })
      }
    },
  })
  return dbPromise
}

export async function getVaultMeta(): Promise<VaultMeta | undefined> {
  return (await db()).get('vault', 'config')
}

export async function saveVaultMeta(meta: VaultMeta): Promise<void> {
  await (await db()).put('vault', meta)
}

export async function getAllRecords(): Promise<StoredRecord[]> {
  return (await db()).getAll('records')
}

export async function putRecord(record: StoredRecord): Promise<void> {
  await (await db()).put('records', record)
}

export async function putRecords(records: StoredRecord[]): Promise<void> {
  if (records.length === 0) return
  const database = await db()
  const tx = database.transaction('records', 'readwrite')
  for (const record of records) {
    await tx.store.put(record)
  }
  await tx.done
}

export async function deleteRecord(id: string): Promise<void> {
  await (await db()).delete('records', id)
}

/* ---------- 本地资源（背景图等） ---------- */

export async function putAsset(asset: AssetRecord): Promise<void> {
  await (await db()).put('assets', asset)
}

export async function getAllAssets(): Promise<AssetRecord[]> {
  return (await db()).getAll('assets')
}

export async function putAssets(assets: AssetRecord[]): Promise<void> {
  if (assets.length === 0) return
  const database = await db()
  const tx = database.transaction('assets', 'readwrite')
  for (const asset of assets) {
    await tx.store.put(asset)
  }
  await tx.done
}

export async function getAsset(id: string): Promise<AssetRecord | undefined> {
  return (await db()).get('assets', id)
}

export async function deleteAsset(id: string): Promise<void> {
  await (await db()).delete('assets', id)
}

/**
 * 用备份内容替换本地保险库（恢复备份时使用）。
 * 资源（背景图）只覆盖备份中存在的条目，避免旧版备份清掉本地已有的图片。
 */
export async function replaceAll(
  meta: VaultMeta,
  records: StoredRecord[],
  assets: AssetRecord[] = [],
): Promise<void> {
  const database = await db()
  const tx = database.transaction(['vault', 'records'], 'readwrite')
  await tx.objectStore('vault').clear()
  await tx.objectStore('records').clear()
  await tx.objectStore('vault').put(meta)
  for (const record of records) {
    await tx.objectStore('records').put(record)
  }
  await tx.done
  await putAssets(assets)
}

/** 删除整个数据库（清空所有数据时使用） */
export async function wipeDatabase(): Promise<void> {
  const database = await db()
  database.close()
  dbPromise = null
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => resolve()
  })
}
