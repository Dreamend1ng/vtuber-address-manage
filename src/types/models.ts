/** 一条加密记录的业务类型 */
export type RecordType = 'address' | 'event' | 'settings'

export interface BaseRecord {
  id: string
  createdAt: number
  updatedAt: number
}

/** 地址的来源：手动录入 / 粉丝表单收集 / CSV 导入 */
export type AddressSource = 'manual' | 'form' | 'import'

/** 收货地址（粉丝提交或手动录入） */
export interface Address extends BaseRecord {
  /** 收货人姓名（收件名） */
  name: string
  /** 联系电话 */
  phone: string
  province: string
  city: string
  district: string
  /** 详细地址（街道、门牌号等） */
  detail: string
  postalCode: string
  tags: string[]
  notes: string
  /** 来源 */
  source?: AddressSource
  /** 关联的活动 id；手动录入且未指定活动时为 null */
  eventId?: string | null
  /** 粉丝的抖音 ID（表单收集才有） */
  douyinId?: string
  /** 粉丝提交时间 */
  submittedAt?: number
  /** 云端收集仓库中的文件路径（用于同步去重） */
  remotePath?: string
  /* 以下为防捣乱/溯源信息（表单收集且开启记录时才有） */
  /** 提交者 IP */
  submitterIp?: string
  /** IP 归属地 */
  submitterRegion?: string
  /** 运营商 */
  submitterIsp?: string
  /** 设备指纹（设备参数哈希） */
  deviceId?: string
  /** 设备摘要，如「微信 8 · Android 13」 */
  deviceInfo?: string
  /** 原始 User-Agent */
  userAgent?: string
  /* 发货信息 */
  /** 预填 / 最终使用的快递单号 */
  trackingNo?: string
  /** 快递公司 */
  carrier?: string
  /** 发货时间；为空表示尚未发货 */
  shippedAt?: number | null
}

export type EventStatus = 'collecting' | 'closed'

/** 全局收集设置：所有活动共用同一个 GitHub 收集仓库 */
export interface CollectionSettings {
  repo: string
  branch: string
  token: string
  /** 是否在表单中记录提交者 IP 与设备信息（默认开启） */
  recordAntiAbuse?: boolean
  updatedAt: number
}

/** 活动自己的密钥对：用于加密粉丝提交，逐个活动独立 */
export interface EventKeys {
  publicKey: JsonWebKey
  privateKey: JsonWebKey
}

/** 一场周边发放活动，对应一个粉丝收集表单 */
export interface CollectionEvent extends BaseRecord {
  /** 活动名称，如「梦末百天纪念回」 */
  name: string
  /** 表单页上的说明文案 */
  description: string
  status: EventStatus
  /** 表单短标识，用于链接与仓库路径 */
  formKey: string
  /** 表单主题色 */
  themeColor: string
  /** 背景图在本地资源表中的 id */
  backgroundAssetId: string | null
  /** 活动专属密钥对（私钥只存在于本机加密保险库中） */
  keys: EventKeys
  /** 上次发布到收集仓库的时间 */
  lastPublishedAt: number | null
  /** 上次同步提交的时间 */
  lastSyncedAt: number | null
  /** 快递单号查询页使用的加盐值（混淆手机号，首次发货时生成） */
  trackingSalt?: string
  /** 上次发布快递单号查询数据的时间 */
  lastTrackingPublishedAt?: number | null
  /** 已同步过的云端文件路径 */
  importedRemotePaths: string[]
}

/** 发布到仓库的表单配置，粉丝端读取它渲染表单 */
export interface FanFormConfig {
  v: 1
  name: string
  description: string
  themeColor: string
  status: EventStatus
  publicKey: JsonWebKey
  hasBackground: boolean
  /** 是否采集 IP / 设备指纹 / UA（用于防捣乱溯源） */
  collectMeta: boolean
  updatedAt: string
}

/** 粉丝提交的业务字段（在加密信封内） */export interface SubmissionPayload {
  douyinId: string
  recipientName: string
  phone: string
  address: string
  consentAt: number
  /** 防捣乱溯源信息（可在设置中关闭采集，关闭时为空） */
  ip?: string
  ipRegion?: string
  isp?: string
  /** 设备指纹（设备参数哈希） */
  fingerprint?: string
  /** 设备摘要 */
  device?: string
  /** 原始 User-Agent */
  ua?: string
}

