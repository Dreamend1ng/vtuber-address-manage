import { describe, expect, it } from 'vitest'
import type { Address } from '../types/models'
import { addresses } from './records'
import { findDuplicateGroups, pickPrimary, planMerge } from './duplicates'

function makeAddress(id: string, phone: string, overrides: Partial<Address> = {}): Address {
  return {
    id,
    createdAt: 0,
    updatedAt: 0,
    name: `粉丝${id}`,
    phone,
    province: '',
    city: '',
    district: '',
    detail: '默认地址',
    postalCode: '',
    tags: [],
    notes: '',
    eventId: 'e1',
    ...overrides,
  }
}

describe('重复提交合并', () => {
  it('按归一化手机号分组，只有一条的不算重复', () => {
    addresses.value = [
      makeAddress('a1', '13800000000'),
      makeAddress('a2', '+86 138-0000-0000'),
      makeAddress('b1', '13900000000'),
      makeAddress('c1', ''),
      makeAddress('c2', ''),
    ]
    const groups = findDuplicateGroups('e1')
    expect(groups).toHaveLength(1)
    expect(groups[0].phone).toBe('13800000000')
    expect(groups[0].records.map((record) => record.id).sort()).toEqual(['a1', 'a2'])
  })

  it('保留对象优先选已发货的那条，没有发货记录时选最新提交', () => {
    const shipped = makeAddress('s1', '13800000000', { trackingNo: 'SF1', shippedAt: 100 })
    const fresh = makeAddress('s2', '13800000000', { submittedAt: 999 })
    expect(pickPrimary([fresh, shipped]).id).toBe('s1')
    expect(pickPrimary([fresh, makeAddress('s3', '13800000000', { submittedAt: 1000 })]).id).toBe('s3')
  })

  it('合并结果：内容取最新，单号与发货状态取已发货的那条', () => {
    const shipped = makeAddress('x1', '13800000000', {
      detail: '旧地址',
      trackingNo: 'SF123',
      carrier: '顺丰',
      shippedAt: 500,
    })
    const fresh = makeAddress('x2', '13800000000', {
      detail: '上海新地址 2 号',
      submittedAt: 900,
      tags: ['VIP'],
      notes: '更新了地址',
    })
    const merged = planMerge({ phone: '13800000000', records: [shipped, fresh], keepId: 'x1' })

    expect(merged.id).toBe('x1')
    expect(merged.detail).toBe('上海新地址 2 号')
    expect(merged.trackingNo).toBe('SF123')
    expect(merged.shippedAt).toBe(500)
    expect(merged.tags).toContain('VIP')
    expect(merged.notes).toBe('更新了地址')
  })
})
