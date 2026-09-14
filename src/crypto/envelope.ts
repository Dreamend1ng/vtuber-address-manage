import { base64ToBytes, bytesToBase64, utf8Decode, utf8Encode } from './encoding'

/**
 * 加密信封：粉丝端生成临时 AES 密钥加密提交内容，
 * 再用活动公钥（RSA-OAEP）包裹这把 AES 密钥。
 * 仓库里只有密文，只有持有活动私钥（本机保险库内）的人能解开。
 */
export interface EnvelopeFile {
  v: 1
  alg: 'RSA-OAEP-256+A256GCM'
  /** 被 RSA-OAEP 包裹的 AES 密钥 */
  wrapped: string
  iv: string
  data: string
  /** 客户端提交时间（ISO） */
  submittedAt: string
}

const RSA_ALGORITHM: RsaHashedKeyGenParams = {
  name: 'RSA-OAEP',
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: 'SHA-256',
}

export async function generateEventKeyPair(): Promise<{ publicKey: JsonWebKey; privateKey: JsonWebKey }> {
  const pair = await crypto.subtle.generateKey(RSA_ALGORITHM, true, ['encrypt', 'decrypt'])
  return {
    publicKey: await crypto.subtle.exportKey('jwk', pair.publicKey),
    privateKey: await crypto.subtle.exportKey('jwk', pair.privateKey),
  }
}

async function importPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', jwk, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt'])
}

async function importPrivateKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', jwk, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt'])
}

export async function encryptEnvelope(publicKeyJwk: JsonWebKey, payload: unknown): Promise<EnvelopeFile> {
  const publicKey = await importPublicKey(publicKeyJwk)
  const aesKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    utf8Encode(JSON.stringify(payload)),
  )
  const rawAes = await crypto.subtle.exportKey('raw', aesKey)
  const wrapped = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, rawAes)
  return {
    v: 1,
    alg: 'RSA-OAEP-256+A256GCM',
    wrapped: bytesToBase64(new Uint8Array(wrapped)),
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(data)),
    submittedAt: new Date().toISOString(),
  }
}

export async function decryptEnvelope<T>(privateKeyJwk: JsonWebKey, file: EnvelopeFile): Promise<T> {
  const privateKey = await importPrivateKey(privateKeyJwk)
  const rawAes = await crypto.subtle.decrypt(
    { name: 'RSA-OAEP' },
    privateKey,
    base64ToBytes(file.wrapped),
  )
  const aesKey = await crypto.subtle.importKey('raw', new Uint8Array(rawAes), { name: 'AES-GCM' }, false, [
    'decrypt',
  ])
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(file.iv) },
    aesKey,
    base64ToBytes(file.data),
  )
  return JSON.parse(utf8Decode(plain)) as T
}
