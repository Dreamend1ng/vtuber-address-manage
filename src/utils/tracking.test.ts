import { describe, expect, it } from 'vitest'
import { hashPhone, maskName, normalizePhone, phoneTail } from './tracking'

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

  it('同一手机号 + 同一盐得到一致哈希，盐不同则不同', async () => {
    const first = await hashPhone('13800000000', 'saltA')
    const second = await hashPhone('+86 138-0000-0000', 'saltA')
    const other = await hashPhone('13800000000', 'saltB')
    expect(first).toBe(second)
    expect(first).not.toBe(other)
    expect(phoneTail('+86 138-0000-1234')).toBe('1234')
  })
})
