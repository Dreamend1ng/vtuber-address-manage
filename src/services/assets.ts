import { deleteAsset, getAsset, putAsset } from '../storage/db'

/** 保存一份本地资源（如表单背景图），返回资源 id */
export async function saveAssetBlob(blob: Blob, mime: string): Promise<string> {
  const id = crypto.randomUUID()
  await putAsset({ id, mime, blob, createdAt: Date.now() })
  return id
}

export async function loadAssetBlob(id: string): Promise<Blob | null> {
  const record = await getAsset(id)
  return record?.blob ?? null
}

export async function removeAsset(id: string): Promise<void> {
  await deleteAsset(id)
}
