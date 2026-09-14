import { describe, expect, it } from 'vitest'
import {
  derivePhoneKey,
  encryptTrackingPayload,
  maskName,
  normalizePhone,
  phoneTail,
  tryDecryptTrackingPayload,
} from './tracking'

describe('查询页工具', () => {
  it('手机号归一化', () => {
    expect(normalizePhone('+86 138-0000-0000')).toBe('13800000000')
    expect(normalizePhone('138 0000 0000')).toBe('13800000000')
    expect(normalizePhone('8613800000000')).toBe('13800000000')
  })

  it('姓名脱敏', () => {
    expect(maskName('张三')).toBe('张*')
    expect(maskName('欧阳夏丹')).toBe('欧**')
    expect(maskName('')).toBe('')
  })

  it('查单记录加密：本人手机号可解开，其他号码解不开', async () => {
    const salt = 'event-salt-123'
    const payload = { mask: '张*', carrier: '顺丰', trackingNo: 'SF1234567890', shippedAt: 1700000000000 }
    const entry = await encryptTrackingPayload(await derivePhoneKey('13800000000', salt), payload)

    // 归一化后是同一个号码，可以解开
    const sameKey = await derivePhoneKey('+86 138-0000-0000', salt)
    expect(await tryDecryptTrackingPayload(sameKey, entry)).toEqual(payload)

    // 别的号码解不开（GCM 认证失败）
    const otherKey = await derivePhoneKey('13900000000', salt)
    expect(await tryDecryptTrackingPayload(otherKey, entry)).toBeNull()

    expect(phoneTail('+86 138-0000-1234')).toBe('1234')
    expect(JSON.stringify(entry)).not.toContain('13800000000')
  })
})
