import type { Address } from '../types/models'
import { normalizePhone } from '../utils/tracking'
import { eventSubmissions, removeAddress, saveAddress } from './records'

export interface DuplicateGroup {
  phone: string
  records: Address[]
  keepId: string
}

/** 保留哪一条：已发货的优先（保留发货进度），否则取最新提交 */
export function pickPrimary(records: Address[]): Address {
  const shipped = records
    .filter((record) => record.shippedAt)
    .sort((a, b) => (b.shippedAt ?? 0) - (a.shippedAt ?? 0))
  if (shipped.length > 0) return shipped[0]
  return [...records].sort(
    (a, b) => (b.submittedAt ?? b.createdAt) - (a.submittedAt ?? a.createdAt),
  )[0]
}

/** 在某个活动里按手机号找出重复提交（手机号为空的不参与） */
export function findDuplicateGroups(eventId: string): DuplicateGroup[] {
  const byPhone = new Map<string, Address[]>()
  for (const address of eventSubmissions(eventId)) {
    const phone = normalizePhone(address.phone)
    if (phone === '') continue
    byPhone.set(phone, [...(byPhone.get(phone) ?? []), address])
  }
  const groups: DuplicateGroup[] = []
  for (const [phone, records] of byPhone) {
    if (records.length < 2) continue
    groups.push({ phone, records, keepId: pickPrimary(records).id })
  }
  return groups
}

/** 计算合并结果：内容取最新一次提交，快递单号与发货状态取已发货的那条 */
export function planMerge(group: DuplicateGroup): Address {
  const keep = group.records.find((record) => record.id === group.keepId) ?? group.records[0]
  const newest = [...group.records].sort(
    (a, b) => (b.submittedAt ?? b.createdAt) - (a.submittedAt ?? a.createdAt),
  )[0]
  const withTracking = group.records
    .filter((record) => record.trackingNo)
    .sort((a, b) => (b.shippedAt ?? 0) - (a.shippedAt ?? 0))[0]

  return {
    ...keep,
    name: newest.name,
    phone: newest.phone,
    province: newest.province,
    city: newest.city,
    district: newest.district,
    detail: newest.detail,
    postalCode: newest.postalCode,
    douyinId: newest.douyinId ?? keep.douyinId,
    submittedAt: newest.submittedAt ?? keep.submittedAt,
    tags: Array.from(new Set([...keep.tags, ...newest.tags])),
    notes: newest.notes || keep.notes,
    extra: mergeExtra(group.records),
    trackingNo: withTracking?.trackingNo ?? keep.trackingNo,
    carrier: withTracking?.carrier ?? keep.carrier,
    shippedAt: withTracking?.shippedAt ?? keep.shippedAt ?? null,
    updatedAt: Date.now(),
  }
}

/** 自定义字段：按提交时间从旧到新覆盖，新提交填过的值优先 */
function mergeExtra(records: Address[]): Record<string, string> | undefined {
  const merged: Record<string, string> = {}
  const ordered = [...records].sort(
    (a, b) => (a.submittedAt ?? a.createdAt) - (b.submittedAt ?? b.createdAt),
  )
  for (const record of ordered) {
    if (record.extra) Object.assign(merged, record.extra)
  }
  return Object.keys(merged).length > 0 ? merged : undefined
}

export interface MergeSummary {
  groups: number
  removed: number
}

/** 执行合并：更新保留的记录，删除同组的其余记录 */
export async function mergeDuplicateGroups(groups: DuplicateGroup[]): Promise<MergeSummary> {
  let removed = 0
  for (const group of groups) {
    const keep = group.records.find((record) => record.id === group.keepId)
    if (!keep) continue
    await saveAddress(planMerge(group))
    for (const record of group.records) {
      if (record.id === keep.id) continue
      await removeAddress(record.id)
      removed += 1
    }
  }
  return { groups: groups.length, removed }
}
