/** 采集到的设备信息（全部来自浏览器的自我声明，可被伪造，仅用于提高捣乱成本与事后核对） */
export interface DeviceInfo {
  ua: string
  platform: string
  language: string
  timezone: string
  screen: string
  cores: number | null
  touch: boolean
  mobile: boolean | null
  brands: string
}

interface NavigatorWithHints extends Navigator {
  userAgentData?: {
    brands?: { brand: string; version: string }[]
    mobile?: boolean
    platform?: string
  }
}

/** 识别浏览器，优先匹配国内 App 内置浏览器 */
export function detectBrowser(ua: string): string {
  const rules: { pattern: RegExp; name: string }[] = [
    { pattern: /MicroMessenger\/([\d.]+)/i, name: '微信' },
    { pattern: /QQBrowser\/([\d.]+)/i, name: 'QQ浏览器' },
    { pattern: /\bQQ\/([\d.]+)/i, name: 'QQ' },
    { pattern: /aweme|BytedanceWebview|Douyin/i, name: '抖音' },
    { pattern: /UCBrowser|UCWEB/i, name: 'UC浏览器' },
    { pattern: /Quark/i, name: '夸克' },
    { pattern: /Weibo/i, name: '微博' },
    { pattern: /AlipayClient/i, name: '支付宝' },
    { pattern: /MiuiBrowser\/([\d.]+)/i, name: '小米浏览器' },
    { pattern: /HuaweiBrowser\/([\d.]+)/i, name: '华为浏览器' },
    { pattern: /SamsungBrowser\/([\d.]+)/i, name: '三星浏览器' },
    { pattern: /EdgiOS|EdgA|Edg\//i, name: 'Edge' },
    { pattern: /OPR\/|Opera/i, name: 'Opera' },
    { pattern: /Firefox\/([\d.]+)/i, name: 'Firefox' },
    { pattern: /(?:Chrome|CriOS)\/([\d.]+)/i, name: 'Chrome' },
    { pattern: /Version\/([\d.]+).*Safari/i, name: 'Safari' },
    { pattern: /Trident|MSIE/i, name: 'IE' },
  ]
  for (const rule of rules) {
    const match = ua.match(rule.pattern)
    if (match) {
      const version = match[1]
      return version ? `${rule.name} ${version.split(/[._]/)[0]}` : rule.name
    }
  }
  return '未知浏览器'
}

export function detectOs(ua: string, platform = ''): string {
  if (/HarmonyOS/i.test(ua)) return 'HarmonyOS'
  const ios = ua.match(/OS (\d+)[._](\d+)/)
  if (/iPhone|iPad|iPod/i.test(ua)) return ios ? `iOS ${ios[1]}.${ios[2]}` : 'iOS'
  const android = ua.match(/Android\s?([\d.]+)/i)
  if (android) return `Android ${android[1]}`
  const windows = ua.match(/Windows NT ([\d.]+)/)
  if (windows) {
    const names: Record<string, string> = {
      '10.0': 'Windows 10/11',
      '6.3': 'Windows 8.1',
      '6.2': 'Windows 8',
      '6.1': 'Windows 7',
    }
    return names[windows[1]] ?? `Windows NT ${windows[1]}`
  }
  if (/CrOS/i.test(ua)) return 'ChromeOS'
  if (/Mac OS X|Macintosh/i.test(ua) || /Mac/i.test(platform)) return 'macOS'
  if (/Linux/i.test(ua)) return 'Linux'
  return '未知系统'
}

export function collectDeviceInfo(): DeviceInfo {
  const nav = navigator as NavigatorWithHints
  const data = nav.userAgentData
  const brands = (data?.brands ?? [])
    .filter((brand) => !/Not.?A.?Brand/i.test(brand.brand))
    .map((brand) => `${brand.brand} ${brand.version}`)
    .join(', ')
  return {
    ua: nav.userAgent,
    platform: data?.platform ?? nav.platform ?? '',
    language: (nav.languages ?? [nav.language]).filter(Boolean).join(','),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? '',
    screen: `${screen.width}x${screen.height}@${window.devicePixelRatio ?? 1}`,
    cores: typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : null,
    touch: 'ontouchstart' in window || (nav.maxTouchPoints ?? 0) > 0,
    mobile: typeof data?.mobile === 'boolean' ? data.mobile : null,
    brands,
  }
}

/** 人类可读的设备摘要，例如「微信 8 · Android 13」 */
export function describeDevice(info: DeviceInfo): string {
  return `${detectBrowser(info.ua)} · ${detectOs(info.ua, info.platform)}`
}

/** 生成用于哈希的规范化字符串 */
export function deviceFingerprintSource(info: DeviceInfo): string {
  return [
    info.ua,
    info.platform,
    info.language,
    info.timezone,
    info.screen,
    info.cores ?? '',
    info.touch ? '1' : '0',
    info.brands,
  ].join('|')
}

/** SHA-256（十六进制）；非安全上下文下降级为 FNV-1a，仅作标识用途 */
export async function hashText(text: string): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  }
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `fnv1a${hash.toString(16).padStart(8, '0')}`
}
