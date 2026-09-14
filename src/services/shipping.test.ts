import { describe, expect, it } from 'vitest'
import type { Address } from '../types/models'
import { addresses } from './records'
import { addressStatus, buildPrefill, shippingStats } from './shipping'

function makeAddress(id: string, name: string, phone: string): Address {
  return {
    id,
    createdAt: 0,
    updatedAt: 0,
    name,
    phone,
    province: '',
    city: '',
    district: '',
    detail: '测试地址',
    postalCode: '',
    tags: [],
    notes: '',
    eventId: 'e1',
  }
}

describe('发货预填', () => {
  it('识别表头，按手机号匹配并归一化号码', () => {
    addresses.value = [makeAddress('a1', '小铃', '13800000000'), makeAddress('a2', '阿蓝', '13900000000')]
    const rows = [
      ['抖音ID', '收件名', '手机号', '收件地址', '快递公司', '快递单号'],
      ['f1', '小铃', '13800000000', '地址一', '顺丰', 'SF001'],
      ['f2', '阿蓝', '139-0000-0000', '地址二', '', 'YT002'],
      ['f3', '幽灵', '13700000000', '地址三', '', 'ZZ003'],
    ]
    const result = buildPrefill(rows, 'e1')
    expect(result.prefill).toHaveLength(3)
    expect(result.prefill[0].addressId).toBe('a1')
    expect(result.prefill[1].addressId).toBe('a2')
    expect(result.prefill[1].matchType).toBe('phone')
    expect(result.prefill[2].addressId).toBeNull()
    expect(result.skippedEmpty).toBe(0)
  })

  it('没有单号列时给出可读错误', () => {
    expect(() => buildPrefill([['姓名', '手机号'], ['甲', '13800000000']], 'e1')).toThrow(/快递单号/)
  })

  it('空单号行会被跳过，不参与匹配', () => {
    addresses.value = [makeAddress('a1', '小铃', '13800000000')]
    const rows = [
      ['收件名', '手机号', '快递单号'],
      ['小铃', '13800000000', ''],
      ['小铃', '13800000000', 'SF009'],
    ]
    const result = buildPrefill(rows, 'e1')
    expect(result.prefill).toHaveLength(1)
    expect(result.skippedEmpty).toBe(1)
  })
})

describe('发货状态', () => {
  it('统计与状态判定', () => {
    const untouched = makeAddress('a', '甲', '13800000001')
    const ready = { ...makeAddress('b', '乙', '13800000002'), trackingNo: 'T1' }
    const shipped = { ...makeAddress('c', '丙', '13800000003'), trackingNo: 'T2', shippedAt: 1700000000000 }
    expect(shippingStats([untouched, ready, shipped])).toEqual({ total: 3, pending: 1, ready: 1, shipped: 1 })
    expect(addressStatus(untouched).label).toBe('待填写单号')
    expect(addressStatus(ready).label).toBe('待确认')
    expect(addressStatus(shipped).label).toBe('已发货')
  })
})
