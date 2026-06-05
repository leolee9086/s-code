# AI SDK Dependency Update Report

> Generated: 2026-06-05
>
> Scope: Minor & patch upgrades only (no major version bumps).
>
> All Vercel AI SDK packages are part of the [`vercel/ai`](https://github.com/vercel/ai) monorepo.
> Changelogs are at `https://github.com/vercel/ai/blob/main/packages/<name>/CHANGELOG.md`.

---

## Core `ai` Package

| Package | Current | Latest | Jump | Notes |
|---------|---------|--------|------|-------|
| `ai` | `6.0.168` | **`6.0.197`** | +29 patches | Catalog entry in root `package.json` |

**Recent notable changes (6.0.168 → 6.0.197):**
- Multiple fixes for tool call streaming, reasoning, and provider option handling
- New model ID additions across providers
- Various bug fixes for streaming edge cases

**Changelog:** https://github.com/vercel/ai/blob/main/packages/ai/CHANGELOG.md

---

## Official Vercel Provider Packages

### OpenAI

| Package | Current | Latest | Jump | Changelog |
|---------|---------|--------|------|-----------|
| `@ai-sdk/openai` | `3.0.53` | **`3.0.68`** | +15 patches | [CHANGELOG](https://github.com/vercel/ai/blob/main/packages/openai/CHANGELOG.md) |
| `@ai-sdk/openai-compatible` | `2.0.41` | **`2.0.48`** | +7 patches | [CHANGELOG](https://github.com/vercel/ai/blob/main/packages/openai-compatible/CHANGELOG.md) |

**Notable in `@ai-sdk/openai` 3.0.53 → 3.0.68:**
- `gpt-image-2` model support
- Tool execution denial message improvements
- `allowedTools` provider option for Responses API
- Better handling of reasoning/finish-reason in streaming
- Various serialization fixes for tool calls

### Anthropic

| Package | Current | Latest | Jump | Changelog |
|---------|---------|--------|------|-----------|
| `@ai-sdk/anthropic` | `3.0.71` | **`3.0.81`** | +10 patches | [CHANGELOG](https://github.com/vercel/ai/blob/main/packages/anthropic/CHANGELOG.md) |

### Google

| Package | Current | Latest | Jump | Changelog |
|---------|---------|--------|------|-----------|
| `@ai-sdk/google` | `3.0.73` | **`3.0.80`** | +7 patches | [CHANGELOG](https://github.com/vercel/ai/blob/main/packages/google/CHANGELOG.md) |
| `@ai-sdk/google-vertex` | `4.0.128` | **`4.0.142`** | +14 patches | [CHANGELOG](https://github.com/vercel/ai/blob/main/packages/google-vertex/CHANGELOG.md) |

### Other Official Providers

| Package | Current | Latest | Jump | Changelog |
|---------|---------|--------|------|-----------|
| `@ai-sdk/alibaba` | `1.0.17` | **`1.0.26`** | +9 patches | [CHANGELOG](https://github.com/vercel/ai/blob/main/packages/alibaba/CHANGELOG.md) |
| `@ai-sdk/amazon-bedrock` | `4.0.107` | **`4.0.113`** | +6 patches | [CHANGELOG](https://github.com/vercel/ai/blob/main/packages/amazon-bedrock/CHANGELOG.md) |
| `@ai-sdk/azure` | `3.0.49` | **`3.0.70`** | +21 patches | [CHANGELOG](https://github.com/vercel/ai/blob/main/packages/azure/CHANGELOG.md) |
| `@ai-sdk/cerebras` | `2.0.41` | **`2.0.54`** | +13 patches | [CHANGELOG](https://github.com/vercel/ai/blob/main/packages/cerebras/CHANGELOG.md) |
| `@ai-sdk/cohere` | `3.0.27` | **`3.0.36`** | +9 patches | [CHANGELOG](https://github.com/vercel/ai/blob/main/packages/cohere/CHANGELOG.md) |
| `@ai-sdk/deepinfra` | `2.0.41` | **`2.0.52`** | +11 patches | [CHANGELOG](https://github.com/vercel/ai/blob/main/packages/deepinfra/CHANGELOG.md) |
| `@ai-sdk/gateway` | `3.0.104` | **`3.0.125`** | +21 patches | [CHANGELOG](https://github.com/vercel/ai/blob/main/packages/gateway/CHANGELOG.md) |
| `@ai-sdk/groq` | `3.0.31` | **`3.0.39`** | +8 patches | [CHANGELOG](https://github.com/vercel/ai/blob/main/packages/groq/CHANGELOG.md) |
| `@ai-sdk/mistral` | `3.0.27` | **`3.0.37`** | +10 patches | [CHANGELOG](https://github.com/vercel/ai/blob/main/packages/mistral/CHANGELOG.md) |
| `@ai-sdk/perplexity` | `3.0.26` | **`3.0.33`** | +7 patches | [CHANGELOG](https://github.com/vercel/ai/blob/main/packages/perplexity/CHANGELOG.md) |
| `@ai-sdk/togetherai` | `2.0.41` | **`2.0.53`** | +12 patches | [CHANGELOG](https://github.com/vercel/ai/blob/main/packages/togetherai/CHANGELOG.md) |
| `@ai-sdk/vercel` | `2.0.39` | **`2.0.50`** | +11 patches | [CHANGELOG](https://github.com/vercel/ai/blob/main/packages/vercel/CHANGELOG.md) |
| `@ai-sdk/xai` | `3.0.82` | **`3.0.93`** | +11 patches | [CHANGELOG](https://github.com/vercel/ai/blob/main/packages/xai/CHANGELOG.md) |

### Internal / Shared

| Package | Current | Latest | Jump | Notes |
|---------|---------|--------|------|-------|
| `@ai-sdk/provider` | `3.0.8` | **`3.0.10`** | +2 patches | [CHANGELOG](https://github.com/vercel/ai/blob/main/packages/provider/CHANGELOG.md) |
| `@ai-sdk/provider-utils` | `4.0.23` | **`4.0.27`** | +4 patches | [CHANGELOG](https://github.com/vercel/ai/blob/main/packages/provider-utils/CHANGELOG.md) |

**Notable in `@ai-sdk/provider` 3.0.8 → 3.0.10:**
- `3.0.9`: Image model middleware support via `wrapImageModel` and `ImageModelV3Middleware`
- `3.0.10`: (patch, from the changelog)

---

## Third-Party AI Providers

| Package | Current | Latest | Jump | Changelog |
|---------|---------|--------|------|-----------|
| `@openrouter/ai-sdk-provider` | `2.8.1` | **`2.9.0`** | +1 minor | [CHANGELOG](https://github.com/OpenRouterTeam/openrouter-ai-sdk-provider/blob/main/CHANGELOG.md) |
| `ai-gateway-provider` | `3.1.2` | **`3.1.3`** | +1 patch | [GitHub](https://github.com/OpenRouterTeam/ai-gateway-provider) |
| `venice-ai-sdk-provider` | `2.0.2` | `2.0.2` | **None** | Already latest on `ai-v6` dist-tag |
| `gitlab-ai-provider` | `6.8.0` | `6.8.0` | **None** | Already latest |

**Notes:**
- `@openrouter/ai-sdk-provider`: 2.8.1 → 2.9.0 is a minor bump within the 2.x major. Check changelog for breaking changes (unlikely for a .0 minor).
- `venice-ai-sdk-provider` has two dist-tags: `latest` → `1.1.19` (ai-v5) and `ai-v6` → `2.0.2` (our track). We're already on the latest `ai-v6` version.

---

## Summary

**Total packages checked:** 25

**Upgrades available:** 23 out of 25 packages have newer minor/patch versions.

| Category | Count | Notes |
|----------|-------|-------|
| Already at latest | 2 | `venice-ai-sdk-provider`, `gitlab-ai-provider` |
| Patch upgrades | 22 | Most packages have 2–21 patch releases available |
| Minor upgrades | 1 | `@openrouter/ai-sdk-provider`: 2.8.1 → 2.9.0 |

**High-priority upgrades** (largest gaps):
- `@ai-sdk/azure`: +21 patches (3.0.49 → 3.0.70)
- `@ai-sdk/gateway`: +21 patches (3.0.104 → 3.0.125)
- `ai`: +29 patches (6.0.168 → 6.0.197)
- `@ai-sdk/openai`: +15 patches (3.0.53 → 3.0.68)
- `@ai-sdk/google-vertex`: +14 patches (4.0.128 → 4.0.142)

---

## References

- Vercel AI SDK monorepo: https://github.com/vercel/ai
- All Vercel provider changelogs: `https://github.com/vercel/ai/blob/main/packages/<name>/CHANGELOG.md`
- OpenRouter SDK: https://github.com/OpenRouterTeam/openrouter-ai-sdk-provider
