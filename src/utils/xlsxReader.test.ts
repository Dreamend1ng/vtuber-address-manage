import { describe, expect, it } from 'vitest'
import { buildXlsx } from './xlsx'
import { parseXlsx } from './xlsxReader'

describe('xlsx 读取（与写入闭环）', () => {
  it('读回自己导出的表格', async () => {
    const rows: (string | number)[][] = [
      ['抖音ID', '收件名', '手机号', '快递公司', '快递单号'],
      ['mengmo', '小铃 & <测试>', '13800000000', '顺丰', 'SF1234567890'],
      ['fan02', '阿蓝', 13800000001, '', 'YT9876543210'],
    ]
    const blob = buildXlsx([{ name: '地址', rows }])
    const parsed = parseXlsx(new Uint8Array(await blob.arrayBuffer()))
    expect(parsed[0]).toEqual(['抖音ID', '收件名', '手机号', '快递公司', '快递单号'])
    expect(parsed[1][1]).toBe('小铃 & <测试>')
    expect(parsed[2][2]).toBe('13800000001')
    expect(parsed[2][4]).toBe('YT9876543210')
  })

  it('非法文件给出可读的错误', () => {
    expect(() => parseXlsx(new Uint8Array([1, 2, 3]))).toThrow(/xlsx/)
  })
})
