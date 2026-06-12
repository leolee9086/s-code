/// <reference path="../env.d.ts" />
import { tool } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin"

const GITHUB_API = "https://api.github.com"

/**
 * Helper: fetch from GitHub API with auth header.
 * Returns parsed JSON on success, throws on non-OK.
 */
async function githubFetch(endpoint: string, options: RequestInit = {}) {
  const url = `${GITHUB_API}${endpoint}`
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3.text-match+json",
    "Content-Type": "application/json",
    "User-Agent": "opencode-github-search",
    ...(options.headers as Record<string, string> | undefined),
  }
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  }

  const response = await fetch(url, {
    ...options,
    headers,
  })

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

// ---------------------------------------------------------------------------
// 1) Code search — GitHub's /search/code endpoint
// ---------------------------------------------------------------------------

export const githubCodeSearch = tool({
  description: `Search source code across any GitHub repository.

Uses GitHub's Code Search API to find code matching a query within a repository.
Results include file paths and URLs to the files on GitHub.

Examples:
- Search for "function foo" in facebook/react: query="function foo" owner="facebook" repo="react"
- Search for TODO comments in a repo: query="TODO" owner="anomalyco" repo="opencode"
- Search in a specific path: Adds path:src to the query automatically when pathFilter is set

Note:
- Searches only the default branch of the repository
- Requires a GITHUB_TOKEN environment variable for higher rate limits (5000/hr vs 60/hr unauthenticated)
- Results are limited to the first 100 matches per query
`,
  args: {
    query: tool.schema
      .string()
      .describe("Search query (supports GitHub code search qualifiers like language:ts, path:/src)"),
    owner: tool.schema.string().describe("Repository owner (user or organization name)"),
    repo: tool.schema.string().describe("Repository name"),
    pathFilter: tool.schema
      .string()
      .optional()
      .describe("Filter results to files under this path (e.g. 'src/', 'lib/')"),
    contextLines: tool.schema
      .number()
      .optional()
      .default(3)
      .describe("Number of context lines to show around each match (default: 3, max: 5)"),
    maxResults: tool.schema
      .number()
      .optional()
      .default(10)
      .describe("Maximum number of results to return (default: 10, max: 30)"),
  },
  async execute(args, _ctx: ToolContext) {
    const { query, owner, repo, pathFilter, contextLines = 3, maxResults = 10 } = args
    const effectiveMax = Math.min(maxResults, 30)
    const effectiveContext = Math.min(contextLines, 5)

    // Build the search query — scope to repo and optional path
    let searchQuery = `${query} repo:${owner}/${repo}`
    if (pathFilter) {
      searchQuery += ` path:${pathFilter}`
    }

    const encodedQuery = encodeURIComponent(searchQuery)
    const perPage = Math.min(effectiveMax, 30)
    const result = await githubFetch(
      `/search/code?q=${encodedQuery}&per_page=${perPage}&sort=indexed&order=desc`,
    )

    if (result.total_count === 0) {
      return `No code results found for "${query}" in ${owner}/${repo}${pathFilter ? ` under ${pathFilter}` : ""}`
    }

    const items = result.items
    const shown = items.slice(0, effectiveMax)

    // Fetch text_matches (code snippets with context) for each result
    // GitHub's code search returns text_matches in the preview API
    const lines: string[] = []
    lines.push(`Found ${result.total_count} result(s) in ${owner}/${repo} (showing ${shown.length}):`)
    lines.push("")

    for (const item of shown) {
      const fileName = item.name
      const filePath = item.path
      const htmlUrl = item.html_url
      lines.push(`## ${filePath}`)
      lines.push(`   ${htmlUrl}`)

      // If text matches are available (code search preview), show them
      if (item.text_matches && item.text_matches.length > 0) {
        for (const match of item.text_matches) {
          const fragment = match.fragment as string | undefined
          if (fragment) {
            const matchLines = fragment.split("\n")
            const snippet = matchLines.slice(0, effectiveContext * 2 + 1).join("\n")
            lines.push("```" + (item.language?.toLowerCase() ?? ""))
            lines.push(snippet)
            if (matchLines.length > effectiveContext * 2 + 1) {
              lines.push("...")
            }
            lines.push("```")
          }
        }
      }
      lines.push("")
    }

    if (result.total_count > effectiveMax) {
      lines.push(`--- ${result.total_count - effectiveMax} more result(s) omitted ---`)
    }

    lines.push("")
    lines.push("Tip: Use githubRepoBrowse to view the full content of any file listed above.")

    return lines.join("\n")
  },
})

// ---------------------------------------------------------------------------
// 2) Default export — the tool registered by opencode
// ---------------------------------------------------------------------------

export default githubCodeSearch
