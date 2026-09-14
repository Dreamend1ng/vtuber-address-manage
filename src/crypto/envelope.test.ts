import { describe, expect, it } from 'vitest'
import { decryptEnvelope, encryptEnvelope, generateEventKeyPair } from './envelope'

const SAMPLE = {
  douyinId: 'mengmo_0101',
  recipientName: '小铃',
  phone: '13800000000',
  address: '浙江省杭州市西湖区某路 1 号 3 单元 501 室',
  consentAt: 1_700_000_000_000,
}

describe('活动提交加密信封', () => {
  it('公钥加密、私钥解密可以还原提交内容', async () => {
    const { publicKey, privateKey } = await generateEventKeyPair()
    const envelope = await encryptEnvelope(publicKey, SAMPLE)
    expect(envelope.alg).toBe('RSA-OAEP-256+A256GCM')
    expect(await decryptEnvelope<typeof SAMPLE>(privateKey, envelope)).toEqual(SAMPLE)
  })

  it('同一条内容两次加密得到不同密文', async () => {
    const { publicKey } = await generateEventKeyPair()
    const first = await encryptEnvelope(publicKey, SAMPLE)
    const second = await encryptEnvelope(publicKey, SAMPLE)
    expect(first.data).not.toBe(second.data)
    expect(first.wrapped).not.toBe(second.wrapped)
  })

  it('密文被篡改后无法解密', async () => {
    const { publicKey, privateKey } = await generateEventKeyPair()
    const envelope = await encryptEnvelope(publicKey, SAMPLE)
    const bytes = envelope.data
    envelope.data = bytes.slice(0, 8) + (bytes[8] === 'A' ? 'B' : 'A') + bytes.slice(9)
    await expect(decryptEnvelope(privateKey, envelope)).rejects.toThrow()
  })

  it('其他活动的私钥无法解开', async () => {
    const first = await generateEventKeyPair()
    const second = await generateEventKeyPair()
    const envelope = await encryptEnvelope(first.publicKey, SAMPLE)
    await expect(decryptEnvelope(second.privateKey, envelope)).rejects.toThrow()
  })
})
