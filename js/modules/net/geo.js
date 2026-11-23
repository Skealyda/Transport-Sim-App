// ====================================
// REVERSE GEOCODING (Nominatim) — single cached, rate-limited entry point
// ====================================
// Nominatim usage policy: max 1 request/second, no heavy use, cache results.
import { PersistentCache, APIMonitor, monitoredFetch } from '../cache.js';
import { CACHE_CONFIG } from '../constants.js';
import { createGate, gridKey } from './gate.js';

const gate = createGate({ minIntervalMs: 1100 });
const MAX_ENTRIES = 300;
let cache = null;

function loadCache() {
	if (!cache) cache = PersistentCache.load(CACHE_CONFIG.geocode.storageKey) || {};
	return cache;
}

function persist() {
	const keys = Object.keys(cache);
	if (keys.length > MAX_ENTRIES) {
		keys.sort((a, b) => cache[a].t - cache[b].t)
			.slice(0, keys.length - MAX_ENTRIES)
			.forEach(k => delete cache[k]);
	}
	PersistentCache.save(CACHE_CONFIG.geocode.storageKey, cache, CACHE_CONFIG.geocode.maxAge);
}

const ADDRESS_FIELDS = ['village', 'town', 'city', 'municipality', 'county', 'suburb', 'neighbourhood', 'hamlet', 'state', 'region'];

/**
 * Returns the Nominatim `address` object (subset) plus `display_name`, or null when unavailable.
 * Results are cached per ~1 km grid cell and zoom level.
 */
export async function reverseGeocodeAddress(lat, lng, zoom = 14) {
	const key = `${zoom}:${gridKey(lat, lng, CACHE_CONFIG.geocode.gridPrecision)}`;
	const store = loadCache();
	const hit = store[key];
	if (hit && Date.now() - hit.t < CACHE_CONFIG.geocode.maxAge) {
		APIMonitor.log('geocode', key, true);
		return hit.v;
	}
	if (gate.isBlocked()) return null;

	const result = await gate.run(key, async () => {
		try {
			const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}` +
				`&zoom=${zoom}&addressdetails=1&accept-language=en`;
			const response = await monitoredFetch(url, { signal: AbortSignal.timeout(10000) });
			if (!response.ok) {
				gate.reportFailure(response.status === 429 || response.status === 403 ? 15 * 60_000 : undefined);
				return null;
			}
			const data = await response.json();
			const address = {};
			for (const f of ADDRESS_FIELDS) if (data.address?.[f]) address[f] = data.address[f];
			const value = { address, display_name: data.display_name || '' };
			store[key] = { v: value, t: Date.now() };
			persist();
			gate.reportSuccess();
			return value;
		} catch {
			gate.reportFailure();
			return null;
		}
	});
	return result ?? null;
}
