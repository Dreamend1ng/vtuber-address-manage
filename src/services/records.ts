import { ref } from 'vue'
import type { Address, CollectionEvent, CollectionSettings, RecordType, UpdateSettings } from '../types/models'
import { decryptJson, encryptJson } from '../crypto/vault'
import { deleteAsset, deleteRecord, getAllRecords, putRecord } from '../storage/db'
import { requireDek } from './vault'

export const addresses = ref<Address[]>([])
export const events = ref<CollectionEvent[]>([])
export const collectionSettings = ref<CollectionSettings | null>(null)
export const updateSettings = ref<UpdateSettings | null>(null)
export const recordsLoading = ref(false)

const COLLECTION_SETTINGS_ID = 'collection'
const UPDATE_SETTINGS_ID = 'update'

function sortByUpdated<T extends { updatedAt: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.updatedAt - a.updatedAt)
}

function upsert<T extends { id: string; updatedAt: number }>(list: T[], item: T): T[] {
  const next = list.filter((entry) => entry.id !== item.id)
  next.push(item)
  return sortByUpdated(next)
}

/** 兼容早期版本：收集配置曾在活动内部 */
interface LegacyEvent extends Partial<CollectionEvent> {
  collection?: {
    repo?: string
    branch?: string
    token?: string
    publicKey?: JsonWebKey
    privateKey?: JsonWebKey
    lastPublishedAt?: number | null
    lastSyncedAt?: number | null
  }
}

function migrateEvent(raw: unknown): {
  event: CollectionEvent
  adopted: Omit<CollectionSettings, 'updatedAt'> | null
} | null {
  const legacy = raw as LegacyEvent
  if (!legacy || typeof legacy.id !== 'string' || typeof legacy.formKey !== 'string') return null
  let adopted: Omit<CollectionSettings, 'updatedAt'> | null = null
  let keys = legacy.keys
  if (!keys && legacy.collection?.publicKey && legacy.collection?.privateKey) {
    keys = { publicKey: legacy.collection.publicKey, privateKey: legacy.collection.privateKey }
    if (legacy.collection.repo && legacy.collection.token) {
      adopted = {
        repo: legacy.collection.repo,
        branch: legacy.collection.branch || 'main',
        token: legacy.collection.token,
      }
    }
  }
  if (!keys) return null
  return {
    event: {
      id: legacy.id,
      createdAt: legacy.createdAt ?? Date.now(),
      updatedAt: legacy.updatedAt ?? Date.now(),
      name: legacy.name ?? '未命名活动',
      description: legacy.description ?? '',
      status: legacy.status === 'closed' ? 'closed' : 'collecting',
      formKey: legacy.formKey,
      themeColor: legacy.themeColor ?? '#2E4E9E',
      backgroundAssetId: legacy.backgroundAssetId ?? null,
      keys,
      lastPublishedAt: legacy.lastPublishedAt ?? legacy.collection?.lastPublishedAt ?? null,
      lastSyncedAt: legacy.lastSyncedAt ?? legacy.collection?.lastSyncedAt ?? null,
      trackingSalt: legacy.trackingSalt,
      lastTrackingPublishedAt: legacy.lastTrackingPublishedAt ?? null,
      customFields: legacy.customFields ?? [],
      importedRemotePaths: legacy.importedRemotePaths ?? [],
    },
    adopted,
  }
}

/** 解锁后调用：读取并解密本机全部记录 */
export async function loadRecords(): Promise<void> {
  recordsLoading.value = true
  try {
    const stored = await getAllRecords()
    const nextAddresses: Address[] = []
    const nextEvents: CollectionEvent[] = []
    let nextSettings: CollectionSettings | null = null
    let nextUpdateSettings: UpdateSettings | null = null
    let adoptedCollection: Omit<CollectionSettings, 'updatedAt'> | null = null
    let skipped = 0
    for (const record of stored) {
      try {
        if (record.type === 'address') {
          nextAddresses.push(await decryptJson<Address>(requireDek(), record.payload))
        } else if (record.type === 'event') {
          const migrated = migrateEvent(await decryptJson<unknown>(requireDek(), record.payload))
          if (!migrated) {
            skipped += 1
            continue
          }
          nextEvents.push(migrated.event)
          adoptedCollection ??= migrated.adopted
        } else if (record.type === 'settings' && record.id === COLLECTION_SETTINGS_ID) {
          nextSettings = await decryptJson<CollectionSettings>(requireDek(), record.payload)
        } else if (record.type === 'settings' && record.id === UPDATE_SETTINGS_ID) {
          nextUpdateSettings = await decryptJson<UpdateSettings>(requireDek(), record.payload)
        }
      } catch {
        skipped += 1
      }
    }
    addresses.value = sortByUpdated(nextAddresses)
    events.value = sortByUpdated(nextEvents)
    collectionSettings.value = nextSettings
    updateSettings.value = nextUpdateSettings
    if (!nextSettings && adoptedCollection) {
      await saveCollectionSettings(adoptedCollection)
    }
    if (skipped > 0) {
      console.warn(`有 ${skipped} 条记录无法解密，已跳过`)
    }
  } finally {
    recordsLoading.value = false
  }
}

export function clearRecords(): void {
  addresses.value = []
  events.value = []
  collectionSettings.value = null
  updateSettings.value = null
}

async function persist<T>(id: string, type: RecordType, value: T & { updatedAt: number }): Promise<void> {
  value.updatedAt = Date.now()
  await putRecord({ id, type, updatedAt: value.updatedAt, payload: await encryptJson(requireDek(), value) })
}

/* ---------- 地址 ---------- */

type AddressInput = Omit<Address, 'id' | 'createdAt' | 'updatedAt'>

export async function createAddress(input: AddressInput): Promise<Address> {
  const now = Date.now()
  const address: Address = { ...input, id: crypto.randomUUID(), createdAt: now, updatedAt: now }
  await persist(address.id, 'address', address)
  addresses.value = upsert(addresses.value, address)
  return address
}

export async function saveAddress(address: Address): Promise<void> {
  await persist(address.id, 'address', address)
  addresses.value = upsert(addresses.value, { ...address })
}

export async function removeAddress(id: string): Promise<void> {
  await deleteRecord(id)
  addresses.value = addresses.value.filter((address) => address.id !== id)
}

/* ---------- 活动 ---------- */

type EventInput = Omit<CollectionEvent, 'id' | 'createdAt' | 'updatedAt'>

export async function createEvent(input: EventInput): Promise<CollectionEvent> {
  const now = Date.now()
  const event: CollectionEvent = { ...input, id: crypto.randomUUID(), createdAt: now, updatedAt: now }
  await persist(event.id, 'event', event)
  events.value = upsert(events.value, event)
  return event
}

export async function saveEvent(event: CollectionEvent): Promise<void> {
  await persist(event.id, 'event', event)
  events.value = upsert(events.value, { ...event })
}

/** 删除活动：收集到的地址会被保留（解除关联），表单背景图一并清理 */
export async function removeEvent(id: string): Promise<void> {
  const event = events.value.find((item) => item.id === id)
  await deleteRecord(id)
  events.value = events.value.filter((item) => item.id !== id)
  if (event?.backgroundAssetId) {
    await deleteAsset(event.backgroundAssetId)
  }
  for (const address of addresses.value.filter((entry) => entry.eventId === id)) {
    const next: Address = { ...address, eventId: null }
    await persist(next.id, 'address', next)
    addresses.value = upsert(addresses.value, next)
  }
}

/* ---------- 全局收集设置 ---------- */

export async function saveCollectionSettings(
  input: Omit<CollectionSettings, 'updatedAt'>,
): Promise<void> {
  const settings: CollectionSettings = { ...input, updatedAt: Date.now() }
  await persist(COLLECTION_SETTINGS_ID, 'settings', settings)
  collectionSettings.value = { ...settings }
}

/** 保存版本更新设置（Token 同样进加密保险库） */
export async function saveUpdateSettings(input: Omit<UpdateSettings, 'updatedAt'>): Promise<void> {
  const settings: UpdateSettings = { ...input, updatedAt: Date.now() }
  await persist(UPDATE_SETTINGS_ID, 'settings', settings)
  updateSettings.value = { ...settings }
}

/* ---------- 查询 ---------- */

export function findAddress(id: string | null): Address | undefined {
  if (!id) return undefined
  return addresses.value.find((address) => address.id === id)
}

export function findEvent(id: string | null | undefined): CollectionEvent | undefined {
  if (!id) return undefined
  return events.value.find((event) => event.id === id)
}

export function findEventByFormKey(formKey: string): CollectionEvent | undefined {
  return events.value.find((event) => event.formKey === formKey)
}

export function eventSubmissions(eventId: string): Address[] {
  return addresses.value.filter((address) => address.eventId === eventId)
}
