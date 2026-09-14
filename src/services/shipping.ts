import type { Address } from '../types/models'
import { normalizePhone } from '../utils/tracking'
import { addresses, eventSubmissions, saveAddress } from './records'

/* ---------- 表头识别与匹配 ---------- */

const TRACKING_ALIASES = ['快递单号', '运单号', '物流单号', '单号', 'tracking']
const CARRIER_ALIASES = ['快递公司', '快递', '承运商', '物流公司', 'carrier']
const PHONE_ALIASES = ['手机号', '联系电话', '电话', '手机', 'phone', 'tel']
const NAME_ALIASES = ['收件名', '收货人', '收件人', '姓名', 'name']

export interface HeaderMapping {
  tracking: number
  carrier: number
  phone: number
  name: number
}

function matches(cell: string, aliases: string[]): boolean {
  const value = cell.trim().toLowerCase()
  if (value === '') return false
  return aliases.some((alias) => value.includes(alias.toLowerCase()))
}

/** 在前几行里寻找表头；必须能识别出「单号」列，并且能识别出手机号或姓名列 */
export function locateHeader(rows: string[][]): { index: number; mapping: HeaderMapping } | null {
  for (let index = 0; index < Math.min(rows.length, 10); index += 1) {
    const mapping: HeaderMapping = { tracking: -1, carrier: -1, phone: -1, name: -1 }
    rows[index].forEach((cell, column) => {
      if (mapping.tracking < 0 && matches(cell, TRACKING_ALIASES)) mapping.tracking = column
      else if (mapping.carrier < 0 && matches(cell, CARRIER_ALIASES)) mapping.carrier = column
      else if (mapping.phone < 0 && matches(cell, PHONE_ALIASES)) mapping.phone = column
      else if (mapping.name < 0 && matches(cell, NAME_ALIASES)) mapping.name = column
    })
    if (mapping.tracking >= 0 && (mapping.phone >= 0 || mapping.name >= 0)) {
      return { index, mapping }
    }
  }
  return null
}

export interface TrackingPrefill {
  rowNumber: number
  trackingNo: string
  carrier: string
  name: string
  phone: string
  addressId: string | null
  matchType: 'phone' | 'name' | 'none'
  message: string
}

export interface ParseResult {
  prefill: TrackingPrefill[]
  skippedEmpty: number
  headerRow: number
}

/** 把表格行解析成「预填单号」，并按手机号（优先）或姓名匹配活动内的地址 */
export function buildPrefill(rows: string[][], eventId: string): ParseResult {
  const located = locateHeader(rows)
  if (!located) {
    throw new Error('没有识别到「快递单号」列。请使用本应用导出的 Excel，或保证表头包含「快递单号 / 运单号」和「手机号 / 收件名」')
  }
  const list = eventSubmissions(eventId)
  const phoneMap = new Map<string, Address[]>()
  const nameMap = new Map<string, Address[]>()
  for (const address of list) {
    const phone = normalizePhone(address.phone)
    if (phone) phoneMap.set(phone, [...(phoneMap.get(phone) ?? []), address])
    const name = address.name.trim()
    if (name) nameMap.set(name, [...(nameMap.get(name) ?? []), address])
  }

  const used = new Set<string>()
  const prefill: TrackingPrefill[] = []
  let skippedEmpty = 0
  const { mapping } = located

  for (let index = located.index + 1; index < rows.length; index += 1) {
    const row = rows[index]
    const trackingNo = (row[mapping.tracking] ?? '').trim()
    if (trackingNo === '') {
      skippedEmpty += 1
      continue
    }
    const carrier = mapping.carrier >= 0 ? (row[mapping.carrier] ?? '').trim() : ''
    const name = mapping.name >= 0 ? (row[mapping.name] ?? '').trim() : ''
    const phone = mapping.phone >= 0 ? (row[mapping.phone] ?? '').trim() : ''

    const entry: TrackingPrefill = {
      rowNumber: index + 1,
      trackingNo,
      carrier,
      name,
      phone,
      addressId: null,
      matchType: 'none',
      message: '',
    }

    const byPhone = phone ? (phoneMap.get(normalizePhone(phone)) ?? []) : []
    const pool = byPhone.length > 0 ? byPhone : name ? (nameMap.get(name) ?? []) : []
    const target = pool.find((address) => !used.has(address.id))

    if (!target) {
      entry.message = pool.length > 0 ? '同一收件人在本文件中出现多次，已跳过' : '在活动地址里找不到匹配的收件人'
    } else {
      used.add(target.id)
      entry.addressId = target.id
      entry.matchType = byPhone.length > 0 ? 'phone' : 'name'
      entry.message = byPhone.length > 0 ? '按手机号匹配' : '按姓名匹配'
    }
    prefill.push(entry)
  }

  return { prefill, skippedEmpty, headerRow: located.index + 1 }
}

/** 应用预填：只写入快递单号与快递公司，不改变发货状态 */
export async function applyTrackingPrefill(prefill: TrackingPrefill[]): Promise<number> {
  let applied = 0
  for (const entry of prefill) {
    if (!entry.addressId) continue
    const address = addresses.value.find((item) => item.id === entry.addressId)
    if (!address) continue
    await saveAddress({
      ...address,
      trackingNo: entry.trackingNo,
      carrier: entry.carrier || address.carrier || '',
    })
    applied += 1
  }
  return applied
}

/** 手动填写 / 修改单号（同样只预填，不直接发货） */
export async function setTracking(address: Address, trackingNo: string, carrier: string): Promise<void> {
  await saveAddress({ ...address, trackingNo: trackingNo.trim(), carrier: carrier.trim() })
}

/* ---------- 发货 ---------- */

export interface ShippingStats {
  total: number
  pending: number
  ready: number
  shipped: number
}

export function shippingStats(list: Address[]): ShippingStats {
  let pending = 0
  let ready = 0
  let shipped = 0
  for (const address of list) {
    if (address.shippedAt) shipped += 1
    else if (address.trackingNo) ready += 1
    else pending += 1
  }
  return { total: list.length, pending, ready, shipped }
}

export function addressStatus(address: Address): { label: string; tone: 'amber' | 'green' | 'ink' } {
  if (address.shippedAt) return { label: '已发货', tone: 'green' }
  if (address.trackingNo) return { label: '待确认', tone: 'amber' }
  return { label: '待填写单号', tone: 'ink' }
}

/** 一键发货：把所有已填单号的地址标记为已发货，返回本次发货的地址列表 */
export async function shipReady(eventId: string): Promise<Address[]> {
  const shipped: Address[] = []
  for (const address of eventSubmissions(eventId)) {
    if (address.trackingNo && !address.shippedAt) {
      const next: Address = { ...address, shippedAt: Date.now() }
      await saveAddress(next)
      shipped.push(next)
    }
  }
  return shipped
}

export async function shipOne(address: Address): Promise<void> {
  await saveAddress({ ...address, shippedAt: Date.now() })
}

export async function unshipOne(address: Address): Promise<void> {
  await saveAddress({ ...address, shippedAt: null })
}
