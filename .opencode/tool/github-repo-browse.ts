/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin"

const GITHUB_API = "https://api.github.com"
const RAW_CONTENT = "https://raw.githubusercontent.com"

/**
 * Helper: fetch from GitHub API with auth header.
 */
async function githubFetch(endpoint: string, options: RequestInit = {}) {
  const url = `${GITHUB_API}${endpoint}`
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "opencode-github-browse",
    ...(options.headers as Record<string, string> | undefined),
  }
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  }

  const response = await fetch(url, { ...options, headers })
  if (!response.ok) {
    const body = await response.text().catch(() => "")
    const rateLimit = response.headers.get("x-ratelimit-remaining")
    const resetTime = response.headers.get("x-ratelimit-reset")
    let msg = `GitHub API error: ${response.status} ${response.statusText}`
    if (body) msg += `\n${body.slice(0, 500)}`
    if (rateLimit === "0" && resetTime) {
      const resetDate = new Date(parseInt(resetTime) * 1000)
      msg += `\nRate limit exhausted. Resets at ${resetDate.toISOString()}`
    }
    throw new Error(msg)
  }
  return response.json()
}

/**
 * Guess language label from file extension
 */
function extToLang(ext: string): string {
  const map: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".py": "python",
    ".rs": "rust",
    ".go": "go",
    ".java": "java",
    ".rb": "ruby",
    ".c": "c",
    ".cpp": "cpp",
    ".h": "c",
    ".hpp": "cpp",
    ".cs": "csharp",
    ".swift": "swift",
    ".kt": "kotlin",
    ".scala": "scala",
    ".php": "php",
    ".sh": "bash",
    ".bash": "bash",
    ".zsh": "bash",
    ".ps1": "powershell",
    ".css": "css",
    ".scss": "scss",
    ".html": "html",
    ".json": "json",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".toml": "toml",
    ".md": "markdown",
    ".sql": "sql",
    ".graphql": "graphql",
    ".dockerfile": "dockerfile",
    ".vue": "vue",
    ".svelte": "svelte",
  }
  return map[ext] ?? ""
}

/**
 * Format file size in human-readable form
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ---------------------------------------------------------------------------
// Tool: githubRepoBrowse
// ---------------------------------------------------------------------------

export const githubRepoBrowse = tool({
  description: `Browse a GitHub repository: list files/directories, view file contents, or get repository metadata.

Use this tool to explore any public GitHub repository's structure and read file contents.

Actions:
- "tree": List the repository's file tree (optionally recursive, optionally filtered by path)
- "file": Fetch the contents of a specific file
- "info": Get repository metadata (description, stars, language, topics, etc.)

Examples:
- List root files: owner="facebook" repo="react" action="tree" ref="main"
- Browse src/ directory recursively: owner="anomalyco" repo="opencode" action="tree" ref="dev" path="packages/opencode/src"
- Read a file: owner="anomalyco" repo="opencode" action="file" path="packages/opencode/src/index.ts" ref="dev"
- Get repo info: owner="anomalyco" repo="opencode" action="info"
`,
  args: {
    owner: tool.schema.string().describe("Repository owner (user or organization)"),
    repo: tool.schema.string().describe("Repository name"),
    action: tool.schema
      .enum(["tree", "file", "info"])
      .describe("Action: 'tree' to list files, 'file' to read a file, 'info' for repo metadata"),
    path: tool.schema
      .string()
      .optional()
      .describe(
        "Path within the repo. For 'tree': directory to list (default: root). For 'file': path to the file to read.",
      ),
    ref: tool.schema
      .string()
      .optional()
      .default("HEAD")
      .describe("Branch name, tag, or commit SHA (default: HEAD / default branch)"),
    recursive: tool.schema
      .boolean()
      .optional()
      .default(false)
      .describe("For 'tree' action: list files recursively (may be large for big repos)"),
    maxFiles: tool.schema
      .number()
      .optional()
      .default(200)
      .describe("For 'tree' action: max entries to return (default: 200)"),
  },
  async execute(args, _ctx: ToolContext) {
    const { owner, repo, action, path: filePath, ref = "HEAD", recursive = false, maxFiles = 200 } = args

    // Resolve ref to a branch/commit — GitHub API accepts branch names, tags, SHAs
    const resolvedRef = ref === "HEAD" ? "" : ref

    switch (action) {
      // ---- Repo info ----
      case "info": {
        const data: any = await githubFetch(`/repos/${owner}/${repo}`)
        const lines: string[] = []
        lines.push(`# ${data.full_name}`)
        if (data.description) lines.push(`\n${data.description}`)
        lines.push("")
        lines.push(`- **Stars**: ${data.stargazers_count}`)
        lines.push(`- **Forks**: ${data.forks_count}`)
        lines.push(`- **Language**: ${data.language ?? "N/A"}`)
        lines.push(`- **License**: ${data.license?.spdx_id ?? "N/A"}`)
        lines.push(`- **Default branch**: ${data.default_branch}`)
        lines.push(`- **Topics**: ${(data.topics ?? []).join(", ") || "none"}`)
        lines.push(`- **Open issues**: ${data.open_issues_count}`)
        lines.push(`- **Size**: ${formatSize(data.size * 1024)} (on disk)`)
        lines.push(`- **Created**: ${new Date(data.created_at).toISOString().split("T")[0]}`)
        lines.push(`- **Last updated**: ${new Date(data.updated_at).toISOString().split("T")[0]}`)
        lines.push(`- **Archived**: ${data.archived}`)
        lines.push("")
        if (data.owner?.login) {
          lines.push(`[Repository](${data.html_url})`)
        }
        return lines.join("\n")
      }

      // ---- File tree ----
      case "tree": {
        // First get the default branch tip commit if ref is HEAD
        let refToUse = resolvedRef
        if (!refToUse) {
          const repoData: any = await githubFetch(`/repos/${owner}/${repo}`)
          refToUse = repoData.default_branch
        }

        // Get the tree
        const treeEndpoint = filePath
          ? `/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(refToUse)}`
          : `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(refToUse)}${recursive ? "?recursive=1" : ""}`

        const data = await githubFetch(treeEndpoint)

        // If it's a file (from contents endpoint), redirect to file viewer
        if (!Array.isArray(data) && data.type === "file") {
          // Fetch and display file
          const content = data.encoding === "base64"
            ? atob(data.content.replace(/\n/g, ""))
            : "(binary file, cannot display)"

          const lang = extToLang(data.name ? "." + data.name.split(".").pop()! : "")
          const size = data.size ?? 0
          const truncated = size > 100 * 1024
          const displayContent = truncated ? content.slice(0, 100 * 1024) + `\n\n... (file truncated at 100 KB, full size: ${formatSize(size)})` : content

          return [
            `## ${data.path}`,
            `   ${data.html_url}`,
            `   Size: ${formatSize(size)}`,
            "",
            "```" + lang,
            displayContent,
            "```",
          ].join("\n")
        }

        // It's a directory listing (array from contents API, or tree from git API)
        const entries: any[] = Array.isArray(data) ? data : (data.tree ?? [])

        if (entries.length === 0) {
          return `No files found at "${filePath || "/"}" in ${owner}/${repo}`
        }

        // Separate dirs and files
        const dirs = entries.filter((e: any) => e.type === "tree" || e.type === "dir")
        const files = entries.filter((e: any) => e.type === "blob" || e.type === "file")

        const effectiveDirLimit = Math.min(maxFiles, 500)

        // Format output
        const lines: string[] = []
        const displayPath = filePath || "/"
        lines.push(`# ${owner}/${repo} — ${displayPath} (ref: ${refToUse})`)
        lines.push("")

        if (dirs.length > 0) {
          lines.push(`## Directories (${dirs.length})`)
          for (const dir of dirs.slice(0, 100)) {
            lines.push(`  📁 ${dir.path ?? dir.name}/`)
          }
          if (dirs.length > 100) {
            lines.push(`  ... and ${dirs.length - 100} more`)
          }
          lines.push("")
        }

        if (files.length > 0) {
          lines.push(`## Files (${files.length})`)
          for (const file of files.slice(0, effectiveDirLimit)) {
            const name = file.path ?? file.name
            const size = file.size != null ? ` (${formatSize(file.size)})` : ""
            lines.push(`  📄 ${name}${size}`)
          }
          if (files.length > effectiveDirLimit) {
            lines.push(`  ... and ${files.length - effectiveDirLimit} more files`)
          }
          lines.push("")
        }

        lines.push("---")
        lines.push(`Total: ${dirs.length} directories, ${files.length} files`)
        lines.push("")
        lines.push(
          "Tip: Use action='file' to read a specific file, or githubCodeSearch to search for code patterns.",
        )

        return lines.join("\n")
      }

      // ---- File content ----
      case "file": {
        if (!filePath) {
          return "Error: 'path' parameter is required for action='file'"
        }

        const encodedPath = filePath.split("/").map(encodeURIComponent).join("/")
        const refToUse2 = resolvedRef || (await getDefaultBranch(owner, repo))

        // Try raw.githubusercontent.com first (faster, no rate limit)
        const rawUrl = `${RAW_CONTENT}/${owner}/${repo}/${refToUse2}/${encodedPath}`
        const rawHeaders: Record<string, string> = {
          "User-Agent": "opencode-github-browse",
        }
        if (process.env.GITHUB_TOKEN) {
          rawHeaders.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
        }

        let rawResponse = await fetch(rawUrl, { headers: rawHeaders })

        // If raw content returns 404, fall back to Contents API
        if (!rawResponse.ok) {
          const data: any = await githubFetch(
            `/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(refToUse2)}`,
          )

          if (data.type !== "file") {
            return `"${filePath}" is not a file (type: ${data.type})`
          }

          const content = data.encoding === "base64"
            ? atob(data.content.replace(/\n/g, ""))
            : "(binary file, cannot display inline)"

          const lang = extToLang(data.name ? "." + data.name.split(".").pop()! : "")
          const size = data.size ?? 0
          const truncated = size > 100 * 1024
          const displayContent = truncated
            ? content.slice(0, 100 * 1024) + `\n\n... (file truncated at 100 KB, full size: ${formatSize(size)})`
            : content

          const lines: string[] = [
            `## ${data.path}`,
            `   ${data.html_url}`,
            `   Size: ${formatSize(size)}`,
            "",
            "```" + lang,
            displayContent,
            "```",
          ]

          if (truncated) {
            lines.push("")
            lines.push(`File is larger than 100 KB display limit. Full size: ${formatSize(size)}.`)
            lines.push("You can use the GitHub web interface to view the full file.")
          }

          return lines.join("\n")
        }

        // Raw content succeeded
        const rawText = await rawResponse.text()
        const rawSize = rawText.length
        const ext = "." + (filePath.split(".").pop() || "")
        const lang = extToLang(ext)
        const truncated = rawSize > 100 * 1024
        const displayContent = truncated
          ? rawText.slice(0, 100 * 1024) + `\n\n... (file truncated at 100 KB, full size: ${formatSize(rawSize)})`
          : rawText

        const lines: string[] = [
          `## ${filePath}`,
          `   ${rawUrl}`,
          `   Size: ${formatSize(rawSize)}`,
          "",
          "```" + lang,
          displayContent,
          "```",
        ]

        if (truncated) {
          lines.push("")
          lines.push(`File is larger than 100 KB display limit. Full size: ${formatSize(rawSize)}.`)
          lines.push("You can use the GitHub web interface to view the full file.")
        }

        return lines.join("\n")
      }

      default:
        return `Unknown action: ${action}. Valid actions: tree, file, info`
    }
  },
})

async function getDefaultBranch(owner: string, repo: string): Promise<string> {
  const data: any = await githubFetch(`/repos/${owner}/${repo}`)
  return data.default_branch
}

// ---------------------------------------------------------------------------
// Default export
// ---------------------------------------------------------------------------

export default githubRepoBrowse
