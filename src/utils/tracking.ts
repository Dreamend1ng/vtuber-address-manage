import { hashText } from './device'

/** 归一化手机号：去掉非数字；带国际区号的取后 11 位主体 */
export function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, '')
  if (digits.length > 11 && digits.startsWith('86')) return digits.slice(-11)
  return digits
}

/** 姓名脱敏：保留首字，其余用 * 代替（最多两个） */
export function maskName(name: string): string {
  const chars = Array.from(name.trim())
  if (chars.length === 0) return ''
  return chars[0] + '*'.repeat(Math.min(Math.max(chars.length - 1, 0), 2))
}

/** 查询页用的手机号哈希：手机号 + 活动加盐值 */
export async function hashPhone(phone: string, salt: string): Promise<string> {
  return hashText(`${normalizePhone(phone)}|${salt}`)
}

export function phoneTail(phone: string): string {
  return normalizePhone(phone).slice(-4)
}
