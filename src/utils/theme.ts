function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '')
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ]
}

function toHex(rgb: [number, number, number]): string {
  return '#' + rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')
}

function mix(rgb: [number, number, number], ratio: number, target = 255): string {
  return toHex(
    rgb.map((channel) => Math.round(channel + (target - channel) * ratio)) as [number, number, number],
  )
}

/**
 * 把 config.ts 里的品牌色应用到 Element Plus 的色板变量，
 * 部署者改一个颜色即可全局生效。
 */
export function applyPrimaryColor(hex: string): void {
  const rgb = hexToRgb(hex)
  const root = document.documentElement.style
  root.setProperty('--el-color-primary', hex)
  root.setProperty('--el-color-primary-light-3', mix(rgb, 0.3))
  root.setProperty('--el-color-primary-light-5', mix(rgb, 0.5))
  root.setProperty('--el-color-primary-light-7', mix(rgb, 0.7))
  root.setProperty('--el-color-primary-light-8', mix(rgb, 0.8))
  root.setProperty('--el-color-primary-light-9', mix(rgb, 0.9))
  root.setProperty('--el-color-primary-dark-2', mix(rgb, 0.2, 0))
}
