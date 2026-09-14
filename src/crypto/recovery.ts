const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32Encode(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) {
    output += ALPHABET[(value << (5 - bits)) & 31]
  }
  return output
}

/**
 * 生成一次性恢复码：160 位随机数编码为 32 个 Base32 字符，
 * 按 4 位一组展示，方便抄写。
 */
export function generateRecoveryCode(): string {
  const chars = base32Encode(crypto.getRandomValues(new Uint8Array(20)))
  return (chars.match(/.{4}/g) ?? [chars]).join('-')
}

/** 去掉分隔符与歧义字符，得到用于密钥派生的标准形式 */
export function normalizeRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z2-7]/g, '')
}

/** 用户输入时的实时格式化（每 4 位插入连字符） */
export function formatRecoveryCode(input: string): string {
  return normalizeRecoveryCode(input)
    .replace(/(.{4})/g, '$1-')
    .replace(/-$/, '')
}

export function isRecoveryCodeComplete(input: string): boolean {
  return normalizeRecoveryCode(input).length === 32
}
