/**
 * 站点配置 —— 部署者（Vtuber）只需要修改这里的品牌信息，
 * 然后推送仓库即可完成个性化部署，无需改动其它代码。
 */
export const siteConfig = {
  /** 应用名，显示在侧边栏、锁屏与备份文件名中 */
  appName: '寄件台',
  /** 版本号 */
  version: '0.3.0',
  /** 英文标识，用于字标 */
  appNameEn: 'DISPATCH DESK',
  /** 一句话说明 */
  tagline: 'Vtuber 地址簿与周边发货管理',
  /** 主题色，会覆盖 Element Plus 的主色 */
  primaryColor: '#2E4E9E',
  /** 常用快递公司，新建订单时可选 */
  carriers: ['顺丰', '中通', '圆通', '韵达', '申通', '极兔', '京东', 'EMS', '邮政', '其他'],
  /** 默认自动锁定时间（分钟），0 表示永不自动锁定 */
  defaultAutoLockMinutes: 15,
  /** 复制敏感信息后自动清空剪贴板的时间（秒），0 表示不清空 */
  defaultClipboardClearSeconds: 30,
} as const
