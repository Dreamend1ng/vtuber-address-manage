import { base64ToBytes, bytesToBase64, type Bytes } from '../crypto/encoding'

/** 收集通道的 GitHub 目标 */
export interface GithubTarget {
  repo: string
  branch: string
  token: string
}

const API_BASE = 'https://api.github.com'

export class GithubError extends Error {
  status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'GithubError'
    this.status = status
  }
}

function requestHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
  }
}

/** 把粘贴进来的完整仓库地址整理成 owner/name */
export function normalizeRepo(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '')
}

export function isValidRepo(repo: string): boolean {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)
}

function repoPath(target: GithubTarget): string {
  const repo = normalizeRepo(target.repo)
  if (!isValidRepo(repo)) {
    throw new GithubError('仓库格式不正确，应为 owner/name，例如 yourname/vam-collect')
  }
  return repo
}

/**
 * 统一包裹 fetch：把网络层失败（含被代理/插件拦截导致的跨域失败）
 * 转成可读的提示，避免用户只看到 "Failed to fetch"。
 */
async function safeFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch (error) {
    console.error('GitHub 请求被网络层拦截', error)
    throw new GithubError(
      '无法连接 GitHub（api.github.com）。常见原因：当前网络禁止访问 GitHub API、代理或浏览器插件拦截。请更换网络后重试。',
    )
  }
}

/** 不带凭证的可达性探测：用于区分「网络问题」还是「Token/仓库问题」 */
export async function checkGithubReachability(): Promise<boolean> {
  try {
    const response = await fetch('https://api.github.com/', {
      headers: { Accept: 'application/vnd.github+json' },
    })
    return response.ok
  } catch {
    return false
  }
}

async function describeFailure(response: Response): Promise<string> {
  let detail = ''
  try {
    const body = (await response.json()) as { message?: string }
    detail = body.message ?? ''
  } catch {
    detail = ''
  }
  switch (response.status) {
    case 401:
      return 'Token 无效或已过期，请重新生成并保存'
    case 403:
      return `权限不足或触发 GitHub 限流${detail ? `（${detail}）` : ''}`
    case 404:
      return '仓库不存在，或 Token 无权访问它。请确认：① 仓库已创建（打开仓库页面能正常显示）；② Token 的 Repository access 里勾选了这个仓库（创建 Token 后才新建的仓库不会自动生效，需要在 Token 设置里手动加上）'
    case 409:
    case 422:
      return `仓库发生冲突，请稍后重试${detail ? `（${detail}）` : ''}`
    default:
      return `GitHub 请求失败（${response.status}）${detail ? `：${detail}` : ''}`
  }
}

async function request<T>(target: GithubTarget, path: string, init?: RequestInit): Promise<T> {
  const response = await safeFetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...requestHeaders(target.token),
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  })
  if (!response.ok) {
    throw new GithubError(await describeFailure(response), response.status)
  }
  return await readJson<T>(response)
}

/** 代理/防火墙有时会返回伪装成 200 的 HTML 页面，这里统一给出可读提示 */
async function readJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T
  } catch {
    throw new GithubError('GitHub 返回了非预期内容，请求可能被代理或网络过滤拦截了')
  }
}

export interface RepoInfo {
  full_name: string
  private: boolean
  default_branch: string
}

export async function getRepo(target: GithubTarget): Promise<RepoInfo> {
  return request<RepoInfo>(target, `/repos/${repoPath(target)}`)
}

export interface RemoteFile {
  path: string
  sha: string
  bytes: Bytes
}

/** 读取单个文件；不存在返回 null。文件需小于 1MB（远大于本应用所需） */
export async function getFile(target: GithubTarget, path: string): Promise<RemoteFile | null> {
  const response = await safeFetch(
    `${API_BASE}/repos/${repoPath(target)}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(target.branch)}`,
    { headers: requestHeaders(target.token) },
  )
  if (response.status === 404) return null
  if (!response.ok) throw new GithubError(await describeFailure(response), response.status)
  const body = await readJson<{ sha: string; content?: string; encoding?: string; size: number }>(response)
  if (body.encoding !== 'base64' || typeof body.content !== 'string') {
    throw new GithubError('文件过大或格式不支持')
  }
  return { path, sha: body.sha, bytes: base64ToBytes(body.content.replace(/\s/g, '')) }
}

export async function putFile(
  target: GithubTarget,
  path: string,
  bytes: Bytes | Uint8Array,
  message: string,
  sha?: string,
): Promise<void> {
  await request(target, `/repos/${repoPath(target)}/contents/${encodeURIComponent(path)}`, {
    method: 'PUT',
    body: JSON.stringify({
      message,
      content: bytesToBase64(bytes),
      branch: target.branch,
      ...(sha ? { sha } : {}),
    }),
  })
}

export interface RemoteEntry {
  name: string
  path: string
  sha: string
  type: string
}

/** 列出目录下的文件；目录不存在返回空数组 */
export async function listDirectory(target: GithubTarget, path: string): Promise<RemoteEntry[]> {
  const response = await safeFetch(
    `${API_BASE}/repos/${repoPath(target)}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(target.branch)}`,
    { headers: requestHeaders(target.token) },
  )
  if (response.status === 404) return []
  if (!response.ok) throw new GithubError(await describeFailure(response), response.status)
  const body = await readJson<RemoteEntry[] | RemoteEntry>(response)
  const entries = Array.isArray(body) ? body : [body]
  return entries.filter((entry) => entry.type === 'file')
}

export async function deleteFile(
  target: GithubTarget,
  path: string,
  sha: string,
  message: string,
): Promise<void> {
  await request(target, `/repos/${repoPath(target)}/contents/${encodeURIComponent(path)}`, {
    method: 'DELETE',
    body: JSON.stringify({ message, sha, branch: target.branch }),
  })
}
