let clearTimer: ReturnType<typeof setTimeout> | undefined

/**
 * 复制文本到剪贴板。传入 clearAfterSeconds 后，
 * 会在指定时间尝试清空剪贴板（仅当内容仍是我们写入的那段文本）。
 */
export async function copyText(text: string, clearAfterSeconds = 0): Promise<void> {
  await navigator.clipboard.writeText(text)
  if (clearTimer) {
    clearTimeout(clearTimer)
    clearTimer = undefined
  }
  if (clearAfterSeconds > 0) {
    clearTimer = setTimeout(() => {
      void (async () => {
        try {
          const current = await navigator.clipboard.readText()
          if (current === text) {
            await navigator.clipboard.writeText('')
          }
        } catch {
          // 浏览器可能拒绝读取剪贴板，忽略即可
        }
      })()
    }, clearAfterSeconds * 1000)
  }
}
