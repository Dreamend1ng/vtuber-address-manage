import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { getVaultMeta, wipeDatabase } from '../storage/db'
import {
  changePassword,
  initializeVault,
  recoverVault,
  regenerateRecoveryCode,
  setupVault,
  unlockVault,
} from './vault'

describe('保险库密钥管理', () => {
  it('修改主密码 / 重新生成恢复码：不会把响应式代理写进 IndexedDB', async () => {
    await wipeDatabase()
    await initializeVault()
    await setupVault('old-password-1')

    // 回归：这两步此前会把 Vue 的响应式代理写入 IndexedDB，抛 DataCloneError
    await changePassword('old-password-1', 'new-password-2')
    const { recoveryCode } = await regenerateRecoveryCode('new-password-2')

    const meta = await getVaultMeta()
    expect(meta?.crypto.wrappedDek.data).toBeTruthy()
    expect(meta?.crypto.wrappedDekByRecovery.data).toBeTruthy()

    // 旧密码失效，新密码可用
    await initializeVault()
    await expect(unlockVault('old-password-1')).rejects.toThrow(/主密码/)
    await unlockVault('new-password-2')

    // 恢复码依然有效，并能再次重设主密码
    await initializeVault()
    await recoverVault(recoveryCode, 'third-password-3')
    await initializeVault()
    await unlockVault('third-password-3')
  })
})
