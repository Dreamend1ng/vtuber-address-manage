import { reactive } from 'vue'
import { siteConfig } from '../config'
import { updateSettings } from './records'

const API_BASE = 'https://api.github.com'
const DEFAULT_UPSTREAM = 'Dreamend1ng/vtuber-address-manage'

/** 一键更新时保留的文件：这些属于用户自己的定制，更新不应覆盖 */
const PRESERVE_PATHS = new Set(['src/config.ts', 'public/favicon.svg', 'README.md', 'TUTORIAL.md'])

export interface UpdateInfo {
  currentVersion: string
  latestVersion: string
  hasUpdate: boolean
  notesUrl: string
  releasedAt?: string
}

/** 更新提示弹窗状态：解锁后检测与设置页「检查更新」共用 */
export const updateNotice = reactive<{ visible: boolean; info: UpdateInfo | null }>({
  visible: false,
  info: null,
})

export function showUpdateNotice(info: UpdateInfo): void {
  updateNotice.info = info
  updateNotice.visible = true
}

export function defaultUpstream(): string {
  return DEFAULT_UPSTREAM
}

/** 从部署地址推断自己的站点仓库（仅 GitHub Pages 有效） */
export function detectOwnRepo(): string {
  const host = location.hostname
  if (!host.endsWith('.github.io')) return ''
  const owner = host.slice(0, -'.github.io'.length)
  const repo = location.pathname.split('/').filter(Boolean)[0] ?? ''
  return repo ? `${owner}/${repo}` : ''
}

function versionParts(value: string): number[] {
  return value
    .replace(/^v/i, '')
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0)
}

/** 比较版本号：latest 比 current 新时返回 true */
export function isNewerVersion(latest: string, current: string): boolean {
  const a = versionParts(latest)
  const b = versionParts(current)
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const left = a[index] ?? 0
    const right = b[index] ?? 0
    if (left !== right) return left > right
  }
  return false
}

async function fetchUpstreamVersion(
  repo: string,
): Promise<{ version: string; notesUrl: string; releasedAt?: string } | null> {
  // 上游是公开仓库：匿名读取即可，不使用任何 Token
  try {
    const response = await fetch(`${API_BASE}/repos/${repo}/contents/version.json`, {
      headers: { Accept: 'application/vnd.github.raw+json' },
    })
    if (response.ok) {
      const data = (await response.json()) as { version?: string; releasedAt?: string; notesUrl?: string }
      if (data.version) {
        return {
          version: data.version,
          notesUrl: data.notesUrl ?? `https://github.com/${repo}/releases`,
          releasedAt: data.releasedAt,
        }
      }
    }
  } catch {
    // 网络失败时退回 Releases 接口
  }
  try {
    const response = await fetch(`${API_BASE}/repos/${repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!response.ok) return null
    const data = (await response.json()) as { tag_name?: string; html_url?: string; published_at?: string }
    if (!data.tag_name) return null
    return {
      version: data.tag_name,
      notesUrl: data.html_url ?? `https://github.com/${repo}/releases`,
      releasedAt: data.published_at,
    }
  } catch {
    return null
  }
}

/** 检查上游是否有新版本；网络不可达时返回 null（静默失败，不打扰用户） */
export async function checkForUpdate(repo?: string): Promise<UpdateInfo | null> {
  const target = (repo ?? DEFAULT_UPSTREAM).trim() || DEFAULT_UPSTREAM
  const upstream = await fetchUpstreamVersion(target)
  if (!upstream) return null
  const latest = upstream.version.replace(/^v/i, '')
  return {
    currentVersion: siteConfig.version,
    latestVersion: latest,
    hasUpdate: isNewerVersion(latest, siteConfig.version),
    notesUrl: upstream.notesUrl,
    releasedAt: upstream.releasedAt,
  }
}

/* ---------- 一键更新 ---------- */

export type UpdateProgress = (message: string) => void

export interface UpdateResult {
  files: number
  commitSha: string
}

interface GithubTreeEntry {
  path: string
  mode: string
  type: string
  sha: string
}

async function githubRequest(url: string, init?: RequestInit, token?: string): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' }
  if (token) headers.Authorization = `Bearer ${token}`
  if (init?.body) headers['Content-Type'] = 'application/json'
  try {
    return await fetch(url, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } })
  } catch {
    throw new Error('无法连接 GitHub，请检查网络后重试')
  }
}

async function githubJson<T>(url: string, init?: RequestInit, token?: string): Promise<T> {
  const response = await githubRequest(url, init, token)
  if (!response.ok) {
    if (response.status === 401) throw new Error('更新 Token 无效或已过期，请重新生成')
    if (response.status === 403) throw new Error('更新 Token 权限不足：需要站点仓库的 Contents 读写权限')
    if (response.status === 404) throw new Error('仓库不存在或 Token 无权访问，请检查仓库名与 Token 授权范围')
    throw new Error(`GitHub 请求失败（${response.status}）`)
  }
  return (await response.json()) as T
}

/**
 * 一键更新：把上游最新代码同步到自己的站点仓库。
 * 只更新有变化的代码文件，跳过 docs/ 与自己的定制文件，最后提交一次由 Actions 重新部署。
 */
export async function applyUpdate(onProgress?: UpdateProgress): Promise<UpdateResult> {
  const settings = updateSettings.value
  if (!settings) throw new Error('还没有配置更新设置')
  const upstream = (settings.upstream || DEFAULT_UPSTREAM).trim()
  const ownRepo = settings.ownRepo.trim()
  const token = settings.token.trim()
  if (!ownRepo) throw new Error('请先填写自己的站点仓库')
  if (!token) throw new Error('请先配置更新 Token（只授权站点仓库的 Contents 读写）')

  onProgress?.('读取上游最新代码…')
  const upstreamRepo = await githubJson<{ default_branch?: string }>(`${API_BASE}/repos/${upstream}`)
  const upstreamBranch = upstreamRepo.default_branch || 'main'
  const upstreamRef = await githubJson<{ object: { sha: string } }>(
    `${API_BASE}/repos/${upstream}/git/ref/heads/${upstreamBranch}`,
  )
  const upstreamTree = await githubJson<{ tree: GithubTreeEntry[]; truncated?: boolean }>(
    `${API_BASE}/repos/${upstream}/git/trees/${upstreamRef.object.sha}?recursive=1`,
  )
  if (upstreamTree.truncated) throw new Error('上游仓库过大，一键更新暂不支持')

  onProgress?.('读取你的站点仓库…')
  const ownRepoInfo = await githubJson<{ default_branch?: string }>(`${API_BASE}/repos/${ownRepo}`, undefined, token)
  const ownBranch = ownRepoInfo.default_branch || 'main'
  const ownRef = await githubJson<{ object: { sha: string } }>(
    `${API_BASE}/repos/${ownRepo}/git/ref/heads/${ownBranch}`,
    undefined,
    token,
  )
  const ownTree = await githubJson<{ sha: string; tree: GithubTreeEntry[] }>(
    `${API_BASE}/repos/${ownRepo}/git/trees/${ownRef.object.sha}?recursive=1`,
    undefined,
    token,
  )

  const ownShas = new Map(
    ownTree.tree.filter((entry) => entry.type === 'blob').map((entry) => [entry.path, entry.sha]),
  )
  const shouldSync = (path: string): boolean => {
    if (path.startsWith('docs/')) return false
    if (PRESERVE_PATHS.has(path)) return false
    return true
  }
  const changed = upstreamTree.tree.filter(
    (entry) => entry.type === 'blob' && shouldSync(entry.path) && ownShas.get(entry.path) !== entry.sha,
  )

  if (changed.length === 0) {
    return { files: 0, commitSha: ownRef.object.sha }
  }

  onProgress?.(`同步 ${changed.length} 个文件…`)
  const blobs: { path: string; mode: string; type: 'blob'; sha: string }[] = []
  for (const entry of changed) {
    const source = await githubJson<{ content: string }>(
      `${API_BASE}/repos/${upstream}/git/blobs/${entry.sha}`,
    )
    const created = await githubJson<{ sha: string }>(
      `${API_BASE}/repos/${ownRepo}/git/blobs`,
      {
        method: 'POST',
        body: JSON.stringify({ content: source.content.replace(/\s/g, ''), encoding: 'base64' }),
      },
      token,
    )
    blobs.push({ path: entry.path, mode: entry.mode, type: 'blob', sha: created.sha })
  }

  onProgress?.('创建提交…')
  const newTree = await githubJson<{ sha: string }>(
    `${API_BASE}/repos/${ownRepo}/git/trees`,
    { method: 'POST', body: JSON.stringify({ base_tree: ownTree.sha, tree: blobs }) },
    token,
  )
  const commit = await githubJson<{ sha: string }>(
    `${API_BASE}/repos/${ownRepo}/git/commits`,
    {
      method: 'POST',
      body: JSON.stringify({
        message: `更新到 v${updateNotice.info?.latestVersion ?? siteConfig.version}（寄件台一键更新）`,
        tree: newTree.sha,
        parents: [ownRef.object.sha],
      }),
    },
    token,
  )

  onProgress?.('更新站点仓库…')
  await githubJson(
    `${API_BASE}/repos/${ownRepo}/git/refs/heads/${ownBranch}`,
    { method: 'PATCH', body: JSON.stringify({ sha: commit.sha }) },
    token,
  )

  return { files: changed.length, commitSha: commit.sha }
}
