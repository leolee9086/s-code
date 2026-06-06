# SearXNG Engine Tracking Table (Final v4)

## Summary
- Total SearXNG engines: 222
- Our engines: 148 (including 3 utility files)
- Actual engine implementations: 145
- Coverage: ~65.3% of SearXNG engines

## Engine Categories

### General Search (16 engines)
| SearXNG Engine | Our Engine | Status | Notes |
|---------------|------------|--------|-------|
| google.py | google.ts | ✅ Done | HTML parsing |
| bing.py | bing.ts | ✅ Done | HTML parsing |
| duckduckgo.py | duckduckgo.ts | ✅ Done | HTML parsing |
| brave.py | brave.ts | ✅ Done | JSON API |
| startpage.py | startpage.ts | ✅ Done | HTML parsing |
| qwant.py | qwant.ts | ✅ Done | JSON API |
| yahoo.py | yahoo.ts | ✅ Done | HTML parsing |
| yandex.py | yandex.ts | ✅ Done | HTML parsing |
| naver.py | naver.ts | ✅ Done | HTML parsing |
| presearch.py | - | ❌ TODO | Decentralized search |
| mwmbl.py | mwmbl.ts | ✅ Done | HTML parsing |
| seznam.py | seznam.ts | ✅ Done | HTML parsing |
| aol.py | aol.ts | ✅ Done | HTML parsing |
| gmx.py | gmx.ts | ✅ Done | HTML parsing |
| yep.py | yep.ts | ✅ Done | JSON API |
| mojeek.py | mojeek.ts | ✅ Done | HTML parsing |
| grokipedia.py | grokipedia.ts | ✅ Done | JSON API |
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
| flickr_noapi.py | flickr.ts | ✅ Done | HTML parsing (same as flickr) |
| imgur.py | imgur.ts | ✅ Done | HTML parsing |
| 500px.py | 500px.ts | ✅ Done | GraphQL API |
| adobe_stock.py | adobe-stock.ts | ✅ Done | JSON API |
| artstation.py | artstation.ts | ✅ Done | JSON API (needs CSRF) |
| cara.py | cara.ts | ✅ Done | JSON API |
| ipernity.py | ipernity.ts | ✅ Done | HTML parsing |
| pixiv.py | pixiv.ts | ✅ Done | JSON API |
| uxwing.py | uxwing.ts | ✅ Done | HTML parsing |
| flaticon.py | flaticon.ts | ✅ Done | HTML parsing |
| public_domain_image_archive.py | - | ❌ TODO | Public domain images |
| openclipart.py | openclipart.ts | ✅ Done | HTML parsing |
| tineye.py | tineye.ts | ✅ Done | JSON API |
| sogou_images.py | sogou-images.ts | ✅ Done | HTML parsing (__INITIAL_STATE__) |
| artic.py | artic.ts | ✅ Done | JSON API |
| loc.py | loc.ts | ✅ Done | JSON API |
| www1x.py | 1x.ts | ✅ Done | HTML parsing |
| findthatmeme.py | findthatmeme.ts | ✅ Done | JSON API |

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
| bitchute.py | bitchute.ts | ✅ Done | JSON API |
| odysee.py | odysee.ts | ✅ Done | HTML parsing |
| rumble.py | rumble.ts | ✅ Done | HTML parsing |
| peertube.py | peertube.ts | ✅ Done | JSON API |
| piped.py | piped.ts | ✅ Done | HTML parsing |
| invidious.py | invidious.ts | ✅ Done | HTML parsing |
| iqiyi.py | iqiyi.ts | ✅ Done | HTML parsing |
| acfun.py | acfun.ts | ✅ Done | HTML parsing |
| sogou_videos.py | sogou-videos.ts | ✅ Done | JSON API |
| tubearchivist.py | - | ❌ TODO | TubeArchivist |
| sepiasearch.py | sepiasearch.ts | ✅ Done | JSON API |

### News (6 engines)
| SearXNG Engine | Our Engine | Status | Notes |
|---------------|------------|--------|-------|
| google_news.py | google-news.ts | ✅ Done | HTML parsing |
| bing_news.py | bing-news.ts | ✅ Done | HTML parsing |
| yahoo_news.py | yahoo-news.ts | ✅ Done | HTML parsing |
| reuters.py | reuters.ts | ✅ Done | JSON API |
| ansa.py | ansa.ts | ✅ Done | HTML parsing |
| tagesschau.py | tagesschau.ts | ✅ Done | JSON API |

### Music (8 engines)
| SearXNG Engine | Our Engine | Status | Notes |
|---------------|------------|--------|-------|
| soundcloud.py | soundcloud.ts | ✅ Done | JSON API |
| bandcamp.py | bandcamp.ts | ✅ Done | HTML parsing |
| deezer.py | deezer.ts | ✅ Done | JSON API |
| genius.py | genius.ts | ✅ Done | JSON API |
| mixcloud.py | mixcloud.ts | ✅ Done | JSON API |
| freesound.py | freesound.ts | ✅ Done | JSON API (needs key) |
| spotify.py | spotify.ts | ✅ Done | JSON API (needs key) |
| yandex_music.py | yandex-music.ts | ✅ Done | JSON API |
| fyyd.py | fyyd.ts | ✅ Done | JSON API |

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
| open_meteo.py | open-meteo.ts | ✅ Done | JSON API |
| pdbe.py | pdbe.ts | ✅ Done | JSON API |
| scanr_structures.py | scanr.ts | ✅ Done | JSON API |

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
| archlinux.py | archlinux.ts | ✅ Done | HTML parsing |
| voidlinux.py | voidlinux.ts | ✅ Done | JSON API |
| fdroid.py | fdroid.ts | ✅ Done | HTML parsing |
| gitea.py | gitea.ts | ✅ Done | JSON API |
| sourcehut.py | sourcehut.ts | ✅ Done | HTML parsing |
| repology.py | repology.ts | ✅ Done | JSON API |
| nvd.py | nvd.ts | ✅ Done | JSON API |
| apkmirror.py | apkmirror.ts | ✅ Done | HTML parsing |

### Books (4 engines)
| SearXNG Engine | Our Engine | Status | Notes |
|---------------|------------|--------|-------|
| goodreads.py | goodreads.ts | ✅ Done | HTML parsing |
| openlibrary.py | openlibrary.ts | ✅ Done | JSON API |
| zlibrary.py | - | ❌ TODO | Z-Library (piracy) |
| annas_archive.py | annas-archive.ts | ✅ Done | HTML parsing |

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
| moviepilot.py | moviepilot.ts | ✅ Done | JSON API |
| senscritique.py | senscritique.ts | ✅ Done | HTML parsing |

### Social (6 engines)
| SearXNG Engine | Our Engine | Status | Notes |
|---------------|------------|--------|-------|
| reddit.py | reddit.ts | ✅ Done | HTML parsing |
| twitter.py | twitter.ts | ✅ Done | Nitter proxy |
| mastodon.py | mastodon.ts | ✅ Done | JSON API |
| lemmy.py | lemmy.ts | ✅ Done | JSON API |
| discourse.py | discourse.ts | ✅ Done | JSON API |
| boardreader.py | boardreader.ts | ✅ Done | HTML parsing |
| tootfinder.py | tootfinder.ts | ✅ Done | JSON API |

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
| dictzone.py | dictzone.ts | ✅ Done | HTML parsing |
| duden.py | duden.ts | ✅ Done | HTML parsing |
| lingva.py | lingva.ts | ✅ Done | JSON API |
| libretranslate.py | libretranslate.ts | ✅ Done | JSON API |
| deepl.py | deepl.ts | ✅ Done | JSON API (needs key) |
| currency_convert.py | currency-convert.ts | ✅ Done | DuckDuckGo API |
| emojipedia.py | emojipedia.ts | ✅ Done | HTML parsing |
| selfhst.py | selfhst.ts | ✅ Done | JSON API |
| devicons.py | devicons.ts | ✅ Done | JSON API |
| lucide.py | lucide.ts | ✅ Done | JSON API |
| material_icons.py | material-icons.ts | ✅ Done | JSON API |
| microsoft_learn.py | microsoft-learn.ts | ✅ Done | JSON API |
| hex.py | hex.ts | ✅ Done | JSON API |
| jisho.py | jisho.ts | ✅ Done | JSON API |
| radio_browser.py | radio-browser.ts | ✅ Done | JSON API |

## Summary of Completed Engines

### Tier 1 - Must Have (General Search)
✅ google, bing, duckduckgo, brave, qwant, yahoo, yandex, naver, startpage, mwmbl, seznam, aol, gmx, yep

### Tier 2 - Should Have (Specialized)
✅ google-videos, yahoo-news, reuters, tagesschau, mixcloud, bandcamp, genius, deezer, freesound, spotify
✅ crates, pypi, pkg-go-dev, lib-rs, fdroid, metacpan, alpinelinux, archlinux, voidlinux
✅ peertube, rumble, niconico, odysee, piped, invidious, bitchute
✅ pixiv, deviantart, imgur, pexels, wallhaven, artstation, 500px, cara, openclipart, ipernity, uxwing, flaticon, sogou-images, tineye, artic, loc, 1x, findthatmeme
✅ rottentomatoes, steam, ebay, moviepilot, senscritique
✅ openalex, crossref, openlibrary, pdbe
✅ mastodon, lemmy, discourse, boardreader
✅ wttr, open-meteo, currency-convert, wikidata, wikicommons, chinaso, quark
✅ gitea, sourcehut, repology, nvd, apkmirror
✅ dictzone, duden, emojipedia, cara, jisho
✅ sogou-videos, acfun, iqiyi, ansa
✅ yandex-music, annas-archive, radio-browser
✅ lingva, libretranslate, deepl, microsoft-learn, hex, selfhst, devicons, lucide, material-icons
✅ mojeek, sepiasearch, loc, 1x, grokipedia, tootfinder, fyyd, scanr

### Tier 3 - Nice to Have (Niche)
❌ public_domain_image_archive
❌ tubearchivist
❌ springer, astrophysics_data_system
❌ zlibrary
❌ apple_maps, openstreetmap

### Tier 4 - Skip (Low Value / Complex)
❌ searx_engine, presearch
