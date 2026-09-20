import { siteConfig } from '../config'

/** idle：无操作 N 分钟后锁定；interval：每 30 分钟检查一次，检查时前 1 分钟内有操作则不锁 */
export type AutoLockMode = 'idle' | 'interval'

export interface Prefs {
  autoLockMode: AutoLockMode
  autoLockMinutes: number
  clipboardClearSeconds: number
}

const PREF_KEY = 'dispatch-desk:prefs'

const defaults: Prefs = {
  autoLockMode: 'idle',
  autoLockMinutes: siteConfig.defaultAutoLockMinutes,
  clipboardClearSeconds: siteConfig.defaultClipboardClearSeconds,
}

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREF_KEY)
    if (!raw) return { ...defaults }
    const parsed = JSON.parse(raw) as Partial<Prefs>
    return {
      autoLockMode: parsed.autoLockMode === 'interval' ? 'interval' : 'idle',
      autoLockMinutes: typeof parsed.autoLockMinutes === 'number' ? parsed.autoLockMinutes : defaults.autoLockMinutes,
      clipboardClearSeconds:
        typeof parsed.clipboardClearSeconds === 'number' ? parsed.clipboardClearSeconds : defaults.clipboardClearSeconds,
    }
  } catch {
    return { ...defaults }
  }
}

export function savePrefs(prefs: Prefs): void {
  localStorage.setItem(PREF_KEY, JSON.stringify(prefs))
}
