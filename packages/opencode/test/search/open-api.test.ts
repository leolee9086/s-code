/**
 * 开放 API 引擎测试（Wikipedia, Arxiv, Semantic Scholar, GitHub + 工厂引擎）
 */
import { describe, expect, test } from "bun:test"
import { makeWikipedia, parseWikipediaResults } from "../../src/search/engines/wikipedia"
import { makeArxiv, parseArxivResults } from "../../src/search/engines/arxiv"
import { makeSemanticScholar, parseSemanticScholarResults } from "../../src/search/engines/semantic-scholar"
import { makeGitHub, parseGitHubResults } from "../../src/search/engines/github"
import { makeUnsplash, makePixabay, makeHackerNews, makeNpm, makeDockerHub } from "../../src/search/engines/open-api"
import { makeEngineConfig } from "../../src/search/engine"
import { makeSearchResult } from "../../src/search/engines/json-api"

// ── Wikipedia ──
const WIKI_JSON = JSON.stringify({ query: { search: [{ title: "Rust (programming language)", pageid: 12345, snippet: "Rust is a <span>multi-paradigm</span> language", timestamp: "2024-01-15T10:00:00Z" }, { title: "AI", pageid: 67890, snippet: "AI <span>intelligence</span>", timestamp: "2024-02-20T12:00:00Z" }] } })

describe("Wikipedia engine", () => {
  test("creates engine", () => { const e = makeWikipedia(makeEngineConfig({ name: "wikipedia", timeout: 5000, maxResults: 5 })); expect(e.name).toBe("wikipedia"); expect(typeof e.search).toBe("function") })
  test("parses results", () => { const r = parseWikipediaResults(WIKI_JSON, 10); expect(r.length).toBe(2); expect(r[0].title).toBe("Rust (programming language)"); expect(r[0].url).toContain("en.wikipedia.org"); expect(r[0].category).toBe("encyclopedia") })
  test("respects maxResults", () => expect(parseWikipediaResults(WIKI_JSON, 1).length).toBe(1))
  test("invalid JSON returns empty", () => expect(parseWikipediaResults("bad", 10)).toEqual([]))
})

// ── Arxiv ──
const ARXIV_XML = `<?xml version="1.0"?><feed><entry><title>Rust: A Language</title><id>http://arxiv.org/abs/2301.12345</id><summary>Explores Rust</summary><published>2023-01-15T00:00:00Z</published><author><name>John Doe</name></author></entry></feed>`

describe("Arxiv engine", () => {
  test("creates engine", () => { const e = makeArxiv(makeEngineConfig({ name: "arxiv", timeout: 5000, maxResults: 5 })); expect(e.name).toBe("arxiv") })
  test("parses XML", () => { const r = parseArxivResults(ARXIV_XML, 10); expect(r.length).toBe(1); expect(r[0].title).toBe("Rust: A Language"); expect(r[0].url).toBe("https://arxiv.org/abs/2301.12345"); expect(r[0].category).toBe("academic") })
  test("returns empty for empty string", () => expect(parseArxivResults("", 10)).toEqual([]))
})

// ── Semantic Scholar ──
const SEMANTIC_JSON = JSON.stringify({ data: [{ title: "Rust Memory Safety", url: "https://ex.com/1", abstract: "Analysis", publicationDate: "2023-06-15", authors: [{ name: "Alice" }] }] })

describe("Semantic Scholar", () => {
  test("creates engine", () => { const e = makeSemanticScholar(makeEngineConfig({ name: "semantic-scholar", timeout: 5000, maxResults: 5 })); expect(e.name).toBe("semantic-scholar") })
  test("parses results", () => { const r = parseSemanticScholarResults(SEMANTIC_JSON, 10); expect(r.length).toBe(1); expect(r[0].title).toBe("Rust Memory Safety"); expect(r[0].category).toBe("academic") })
  test("invalid JSON", () => expect(parseSemanticScholarResults("bad", 10)).toEqual([]))
})

// ── GitHub ──
const GITHUB_JSON = JSON.stringify({ items: [{ full_name: "rust-lang/rust", html_url: "https://github.com/rust-lang/rust", description: "The Rust programming language", stargazers_count: 100000, language: "Rust", updated_at: "2024-03-01T00:00:00Z" }] })

describe("GitHub engine", () => {
  test("creates engine", () => { const e = makeGitHub(makeEngineConfig({ name: "github", timeout: 5000, maxResults: 5 })); expect(e.name).toBe("github") })
  test("parses results", () => { const r = parseGitHubResults(GITHUB_JSON, 10); expect(r.length).toBe(1); expect(r[0].title).toContain("rust-lang/rust"); expect(r[0].category).toBe("code") })
  test("invalid JSON", () => expect(parseGitHubResults("bad", 10)).toEqual([]))
})

// ── 工厂引擎 ──
describe("Open API factory engines", () => {
  test("makeUnsplash creates engine", () => { const e = makeUnsplash(makeEngineConfig({ name: "unsplash", timeout: 5000, maxResults: 5 })); expect(e.name).toBe("unsplash"); expect(typeof e.search).toBe("function") })
  test("makePixabay creates engine", () => { const e = makePixabay(makeEngineConfig({ name: "pixabay", timeout: 5000, maxResults: 5 })); expect(e.name).toBe("pixabay") })
  test("makeHackerNews creates engine", () => { const e = makeHackerNews(makeEngineConfig({ name: "hackernews", timeout: 5000, maxResults: 5 })); expect(e.name).toBe("hackernews") })
  test("makeNpm creates engine", () => { const e = makeNpm(makeEngineConfig({ name: "npm", timeout: 5000, maxResults: 5 })); expect(e.name).toBe("npm") })
  test("makeDockerHub creates engine", () => { const e = makeDockerHub(makeEngineConfig({ name: "dockerhub", timeout: 5000, maxResults: 5 })); expect(e.name).toBe("dockerhub") })
  test("makeSearchResult helper", () => { const r = makeSearchResult({ title: "T", url: "https://ex.com", snippet: "s", engine: "t", position: 1 }); expect(r.title).toBe("T"); expect(r.engine).toBe("t"); expect(r.position).toBe(1) })
})
