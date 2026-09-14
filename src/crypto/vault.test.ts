import { describe, expect, it } from 'vitest'
import { base64ToBytes, bytesToBase64, utf8Encode } from './encoding'
import {
  decryptJson,
  deriveKek,
  encryptJson,
  generateDekBytes,
  generateSalt,
  importDek,
  unwrapDek,
  wrapDek,
} from './vault'
import {
  formatRecoveryCode,
  generateRecoveryCode,
  isRecoveryCodeComplete,
  normalizeRecoveryCode,
} from './recovery'

/** 测试用低迭代次数，避免拖慢测试；生产固定为 600,000 次 */
const TEST_ITERATIONS = 1_000

describe('base64 编解码', () => {
  it('可以还原任意字节序列', () => {
    const bytes = new Uint8Array(Array.from({ length: 256 }, (_, index) => index))
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
  })
})

describe('恢复码', () => {
  it('生成 32 个字符并分组显示', () => {
    const code = generateRecoveryCode()
    expect(normalizeRecoveryCode(code)).toHaveLength(32)
    expect(code.split('-')).toHaveLength(8)
    expect(isRecoveryCodeComplete(code)).toBe(true)
  })

  it('输入格式化会忽略大小写与杂散字符', () => {
    const code = generateRecoveryCode()
    const messy = ` ${code.toLowerCase().replace(/-/g, ' ')} `
    expect(normalizeRecoveryCode(messy)).toBe(normalizeRecoveryCode(code))
    expect(formatRecoveryCode(normalizeRecoveryCode(code))).toBe(code)
  })
})

describe('密钥包裹', () => {
  it('正确密码可以解包，错误密码会失败', async () => {
    const salt = generateSalt()
    const dekBytes = generateDekBytes()
    const kek = await deriveKek('correct horse battery staple', salt, TEST_ITERATIONS)
    const wrapped = await wrapDek(kek, dekBytes)

    const sameKek = await deriveKek('correct horse battery staple', salt, TEST_ITERATIONS)
    expect(await unwrapDek(sameKek, wrapped)).toEqual(dekBytes)

    const wrongKek = await deriveKek('wrong password', salt, TEST_ITERATIONS)
    await expect(unwrapDek(wrongKek, wrapped)).rejects.toThrow()
  })
})

describe('记录加解密', () => {
  it('可以往返一条含中文的地址记录', async () => {
    const dek = await importDek(generateDekBytes())
    const address = {
      id: 'a1',
      name: '小铃',
      phone: '13800000000',
      detail: '浙江省杭州市西湖区某路 1 号',
      tags: ['VIP', '海外'],
    }
    const payload = await encryptJson(dek, address)
    expect(await decryptJson<typeof address>(dek, payload)).toEqual(address)
  })

  it('密文被篡改后无法解密', async () => {
    const dek = await importDek(generateDekBytes())
    const payload = await encryptJson(dek, { secret: '地址' })
    const tamperedBytes = base64ToBytes(payload.data)
    tamperedBytes[0] ^= 0xff
    payload.data = bytesToBase64(tamperedBytes)
    await expect(decryptJson(dek, payload)).rejects.toThrow()
  })

  it('同一条记录两次加密得到不同密文（随机 IV）', async () => {
    const dek = await importDek(generateDekBytes())
    const first = await encryptJson(dek, { value: '相同内容' })
    const second = await encryptJson(dek, { value: '相同内容' })
    expect(first.data).not.toBe(second.data)
    expect(first.iv).not.toBe(second.iv)
  })
})

describe('完整保险库流程', () => {
  it('创建、解锁、错误密码拒绝、恢复码兜底', async () => {
    const salt = generateSalt()
    const dekBytes = generateDekBytes()
    const password = 'my master password'
    const recoveryCode = generateRecoveryCode()

    const kek = await deriveKek(password, salt, TEST_ITERATIONS)
    const recoveryKek = await deriveKek(normalizeRecoveryCode(recoveryCode), salt, TEST_ITERATIONS)
    const wrappedDek = await wrapDek(kek, dekBytes)
    const wrappedDekByRecovery = await wrapDek(recoveryKek, dekBytes)

    // 正确密码
    const unlocked = await unwrapDek(await deriveKek(password, salt, TEST_ITERATIONS), wrappedDek)
    expect(unlocked).toEqual(dekBytes)

    // 错误密码
    await expect(
      unwrapDek(await deriveKek('not the password', salt, TEST_ITERATIONS), wrappedDek),
    ).rejects.toThrow()

    // 恢复码（含格式化输入）
    const messyCode = formatRecoveryCode(recoveryCode)
    const byRecovery = await unwrapDek(
      await deriveKek(normalizeRecoveryCode(messyCode), salt, TEST_ITERATIONS),
      wrappedDekByRecovery,
    )
    expect(byRecovery).toEqual(dekBytes)
  })
})

describe('UTF-8 编码', () => {
  it('中文往返正常', () => {
    const text = '浙江·杭州—粉丝地址 📦'
    expect(new TextDecoder().decode(utf8Encode(text))).toBe(text)
  })
})
