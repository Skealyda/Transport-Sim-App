// ====================================
// WEATHER CLIENT — grid-cached, de-duplicated, backoff on failure
// ====================================
import { PersistentCache, APIMonitor, monitoredFetch } from '../cache.js';
import { CACHE_CONFIG, WEATHER_CONFIG } from '../constants.js';
import { createGate, gridKey } from './gate.js';
import { loadClientConfig } from './config.js';

const gate = createGate({ minIntervalMs: 1000, baseBackoffMs: 60_000, maxBackoffMs: 30 * 60_000 });
const MAX_ENTRIES = 100;
let cache = null;
let warnedUnavailable = false;

function loadCache() {
	if (!cache) cache = PersistentCache.load(CACHE_CONFIG.weather.storageKey) || {};
	return cache;
}

function persist() {
	const keys = Object.keys(cache);
	if (keys.length > MAX_ENTRIES) {
		keys.sort((a, b) => cache[a].t - cache[b].t)
			.slice(0, keys.length - MAX_ENTRIES)
			.forEach(k => delete cache[k]);
	}
	PersistentCache.save(CACHE_CONFIG.weather.storageKey, cache, CACHE_CONFIG.weather.maxAge);
}

export function weatherCellKey(lat, lng) {
	return gridKey(lat, lng, CACHE_CONFIG.weather.gridPrecision);
}

/** Raw OpenWeather payload for the grid cell containing (lat, lng), or null when unavailable. */
export async function getWeather(lat, lng) {
	if (!WEATHER_CONFIG.enableRealWeather) return null;
	const config = await loadClientConfig();
	if (config.weatherAvailable === false) {
		if (!warnedUnavailable) console.warn('Live weather is not configured in Settings');
		warnedUnavailable = true;
		return null;
	}
	const key = weatherCellKey(lat, lng);
	const store = loadCache();
	const hit = store[key];
	if (hit && Date.now() - hit.t < CACHE_CONFIG.weather.maxAge) {
		APIMonitor.log('weather', key, true);
		return hit.v;
	}
	if (gate.isBlocked()) return hit ? hit.v : null;

	const result = await gate.run(key, async () => {
		try {
			const url = new URL(config.weatherProxyUrl || WEATHER_CONFIG.endpoint, window.location.href);
			url.searchParams.set('lat', lat.toFixed(3));
			url.searchParams.set(config.weatherProxyUrl ? 'lng' : 'lon', lng.toFixed(3));
			if (!config.weatherProxyUrl && config.openWeatherApiKey) {
				url.searchParams.set('appid', config.openWeatherApiKey);
				url.searchParams.set('units', 'metric');
			}
			const response = await monitoredFetch(url, { signal: AbortSignal.timeout(WEATHER_CONFIG.requestTimeout) });
			if (!response.ok) {
				// A disabled/misconfigured optional provider should not be retried in a tight loop.
				gate.reportFailure(response.status === 503 ? 30 * 60_000 : undefined);
				return hit ? hit.v : null;
			}
			const data = await response.json();
			store[key] = { v: data, t: Date.now() };
			persist();
			gate.reportSuccess();
			return data;
		} catch {
			gate.reportFailure();
			return hit ? hit.v : null;
		}
	});
	return result ?? (hit ? hit.v : null);
}
