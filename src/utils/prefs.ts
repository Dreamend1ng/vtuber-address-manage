import { siteConfig } from '../config'

export interface Prefs {
  autoLockMinutes: number
  clipboardClearSeconds: number
}

const PREF_KEY = 'dispatch-desk:prefs'

const defaults: Prefs = {
  autoLockMinutes: siteConfig.defaultAutoLockMinutes,
  clipboardClearSeconds: siteConfig.defaultClipboardClearSeconds,
}

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREF_KEY)
    if (!raw) return { ...defaults }
    const parsed = JSON.parse(raw) as Partial<Prefs>
    return {
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
