import { describe, expect, it } from 'vitest'
import {
  describeDevice,
  detectBrowser,
  detectOs,
  deviceFingerprintSource,
  hashText,
  type DeviceInfo,
} from './device'

const wechatAndroid: DeviceInfo = {
  ua: 'Mozilla/5.0 (Linux; Android 13; V2183A Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0.49.2600(0x2800313D) WeChat/arm64 Weixin NetType/WIFI Language/zh_CN ABI/arm64',
  platform: 'Linux armv8l',
  language: 'zh-CN',
  timezone: 'Asia/Shanghai',
  screen: '1080x2400@2.75',
  cores: 8,
  touch: true,
  mobile: true,
  brands: 'Android, Google Chrome 116',
}

describe('设备识别', () => {
  it('识别微信内置浏览器与 Android 版本', () => {
    expect(detectBrowser(wechatAndroid.ua)).toBe('微信 8')
    expect(detectOs(wechatAndroid.ua, wechatAndroid.platform)).toBe('Android 13')
    expect(describeDevice(wechatAndroid)).toBe('微信 8 · Android 13')
  })

  it('识别桌面 Chrome 与 Windows', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
    expect(detectBrowser(ua)).toBe('Chrome 126')
    expect(detectOs(ua, 'Win32')).toBe('Windows 10/11')
  })

  it('识别 iPhone Safari 与 iOS', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
    expect(detectBrowser(ua)).toBe('Safari 17')
    expect(detectOs(ua, 'iPhone')).toBe('iOS 17.5')
  })

  it('识别抖音内置浏览器', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 12; SM-G9810) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Mobile Safari/537.36 aweme_29.5.0'
    expect(detectBrowser(ua)).toBe('抖音')
    expect(detectOs(ua)).toBe('Android 12')
  })
})

describe('设备指纹', () => {
  it('同一设备生成相同哈希，参数不同则哈希不同', async () => {
    const first = await hashText(deviceFingerprintSource(wechatAndroid))
    const second = await hashText(deviceFingerprintSource({ ...wechatAndroid }))
    const other = await hashText(deviceFingerprintSource({ ...wechatAndroid, screen: '1080x1920@2' }))
    expect(first).toBe(second)
    expect(first).not.toBe(other)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
  })
})
