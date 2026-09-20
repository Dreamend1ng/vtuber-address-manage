import { describe, expect, it } from 'vitest'
import { isNewerVersion } from './updater'

describe('版本比较', () => {
  it('识别新版本', () => {
    expect(isNewerVersion('0.2.0', '0.1.3')).toBe(true)
    expect(isNewerVersion('v0.3.0', '0.2.9')).toBe(true)
    expect(isNewerVersion('1.0.0', '0.9.9')).toBe(true)
    expect(isNewerVersion('0.2.1', '0.2.0')).toBe(true)
  })

  it('相同或更旧不算更新', () => {
    expect(isNewerVersion('0.2.0', '0.2.0')).toBe(false)
    expect(isNewerVersion('0.1.3', '0.2.0')).toBe(false)
    expect(isNewerVersion('v0.2.0', '0.2.0')).toBe(false)
  })

  it('位数不同时按缺失位补 0 比较', () => {
    expect(isNewerVersion('0.2', '0.2.0')).toBe(false)
    expect(isNewerVersion('0.2.1', '0.2')).toBe(true)
  })
})
