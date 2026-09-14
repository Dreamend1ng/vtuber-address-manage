import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { wipeDatabase } from '../storage/db'
import { loadAssetBlob, saveAssetBlob } from './assets'
import { buildBackup, mergeBackup, parseBackup, restoreBackup } from './backup'
import { addresses, createAddress, loadRecords } from './records'
import { initializeVault, setupVault, unlockVault } from './vault'

function addressInput(name: string, phone: string) {
  return {
    name,
    phone,
    province: '',
    city: '',
    district: '',
    detail: `${name}的测试地址`,
    postalCode: '',
    tags: [],
    notes: '',
    source: 'form' as const,
    eventId: null,
  }
}

describe('加密备份与恢复', () => {
  it('导出 → 恢复 → 用原主密码解锁，数据与背景图完整回来', async () => {
    await wipeDatabase()
    await initializeVault()
    await setupVault('password-A-123')
    await createAddress(addressInput('测试粉丝甲', '13800000000'))
    const assetId = await saveAssetBlob(
      new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' }),
      'image/jpeg',
    )

    const backup = await buildBackup()
    const text = JSON.stringify(backup)
    // 备份文件里只有密文，不应出现明文姓名
    expect(text).not.toContain('测试粉丝甲')
    expect(text).toContain('image/jpeg')

    // 模拟换设备 / 数据被清理
    await wipeDatabase()
    await initializeVault()
    await loadRecords().catch(() => undefined)
    expect(addresses.value).toHaveLength(0)

    await restoreBackup(parseBackup(text))
    await initializeVault()
    // 恢复后处于锁定状态，必须用备份的主密码解锁（回归：旧实现会沿用旧密钥配置导致解不开）
    expect(addresses.value).toHaveLength(0)

    await unlockVault('password-A-123')
    await loadRecords()
    expect(addresses.value.map((item) => item.name)).toEqual(['测试粉丝甲'])

    const asset = await loadAssetBlob(assetId)
    expect(asset).not.toBeNull()
    expect(new Uint8Array(await asset!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]))
  })

  it('恢复后旧密码无法解锁', async () => {
    const backup = await buildBackup()
    await restoreBackup(backup)
    await initializeVault()
    await expect(unlockVault('wrong-password')).rejects.toThrow(/主密码/)
  })

  it('合并导入：用备份密码并入当前保险库，双方数据都保留', async () => {
    const backup = await buildBackup()

    await wipeDatabase()
    await initializeVault()
    await setupVault('password-B-456')
    await createAddress(addressInput('本机粉丝乙', '13900000000'))

    const merged = await mergeBackup(backup, 'password-A-123')
    expect(merged.added).toBeGreaterThanOrEqual(1)

    await loadRecords()
    const names = addresses.value.map((item) => item.name)
    expect(names).toContain('测试粉丝甲')
    expect(names).toContain('本机粉丝乙')
  })

  it('合并时密码错误会明确报错', async () => {
    const backup = await buildBackup()
    await expect(mergeBackup(backup, 'wrong-password')).rejects.toThrow(/主密码/)
  })

  it('损坏的文件会被拒绝', () => {
    expect(() => parseBackup('not json at all')).toThrow(/JSON/)
    expect(() => parseBackup('{"magic":"dispatch-desk-backup"}')).toThrow(/损坏/)
  })
})
