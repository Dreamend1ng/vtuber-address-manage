export interface IpLookup {
  ip: string
  /** 归属地描述，如「China Zhejiang Hangzhou」或「浙江省杭州市」 */
  region: string
  isp: string
}

interface IpService {
  name: string
  url: string
  parse: (data: Record<string, unknown>) => IpLookup | null
}

function joinRegion(values: unknown[]): string {
  return values.filter((value): value is string => typeof value === 'string' && value.trim() !== '').join(' ').trim()
}

/** 依次尝试多个服务，任一成功即返回；全部失败返回 null（提交不受影响） */
const services: IpService[] = [
  {
    name: 'ipwho.is',
    url: 'https://ipwho.is/',
    parse: (data) => {
      if (data.success === false || typeof data.ip !== 'string') return null
      const connection = (data.connection ?? {}) as { isp?: string; org?: string }
      return {
        ip: data.ip,
        region: joinRegion([data.country, data.region, data.city]),
        isp: connection.isp ?? connection.org ?? '',
      }
    },
  },
  {
    name: 'vore.top',
    url: 'https://api.vore.top/api/IPdata',
    parse: (data) => {
      const ipinfo = (data.ipinfo ?? {}) as { text?: string }
      const ipdata = (data.ipdata ?? {}) as { info1?: string; info2?: string; info3?: string; isp?: string }
      if (typeof ipinfo.text !== 'string' || ipinfo.text === '') return null
      return {
        ip: ipinfo.text,
        region: [ipdata.info1, ipdata.info2, ipdata.info3].filter(Boolean).join(''),
        isp: ipdata.isp ?? '',
      }
    },
  },
  {
    name: 'ipinfo.io',
    url: 'https://ipinfo.io/json',
    parse: (data) => {
      if (typeof data.ip !== 'string') return null
      return {
        ip: data.ip,
        region: joinRegion([data.country, data.region, data.city]),
        isp: typeof data.org === 'string' ? data.org : '',
      }
    },
  },
]

export async function lookupIpInfo(timeoutMs = 4000): Promise<IpLookup | null> {
  for (const service of services) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(service.url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      })
      if (!response.ok) continue
      const data = (await response.json()) as Record<string, unknown>
      const parsed = service.parse(data)
      if (parsed && parsed.ip) return parsed
    } catch {
      // 该服务不可用，尝试下一个
    } finally {
      clearTimeout(timer)
    }
  }
  return null
}
