import { strFromU8, unzipSync } from 'fflate'

/**
 * 轻量 .xlsx 读取器：只做本应用需要的事——把第一个工作表读成字符串网格。
 * 支持 Excel / WPS / 本应用导出的文件（inlineStr、sharedStrings、数字、str、布尔）。
 */

function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/&amp;/g, '&')
}

function extractText(xml: string): string {
  const textPattern = /<t\b[^>]*>([\s\S]*?)<\/t>/g
  let output = ''
  let match: RegExpExecArray | null
  while ((match = textPattern.exec(xml)) !== null) {
    output += unescapeXml(match[1])
  }
  return output
}

function columnIndexFromRef(ref: string): number {
  const letters = (ref.match(/^[A-Za-z]+/)?.[0] ?? 'A').toUpperCase()
  let index = 0
  for (const char of letters) {
    index = index * 26 + (char.charCodeAt(0) - 64)
  }
  return index - 1
}

function parseSharedStrings(xml: string | undefined): string[] {
  if (!xml) return []
  const itemPattern = /<si>([\s\S]*?)<\/si>/g
  const items: string[] = []
  let match: RegExpExecArray | null
  while ((match = itemPattern.exec(xml)) !== null) {
    items.push(extractText(match[1]))
  }
  return items
}

function parseSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = []
  const rowPattern = /<row\b[^>]*>([\s\S]*?)<\/row>/g
  const cellPattern = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g
  let rowMatch: RegExpExecArray | null
  while ((rowMatch = rowPattern.exec(xml)) !== null) {
    const row: string[] = []
    cellPattern.lastIndex = 0
    let cellMatch: RegExpExecArray | null
    while ((cellMatch = cellPattern.exec(rowMatch[1])) !== null) {
      const attrs = cellMatch[1] ?? ''
      const inner = cellMatch[2] ?? ''
      const ref = attrs.match(/\br="([A-Za-z]+\d+)"/)?.[1]
      const type = attrs.match(/\bt="([^"]+)"/)?.[1]
      const column = ref ? columnIndexFromRef(ref) : row.length

      let value = ''
      if (type === 'inlineStr') {
        value = extractText(inner)
      } else if (type === 's') {
        const index = Number(inner.match(/<v>(\d+)<\/v>/)?.[1] ?? '-1')
        value = shared[index] ?? ''
      } else if (type === 'str') {
        value = unescapeXml(inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '')
      } else if (type === 'b') {
        value = inner.includes('<v>1</v>') ? 'TRUE' : 'FALSE'
      } else {
        value = unescapeXml(inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '')
      }

      while (row.length < column) row.push('')
      row[column] = value
    }
    rows.push(row)
  }
  return rows
}

/** 读取 .xlsx 的第一个工作表，返回按行组织的字符串网格 */
export function parseXlsx(data: Uint8Array): string[][] {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(data)
  } catch {
    throw new Error('无法读取这个文件，请用 Excel / WPS 另存为 .xlsx 后再上传')
  }
  const sheetKey = Object.keys(files).find((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
  if (!sheetKey) {
    throw new Error('文件里没有找到工作表，请确认导出的是 .xlsx 格式')
  }
  const sharedXml = files['xl/sharedStrings.xml']
  const shared = parseSharedStrings(sharedXml ? strFromU8(sharedXml) : undefined)
  const rows = parseSheet(strFromU8(files[sheetKey]), shared)
  return rows.filter((row) => row.some((cell) => cell.trim() !== ''))
}
