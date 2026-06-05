/**
 * Open-Meteo 天气搜索引擎适配器
 *
 * 搜索天气信息。
 * 先用地理编码 API 将地名转为坐标，再用天气 API 获取当前天气。
 *
 * API:
 * - Geocoding: https://geocoding-api.open-meteo.com/v1/search?name=QUERY
 * - Weather: https://api.open-meteo.com/v1/forecast?latitude=LAT&longitude=LON&current_weather=true
 *
 * 参考 SearXNG: searx/engines/open_meteo.py
 * 零风险：公开 JSON API，无需 key，完全免费
 */
import { Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import type { EngineConfig, SearchEngine, SearchOptions, SearchResult } from "../engine"
import { makeSearchResult } from "../engine"

const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search"
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast"
const USER_AGENT = "opencode-search/1.0"

export function makeOpenMeteo(config: EngineConfig): SearchEngine {
  return {
    name: config.name,
    config,
    search: (http, query, opts) =>
      searchOpenMeteo(http, query, opts.numResults || config.maxResults, config.timeout),
  }
}

function searchOpenMeteo(
  http: HttpClient.HttpClient,
  query: string,
  numResults: number,
  timeout: number,
): Effect.Effect<readonly SearchResult[], unknown, never> {
  return Effect.gen(function* () {
    // Step 1: Geocode the location
    const geoParams = new URLSearchParams({
      name: query,
      count: String(Math.min(numResults, 5)),
      language: "en",
    })

    const geoResponse = yield* http.execute(
      HttpClientRequest.get(`${GEOCODING_URL}?${geoParams.toString()}`).pipe(
        HttpClientRequest.setHeaders({
          "User-Agent": USER_AGENT,
          Accept: "application/json",
        }),
      ),
    ).pipe(Effect.timeout(timeout))

    if (geoResponse.status < 200 || geoResponse.status >= 400) return []
    const geoRaw: string = yield* geoResponse.text
    if (!geoRaw) return []

    const locations = parseGeocodingResults(geoRaw)
    if (locations.length === 0) return []

    // Step 2: Get weather for first location
    const loc = locations[0]
    if (loc.latitude === undefined || loc.longitude === undefined) return []

    const params = new URLSearchParams({
      latitude: String(loc.latitude),
      longitude: String(loc.longitude),
      current_weather: "true",
    })

    const weatherResponse = yield* http.execute(
      HttpClientRequest.get(`${WEATHER_URL}?${params.toString()}`).pipe(
        HttpClientRequest.setHeaders({
          "User-Agent": USER_AGENT,
          Accept: "application/json",
        }),
      ),
    ).pipe(Effect.timeout(timeout))

    if (weatherResponse.status < 200 || weatherResponse.status >= 400) return []
    const weatherRaw: string = yield* weatherResponse.text
    if (!weatherRaw) return []

    const cw = parseWeatherResult(weatherRaw)
    if (!cw) return []

    const locationName = [loc.name, loc.admin1, loc.country].filter(Boolean).join(", ")
    const description = weatherCodeToDescription(cw.weathercode ?? 0)
    const temp = cw.temperature !== undefined ? `${cw.temperature}°C` : ""
    const wind = cw.windspeed !== undefined
      ? `${cw.windspeed} km/h ${windDirectionToCompass(cw.winddirection ?? 0)}`
      : ""
    const timeOfDay = cw.is_day ? "Daytime" : "Nighttime"

    const parts = [temp, description, wind, timeOfDay].filter(Boolean)

    return [
      makeSearchResult({
        title: `Weather in ${locationName}`,
        url: `https://open-meteo.com/en/docs#latitude=${loc.latitude}&longitude=${loc.longitude}`,
        snippet: parts.join(" · ").slice(0, 300),
        engine: "open-meteo",
        position: 1,
        category: "weather",
      }),
    ]
  })
}

interface GeocodingLocation {
  name?: string
  country?: string
  admin1?: string
  latitude?: number
  longitude?: number
}

interface GeocodingResponse {
  results?: GeocodingLocation[]
}

function parseGeocodingResults(raw: string): GeocodingLocation[] {
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return [] }
  const data = parsed as GeocodingResponse
  return Array.isArray(data?.results) ? data.results : []
}

interface CurrentWeather {
  temperature?: number
  windspeed?: number
  winddirection?: number
  weathercode?: number
  is_day?: number
}

interface WeatherResponse {
  current_weather?: CurrentWeather
}

function parseWeatherResult(raw: string): CurrentWeather | null {
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return null }
  const data = parsed as WeatherResponse
  return data?.current_weather ?? null
}

function weatherCodeToDescription(code: number): string {
  const descriptions: Record<number, string> = {
    0: "Clear sky",
    1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Fog", 48: "Rime fog",
    51: "Light drizzle", 53: "Moderate drizzle", 55: "Dense drizzle",
    56: "Freezing drizzle", 57: "Dense freezing drizzle",
    61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
    66: "Freezing rain", 67: "Heavy freezing rain",
    71: "Slight snow", 73: "Moderate snow", 75: "Heavy snow",
    77: "Snow grains",
    80: "Slight rain showers", 81: "Moderate rain showers", 82: "Violent rain showers",
    85: "Slight snow showers", 86: "Heavy snow showers",
    95: "Thunderstorm", 96: "Thunderstorm with slight hail", 99: "Thunderstorm with heavy hail",
  }
  return descriptions[code] || `Weather code ${code}`
}

function windDirectionToCompass(dir: number): string {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
  return dirs[Math.round(dir / 22.5) % 16]
}

export * as OpenMeteoEngine from "./open-meteo"
