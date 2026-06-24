import { getUserGithubToken } from "../services/githubOAuthService.js"

export interface RepoFile {
  path: string
  type: "blob" | "tree"
  size?: number
  sha?: string
}

export interface RepoFetchedFile {
  file: RepoFile
  content: string
}

export interface RepoSnapshot {
  owner: string
  repo: string
  repoName: string
  allFiles: RepoFile[]
  validFiles: RepoFile[]
  skippedCount: number
  fetchedFiles: RepoFetchedFile[]
}

const SKIP_DIR_SEGMENTS = new Set([
  "node_modules", "dist", "build", ".next", ".git",
  "coverage", ".cache", "out", "__pycache__", ".pytest_cache",
  ".turbo", ".vercel", ".output", "vendor", "target",
  "bin", "obj", ".gradle", ".idea", ".vscode",
  ".yarn", ".pnp",
])

const SKIP_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp", ".bmp", ".tiff",
  ".exe", ".dll", ".so", ".dylib", ".bin", ".wasm",
  ".zip", ".tar", ".gz", ".rar", ".7z",
  ".mp4", ".mp3", ".wav", ".avi", ".mov", ".pdf",
  ".csv", ".parquet", ".sqlite", ".db",
  ".min.js", ".min.css",
  ".map",
  ".ttf", ".woff", ".woff2", ".eot",
  ".lock",
])

const SKIP_FILENAMES = new Set([
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
  "composer.lock", "Gemfile.lock", "poetry.lock",
  ".DS_Store", "Thumbs.db", ".gitkeep",
])

const KEEP_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs",
  ".java", ".cpp", ".c", ".cs", ".rb", ".php", ".swift",
  ".kt", ".scala", ".vue", ".svelte",
  ".json", ".yaml", ".yml", ".toml",
  ".md", ".mdx", ".txt", ".rst",
  ".html", ".css", ".scss", ".sass",
  ".env.example",
])

const MAX_FILE_SIZE = Number(process.env.GITHUB_MAX_FILE_SIZE ?? 500_000)

export function parseGithubUrl(url: string): { owner: string; repo: string } | null {
  try {
    const cleaned = url.trim().replace(/\/$/, "").replace(/\.git$/, "")
    const match = cleaned.match(
      /^https?:\/\/github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)/,
    )
    if (!match) return null
    return { owner: match[1]!, repo: match[2]! }
  } catch {
    return null
  }
}

function shouldSkipPath(filePath: string, size = 0): boolean {
  const parts = filePath.split("/")
  const fileName = parts[parts.length - 1] ?? ""
  const dotIdx = fileName.lastIndexOf(".")
  const ext = dotIdx > 0 ? fileName.slice(dotIdx).toLowerCase() : ""
  const nameParts = fileName.split(".")
  const compoundExt = nameParts.length > 2
    ? ("." + nameParts.slice(1).join(".")).toLowerCase()
    : ""

  if (size > MAX_FILE_SIZE) return true

  for (const seg of parts.slice(0, -1)) {
    if (SKIP_DIR_SEGMENTS.has(seg)) return true
    if (seg.startsWith(".") && seg !== ".github") return true
  }

  if (SKIP_FILENAMES.has(fileName)) return true
  if (SKIP_EXTENSIONS.has(ext) || SKIP_EXTENSIONS.has(compoundExt)) return true
  if (!KEEP_EXTENSIONS.has(ext) && !KEEP_EXTENSIONS.has(compoundExt)) return true

  return false
}

async function buildHeaders(userId: string): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "AdvancedRAG/1.0",
  }

  try {
    const userToken = await getUserGithubToken(userId)
    if (userToken) {
      headers.Authorization = `Bearer ${userToken}`
      return headers
    }
  } catch {
    // Fall through to env token.
  }

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  }

  if (!headers.Authorization) {
    console.warn(
      "⚠️  No GitHub token available. Rate limit is 60 req/hr.",
    )
  }

  return headers
}

async function fetchRepoTree(
  owner: string,
  repo: string,
  headers: Record<string, string>,
): Promise<RepoFile[]> {
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`
  const res = await fetch(url, { headers })

  if (res.status === 404) throw new Error("Repository not found or is private")
  if (res.status === 403) throw new Error("GitHub API rate limit exceeded. Try again in an hour.")
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)

  const data = await res.json() as {
    tree: { path: string; type: string; size?: number; sha: string }[]
    truncated: boolean
  }

  if (data.truncated) {
    console.warn("⚠️  Repo tree was truncated by GitHub (>100 000 files)")
  }

  return data.tree
    .filter((item) => item.type === "blob")
    .map((item) => ({
      path: item.path,
      type: "blob" as const,
      size: item.size ?? 0,
      sha: item.sha,
    }))
}

async function fetchBlob(
  owner: string,
  repo: string,
  sha: string,
  headers: Record<string, string>,
): Promise<string | null> {
  const url = `https://api.github.com/repos/${owner}/${repo}/git/blobs/${sha}`
  const res = await fetch(url, {
    headers: {
      ...headers,
      Accept: "application/vnd.github.raw",
    },
  })

  if (!res.ok) {
    console.warn(`  ⚠️  Blob ${sha} fetch failed: ${res.status}`)
    return null
  }

  const text = await res.text()
  if (text.includes("\x00")) return null
  return text
}

async function fetchFilesInBatches(
  owner: string,
  repo: string,
  files: RepoFile[],
  headers: Record<string, string>,
  concurrency = 8,
): Promise<RepoFetchedFile[]> {
  const results: RepoFetchedFile[] = []
  const total = Math.ceil(files.length / concurrency)

  for (let i = 0; i < files.length; i += concurrency) {
    const batch = files.slice(i, i + concurrency)
    const fetched = await Promise.all(
      batch.map(async (file) => {
        if (!file.sha) return null
        const content = await fetchBlob(owner, repo, file.sha, headers)
        return content ? { file, content } : null
      }),
    )

    fetched.forEach((result) => { if (result) results.push(result) })
    console.log(`  📥 RepoTreeAgent fetched batch ${Math.floor(i / concurrency) + 1}/${total}`)

    if (i + concurrency < files.length) {
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }

  return results
}

export async function fetchRepoSnapshot(
  repoUrl: string,
  userId: string,
): Promise<RepoSnapshot> {
  const parsed = parseGithubUrl(repoUrl)
  if (!parsed) throw new Error("Invalid GitHub URL")

  const { owner, repo } = parsed
  const repoName = `${owner}/${repo}`
  const headers = await buildHeaders(userId)

  console.log(`  🤖 RepoTreeAgent fetching tree for ${repoName}`)
  const allFiles = await fetchRepoTree(owner, repo, headers)
  const validFiles = allFiles.filter((file) => !shouldSkipPath(file.path, file.size))
  const skippedCount = allFiles.length - validFiles.length

  if (validFiles.length === 0) {
    throw new Error("No indexable files found in this repository")
  }

  console.log(`  🤖 RepoTreeAgent fetching ${validFiles.length} files`)
  const fetchedFiles = await fetchFilesInBatches(owner, repo, validFiles, headers)

  return {
    owner,
    repo,
    repoName,
    allFiles,
    validFiles,
    skippedCount,
    fetchedFiles,
  }
}
