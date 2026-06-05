/**
 * 开放 API 搜索引擎集合
 *
 * 使用 JSON API 工厂批量创建的只读搜索引擎。
 * 所有引擎均使用公开 API，零风险。
 */
import { makeJsonApiEngine, makeSearchResult } from "./json-api"
import type { EngineConfig, SearchEngine } from "../engine"

// ── Unsplash（图片搜索）────────────────────────────────
// API: https://unsplash.com/documentation
// 无需 API key，但免费版有速率限制（50次/小时）
export function makeUnsplash(config: EngineConfig): SearchEngine {
  return makeJsonApiEngine({
    name: "unsplash",
    category: "image",
    requiresKey: false,
    url: (q, n) => `https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&per_page=${n}`,
    parse: (json: unknown, max: number) => {
      const data = json as { results?: Array<{ id: string; urls: { regular: string }; user: { name: string }; description?: string; links: { html: string } }> }
      if (!data?.results) return []
      return data.results.slice(0, max).map((p, i) =>
        makeSearchResult({ title: p.description || `Unsplash ${p.id}`, url: p.links.html, snippet: `Photo by ${p.user.name}`, engine: "unsplash", position: i + 1, category: "image" }))
    },
    debugLabel: "unsplash",
  })(config)
}

// ── Pixabay（图片/视频搜索）────────────────────────────
// API: https://pixabay.com/api/docs/
// 免费 API key 可用
export function makePixabay(config: EngineConfig): SearchEngine {
  return makeJsonApiEngine({
    name: "pixabay",
    category: "image",
    requiresKey: false,
    userAgent: "opencode-search/1.0",
    url: (q, n) => `https://pixabay.com/api/?key=&q=${encodeURIComponent(q)}&per_page=${n}&safesearch=true`,
    parse: (json: unknown, max: number) => {
      const data = json as { hits?: Array<{ id: number; pageURL: string; tags: string; user: string; type: string }> }
      if (!data?.hits) return []
      return data.hits.slice(0, max).map((p, i) =>
        makeSearchResult({ title: p.tags?.split(",")[0]?.trim() || `Pixabay ${p.id}`, url: p.pageURL, snippet: `By ${p.user} · ${p.type}`, engine: "pixabay", position: i + 1, category: p.type === "video" ? "video" : "image" }))
    },
  })(config)
}

// ── PubMed（医学文献）─────────────────────────────────
// API: https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi
// 公开 API，无需 key
export function makePubMed(config: EngineConfig): SearchEngine {
  return makeJsonApiEngine({
    name: "pubmed",
    category: "academic",
    url: (q, n) => `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(q)}&retmax=${n}&retmode=json&sort=relevance`,
    parse: (json: unknown, max: number) => {
      const data = json as { esearchresult?: { idlist?: string[]; count?: string } }
      const ids = data?.esearchresult?.idlist
      if (!ids || ids.length === 0) return []
      return ids.slice(0, max).map((id, i) =>
        makeSearchResult({ title: `PubMed ID: ${id}`, url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`, snippet: `Total results: ${data.esearchresult?.count || "?"}`, engine: "pubmed", position: i + 1, category: "academic" }))
    },
  })(config)
}

// ── Hacker News（技术新闻）────────────────────────────
// API: https://hn.algolia.com/api
// 公开 API，无限制
export function makeHackerNews(config: EngineConfig): SearchEngine {
  return makeJsonApiEngine({
    name: "hackernews",
    category: "news",
    url: (q, n) => `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&hitsPerPage=${n}`,
    parse: (json: unknown, max: number) => {
      const data = json as { hits?: Array<{ title: string; url?: string; objectID: string; points?: number; author: string; created_at: string }> }
      if (!data?.hits) return []
      return data.hits.slice(0, max).map((h, i) =>
        makeSearchResult({ title: h.title || "HN post", url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`, snippet: `${h.points || 0} points by ${h.author}`, engine: "hackernews", position: i + 1, category: "news", publishedDate: h.created_at ? new Date(h.created_at).getTime() : undefined }))
    },
  })(config)
}

// ── Docker Hub（容器镜像搜索）─────────────────────────
// API: https://docs.docker.com/docker-hub/api/latest/
export function makeDockerHub(config: EngineConfig): SearchEngine {
  return makeJsonApiEngine({
    name: "dockerhub",
    category: "code",
    url: (q, n) => `https://hub.docker.com/v2/repositories/library/${encodeURIComponent(q)}/?page_size=${n}`,
    parse: (json: unknown, max: number) => {
      // Docker Hub 的 API 结构特殊，按名称搜索仓库
      const data = json as { results?: Array<{ name: string; repo_name: string; short_description: string; pull_count: number; star_count: number }> }
      if (!data?.results) return []
      return data.results.slice(0, max).map((r, i) =>
        makeSearchResult({ title: r.repo_name || r.name, url: `https://hub.docker.com/r/${r.repo_name || r.name}`, snippet: r.short_description || `${r.pull_count || 0} pulls`, engine: "dockerhub", position: i + 1, category: "code" }))
    },
  })(config)
}

// ── NPM（包搜索）──────────────────────────────────────
// API: https://registry.npmjs.org/
export function makeNpm(config: EngineConfig): SearchEngine {
  return makeJsonApiEngine({
    name: "npm",
    category: "code",
    url: (q, n) => `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(q)}&size=${n}`,
    parse: (json: unknown, max: number) => {
      const data = json as { objects?: Array<{ package: { name: string; version: string; description?: string; links: { npm: string }; publisher?: { username: string } } }> }
      if (!data?.objects) return []
      return data.objects.slice(0, max).map((o, i) => {
        const pkg = o.package
        return makeSearchResult({ title: pkg.name, url: pkg.links.npm, snippet: `${pkg.version} — ${pkg.description || ""}`.trim(), engine: "npm", position: i + 1, category: "code" })
      })
    },
  })(config)
}

// ── PyPI（Python 包搜索）─────────────────────────────
// API: https://warehouse.pypa.io/api-reference/
// ── PyPI（Python 包搜索）─────────────────────────────
// 使用 libraries.io API（需要 API key）或 pypi.org 搜索 HTML
// 当前：用 pypi.org 搜索 HTML 作降级方案
export function makePyPI(config: EngineConfig): SearchEngine {
  return makeJsonApiEngine({
    name: "pypi",
    category: "code",
    url: (q, n) => `https://pypi.org/search/?q=${encodeURIComponent(q)}`,
    parse: (_json: unknown, _max: number) => [] as never[], // HTML 解析暂未实现
  })(config)
}

export * as OpenApi from "./open-api"
