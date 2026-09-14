/** 明确绑定 ArrayBuffer，以满足 WebCrypto 的 BufferSource 类型要求 */
export type Bytes = Uint8Array<ArrayBuffer>

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export function utf8Encode(value: string): Bytes {
  return new Uint8Array(textEncoder.encode(value))
}

export function utf8Decode(value: BufferSource): string {
  return textDecoder.decode(value)
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

export function base64ToBytes(value: string): Bytes {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/** URL 安全的 Base64（去掉填充符），用于把配置放进分享链接 */
export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function base64UrlToBytes(value: string): Bytes {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const remainder = padded.length % 4
  return base64ToBytes(remainder === 0 ? padded : padded + '='.repeat(4 - remainder))
}

export function encodeUrlPayload(value: unknown): string {
  return bytesToBase64Url(utf8Encode(JSON.stringify(value)))
}

export function decodeUrlPayload<T>(value: string): T {
  return JSON.parse(utf8Decode(base64UrlToBytes(value))) as T
}
