import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { buildXlsx } from './xlsx'

describe('xlsx 生成', () => {
  it('生成结构完整、可被解包为 OOXML 的文件', async () => {
    const blob = buildXlsx([
      {
        name: '梦末百天纪念回',
        rows: [
          ['抖音ID', '收件名', '手机号'],
          ['mengmo', '小铃 & <测试>', '13800000000'],
          ['fan02', '阿蓝', 13800000001],
        ],
      },
    ])
    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()))
    const names = Object.keys(files)
    expect(names).toContain('[Content_Types].xml')
    expect(names).toContain('xl/workbook.xml')
    expect(names).toContain('xl/worksheets/sheet1.xml')

    const workbook = strFromU8(files['xl/workbook.xml'])
    expect(workbook).toContain('梦末百天纪念回')

    const sheet = strFromU8(files['xl/worksheets/sheet1.xml'])
    expect(sheet).toContain('抖音ID')
    expect(sheet).toContain('小铃 &amp; &lt;测试&gt;')
    expect(sheet).toContain('13800000001')
  })

  it('工作表名中的非法字符会被清理', async () => {
    const blob = buildXlsx([{ name: 'a[b]:c/d', rows: [['x']] }])
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()))
    const workbook = strFromU8(files['xl/workbook.xml'])
    expect(workbook).not.toContain('a[b]')
  })
})
