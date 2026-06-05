# SearXNG Engine Tracking Table (Final v2)

## Summary
- Total SearXNG engines: 222
- Our engines: 98 (including 4 utility files)
- Actual engine implementations: 94
- Coverage: ~42% of SearXNG engines

## Engine Categories

### General Search (16 engines)
| SearXNG Engine | Our Engine | Status | Notes |
|---------------|------------|--------|-------|
| google.py | google.ts | ✅ Done | HTML parsing |
| bing.py | bing.ts | ✅ Done | HTML parsing |
| duckduckgo.py | duckduckgo.ts | ✅ Done | HTML parsing |
| brave.py | brave.ts | ✅ Done | JSON API |
| startpage.py | startpage.ts | ✅ Done | HTML parsing (Google proxy) |
| qwant.py | qwant.ts | ✅ Done | JSON API |
| yahoo.py | yahoo.ts | ✅ Done | HTML parsing |
| yandex.py | yandex.ts | ✅ Done | HTML parsing |
| naver.py | naver.ts | ✅ Done | HTML parsing |
| presearch.py | - | ❌ TODO | Decentralized search |
| mwmbl.py | mwmbl.ts | ✅ Done | JSON API |
| seznam.py | seznam.ts | ✅ Done | HTML parsing |
| aol.py | aol.ts | ✅ Done | HTML parsing |
| gmx.py | gmx.ts | ✅ Done | HTML parsing |
| yep.py | yep.ts | ✅ Done | HTML parsing |
| searx_engine.py | - | ⚠️ Skip | Meta-engine (SearXNG instance) |

### Chinese Search (5 engines)
| SearXNG Engine | Our Engine | Status | Notes |
|---------------|------------|--------|-------|
| baidu.py | baidu.ts | ✅ Done | JSON API |
| sogou.py | sogou.ts | ✅ Done | HTML parsing |
| 360search.py | 360search.ts | ✅ Done | HTML parsing |
| chinaso.py | chinaso.ts | ✅ Done | HTML parsing |
| quark.py | quark.ts | ✅ Done | HTML parsing |

### Images (20 engines)
| SearXNG Engine | Our Engine | Status | Notes |
|---------------|------------|--------|-------|
| google_images.py | google-images.ts | ✅ Done | JSON API |
| bing_images.py | bing-images.ts | ✅ Done | HTML parsing |
| flickr.py | flickr.ts | ✅ Done | JSON API |
| pixabay.py | - | ✅ In open-api.ts | JSON API |
| unsplash.py | - | ✅ In open-api.ts | JSON API |
| pexels.py | pexels.ts | ✅ Done | HTML parsing |
| wallhaven.py | wallhaven.ts | ✅ Done | JSON API |
| pinterest.py | pinterest.ts | ✅ Done | JSON API |
| deviantart.py | deviantart.ts | ✅ Done | HTML parsing |
| openverse.py | openverse.ts | ✅ Done | JSON API |
| flickr_noapi.py | - | ❌ TODO | Flickr HTML fallback |
| imgur.py | imgur.ts | ✅ Done | HTML parsing |
| 500px.py | 500px.ts | ✅ Done | JSON API |
| adobe_stock.py | - | ❌ TODO | Adobe Stock (needs key) |
| artstation.py | artstation.ts | ✅ Done | JSON API (needs CSRF) |
| cara.py | - | ❌ TODO | Cara art community |
| ipernity.py | - | ❌ TODO | Ipernity photos |
| pixiv.py | pixiv.ts | ✅ Done | JSON API |
| uxwing.py | - | ❌ TODO | UX Wing icons |
| flaticon.py | - | ❌ TODO | Flaticon icons |
| public_domain_image_archive.py | - | ❌ TODO | Public domain images |
| openclipart.py | - | ❌ TODO | OpenClipart |
| tineye.py | - | ❌ TODO | Reverse image search |
| sogou_images.py | - | ❌ TODO | Sogou images |

### Videos (17 engines)
| SearXNG Engine | Our Engine | Status | Notes |
|---------------|------------|--------|-------|
| youtube.py | youtube.ts | ✅ Done | HTML parsing |
| bing_videos.py | bing-videos.ts | ✅ Done | HTML parsing |
| dailymotion.py | dailymotion.ts | ✅ Done | REST API |
| vimeo.py | vimeo.ts | ✅ Done | JSON API |
| bilibili.py | bilibili.ts | ✅ Done | JSON API |
| niconico.py | niconico.ts | ✅ Done | HTML parsing |
| google_videos.py | google-videos.ts | ✅ Done | HTML parsing |
| bitchute.py | - | ❌ TODO | Bitchute video |
| odysee.py | odysee.ts | ✅ Done | JSON-RPC API |
| rumble.py | rumble.ts | ✅ Done | HTML parsing |
| peertube.py | peertube.ts | ✅ Done | JSON API |
| piped.py | piped.ts | ✅ Done | JSON API (multi-instance) |
| invidious.py | invidious.ts | ✅ Done | JSON API (multi-instance) |
| iqiyi.py | - | ❌ TODO | iQiyi (Chinese video) |
| acfun.py | - | ❌ TODO | AcFun (Chinese video) |
| sogou_videos.py | - | ❌ TODO | Sogou videos |
| tubearchivist.py | - | ❌ TODO | TubeArchivist |

### News (6 engines)
| SearXNG Engine | Our Engine | Status | Notes |
|---------------|------------|--------|-------|
| google_news.py | google-news.ts | ✅ Done | HTML parsing |
| bing_news.py | bing-news.ts | ✅ Done | HTML parsing |
| yahoo_news.py | yahoo-news.ts | ✅ Done | HTML parsing |
| reuters.py | reuters.ts | ✅ Done | JSON API |
| ansa.py | - | ❌ TODO | ANSA (Italian) |
| tagesschau.py | - | ❌ TODO | Tagesschau (German) |

### Music (8 engines)
| SearXNG Engine | Our Engine | Status | Notes |
|---------------|------------|--------|-------|
| soundcloud.py | soundcloud.ts | ✅ Done | JSON API |
| bandcamp.py | bandcamp.ts | ✅ Done | HTML parsing |
| deezer.py | deezer.ts | ✅ Done | JSON API |
| genius.py | genius.ts | ✅ Done | JSON API |
| mixcloud.py | mixcloud.ts | ✅ Done | JSON API |
| freesound.py | freesound.ts | ✅ Done | JSON API |
| spotify.py | spotify.ts | ✅ Done | API/HTML fallback |
| yandex_music.py | - | ❌ TODO | Yandex Music |

### Academic/Science (9 engines)
| SearXNG Engine | Our Engine | Status | Notes |
|---------------|------------|--------|-------|
| arxiv.py | arxiv.ts | ✅ Done | JSON API |
| google_scholar.py | google-scholar.ts | ✅ Done | HTML parsing |
| semantic_scholar.py | semantic-scholar.ts | ✅ Done | JSON API |
| pubmed.py | - | ✅ In open-api.ts | JSON API |
| openalex.py | openalex.ts | ✅ Done | JSON API |
| crossref.py | crossref.ts | ✅ Done | JSON API |
| springer.py | - | ❌ TODO | Springer (needs key) |
| astrophysics_data_system.py | - | ❌ TODO | ADS astronomy |
| open_meteo.py | open-meteo.ts | ✅ Done | JSON API (see Weather) |
| pdbe.py | - | ❌ TODO | Protein Data Bank |

### Code/IT (16 engines)
| SearXNG Engine | Our Engine | Status | Notes |
|---------------|------------|--------|-------|
| github.py | github.ts | ✅ Done | REST API |
| gitlab.py | gitlab.ts | ✅ Done | REST API |
| huggingface.py | huggingface.ts | ✅ Done | JSON API |
| crates.py | crates.ts | ✅ Done | JSON API |
| npm.py | - | ✅ In open-api.ts | JSON API |
| docker_hub.py | - | ✅ In open-api.ts | JSON API |
| pypi.py | pypi.ts | ✅ Done | HTML parsing |
| pkg_go_dev.py | pkg-go-dev.ts | ✅ Done | HTML parsing |
| lib_rs.py | lib-rs.ts | ✅ Done | HTML parsing |
| metacpan.py | metacpan.ts | ✅ Done | JSON API |
| alpinelinux.py | alpinelinux.ts | ✅ Done | HTML parsing |
| archlinux.py | archlinux.ts | ✅ Done | JSON API |
| voidlinux.py | voidlinux.ts | ✅ Done | JSON API |
| fdroid.py | fdroid.ts | ✅ Done | HTML parsing |
| gitea.py | - | ❌ TODO | Gitea repos |
| sourcehut.py | - | ❌ TODO | SourceHut repos |

### Books (4 engines)
| SearXNG Engine | Our Engine | Status | Notes |
|---------------|------------|--------|-------|
| goodreads.py | goodreads.ts | ✅ Done | HTML parsing |
| openlibrary.py | openlibrary.ts | ✅ Done | JSON API |
| zlibrary.py | - | ❌ TODO | Z-Library (piracy) |
| annas_archive.py | - | ❌ TODO | Anna's Archive |

### Shopping (2 engines)
| SearXNG Engine | Our Engine | Status | Notes |
|---------------|------------|--------|-------|
| ebay.py | ebay.ts | ✅ Done | HTML parsing |
| steam.py | steam.ts | ✅ Done | JSON API |

### Entertainment (4 engines)
| SearXNG Engine | Our Engine | Status | Notes |
|---------------|------------|--------|-------|
| imdb.py | imdb.ts | ✅ Done | JSON API |
| rottentomatoes.py | rottentomatoes.ts | ✅ Done | HTML parsing |
| moviepilot.py | - | ❌ TODO | MoviePilot |
| senscritique.py | - | ❌ TODO | SensCritique (French) |

### Social (6 engines)
| SearXNG Engine | Our Engine | Status | Notes |
|---------------|------------|--------|-------|
| reddit.py | reddit.ts | ✅ Done | HTML parsing |
| twitter.py | twitter.ts | ✅ Done | Nitter proxy |
| mastodon.py | mastodon.ts | ✅ Done | JSON API |
| lemmy.py | lemmy.ts | ✅ Done | JSON API (multi-instance) |
| discourse.py | discourse.ts | ✅ Done | JSON API (multi-instance) |
| boardreader.py | boardreader.ts | ✅ Done | HTML parsing |

### Maps (2 engines)
| SearXNG Engine | Our Engine | Status | Notes |
|---------------|------------|--------|-------|
| apple_maps.py | - | ❌ TODO | Apple Maps |
| openstreetmap.py | - | ❌ TODO | OpenStreetMap (complex) |

### Weather (2 engines)
| SearXNG Engine | Our Engine | Status | Notes |
|---------------|------------|--------|-------|
| wttr.py | wttr.ts | ✅ Done | JSON API |
| open_meteo.py | open-meteo.ts | ✅ Done | JSON API |

### Other (17 engines)
| SearXNG Engine | Our Engine | Status | Notes |
|---------------|------------|--------|-------|
| wikipedia.py | wikipedia.ts | ✅ Done | JSON API |
| wikidata.py | wikidata.ts | ✅ Done | JSON API |
| wikicommons.py | wikicommons.ts | ✅ Done | JSON API |
| dictzone.py | - | ❌ TODO | Dictionary |
| duden.py | - | ❌ TODO | German dictionary |
| lingva.py | - | ❌ TODO | Translation |
| libretranslate.py | - | ❌ TODO | Translation |
| deepl.py | - | ❌ TODO | DeepL translation |
| currency_convert.py | currency-convert.ts | ✅ Done | DuckDuckGo API |
| emojipedia.py | - | ❌ TODO | Emoji search |
| selfhst.py | - | ❌ TODO | Self-hosted |
| devicons.py | - | ❌ TODO | Dev icons |
| lucide.py | - | ❌ TODO | Lucide icons |
| material_icons.py | - | ❌ TODO | Material icons |
| microsoft_learn.py | - | ❌ TODO | Microsoft Learn |
| hex.py | - | ❌ TODO | HexHub packages |

## Summary of Completed Engines

### Tier 1 - Must Have (General Search)
✅ google, bing, duckduckgo, brave, startpage, qwant, yahoo, yandex, naver

### Tier 2 - Should Have (Specialized)
✅ google-videos, yahoo-news, reuters, mixcloud, bandcamp, genius, deezer
✅ crates, pypi, pkg-go-dev, lib-rs, fdroid
✅ peertube, rumble, niconico
✅ pixiv, deviantart, imgur, pexels, wallhaven, artstation
✅ rottentomatoes, steam, ebay
✅ openalex, crossref, openlibrary
✅ mastodon, wttr, currency-convert, wikidata, wikicommons
✅ open-meteo, lemmy

### Tier 3 - Nice to Have (Niche)
✅ metacpan, alpinelinux, archlinux, voidlinux
✅ 500px, freesound, spotify

### Tier 4 - Skip (Low Value / Complex)
❌ searx_engine, zlibrary, adobe_stock, springer, openstreetmap, gitea, sourcehut
