// ====================================
// RAIL FEATURES (Overpass / OpenStreetMap) — bridges and turnouts along a route
// ====================================
// One POST per route, cached for 30 days in localStorage, so a journey costs at most a single
// request. Results are already projected to metres along the smooth route used by the simulator.
// The public Overpass server bans clients that keep retrying after 406/429, so failures are
// cached per route and back-off blocks persist across reloads.
import { APIMonitor, monitoredFetch } from '../cache.js';
import { createGate } from './gate.js';

const ENDPOINT = 'https://overpass-api.de/api/interpreter';
const STORAGE_KEY = 'railFeatures_v1';
const MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const FAILURE_AGE = 6 * 60 * 60 * 1000;
const BLOCK_KEY = 'railFeatures_blockedUntil';
const REJECTED_BLOCK_MS = 60 * 60 * 1000;
const MAX_ROUTES = 40;
const SEARCH_RADIUS_M = 150;
const MATCH_RADIUS_M = 220;
const MAX_QUERY_POINTS = 350;

const gate = createGate({ minIntervalMs: 2000, baseBackoffMs: 60_000 });

function readStore() {
	try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; }
}

function writeStore(store) {
	const keys = Object.keys(store);
	if (keys.length > MAX_ROUTES) {
		keys.sort((a, b) => store[a].t - store[b].t).slice(0, keys.length - MAX_ROUTES).forEach(k => delete store[k]);
	}
	try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); } catch { /* quota */ }
}

function persistentlyBlocked() {
	return Date.now() < (Number(localStorage.getItem(BLOCK_KEY)) || 0);
}

function blockFor(ms) {
	gate.reportFailure(ms);
	try { localStorage.setItem(BLOCK_KEY, String(Date.now() + ms)); } catch { /* quota */ }
}

function remember(key, value) {
	const fresh = readStore();
	fresh[key] = { v: value, t: Date.now(), ...(value ? {} : { failed: true }) };
	writeStore(fresh);
}

function routeKey(points, totalM) {
	let h = 2166136261;
	const step = Math.max(1, Math.floor(points.length / 64));
	for (let i = 0; i < points.length; i += step) {
		const s = `${points[i].lat.toFixed(4)},${points[i].lng.toFixed(4)};`;
		for (let j = 0; j < s.length; j++) h = Math.imul(h ^ s.charCodeAt(j), 16777619);
	}
	return `${(h >>> 0).toString(36)}_${Math.round(totalM)}`;
}

// Equirectangular metres — accurate enough at the ~200 m scale used for matching.
function metres(a, b) {
	const x = (b.lng - a.lng) * Math.cos((a.lat + b.lat) * Math.PI / 360) * 111320;
	const y = (b.lat - a.lat) * 110540;
	return Math.hypot(x, y);
}

/** Along-route position (m) of the nearest route vertex, or null if farther than MATCH_RADIUS_M. */
function project(point, route, cumulative) {
	let best = Infinity;
	let bestIndex = -1;
	for (let i = 0; i < route.length; i++) {
		const d = metres(point, route[i]);
		if (d < best) { best = d; bestIndex = i; }
	}
	if (best > MATCH_RADIUS_M) return null;
	// Refine onto the adjacent segment for sub-vertex accuracy.
	let along = cumulative[bestIndex];
	for (const j of [bestIndex - 1, bestIndex]) {
		if (j < 0 || j >= route.length - 1) continue;
		const a = route[j];
		const b = route[j + 1];
		const len = cumulative[j + 1] - cumulative[j];
		if (len <= 0) continue;
		const ax = (b.lng - a.lng) * Math.cos(a.lat * Math.PI / 180) * 111320;
		const ay = (b.lat - a.lat) * 110540;
		const px = (point.lng - a.lng) * Math.cos(a.lat * Math.PI / 180) * 111320;
		const py = (point.lat - a.lat) * 110540;
		const t = (ax * px + ay * py) / (ax * ax + ay * ay);
		if (t >= 0 && t <= 1) { along = cumulative[j] + t * len; break; }
	}
	return along;
}

function buildQuery(points) {
	const step = Math.max(1, Math.ceil(points.length / MAX_QUERY_POINTS));
	const sampled = points.filter((_, i) => i % step === 0 || i === points.length - 1);
	const line = sampled.map(p => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(',');
	return `[out:json][timeout:25];(` +
		`way["railway"~"^(rail|subway|light_rail)$"]["bridge"](around:${SEARCH_RADIUS_M},${line});` +
		`node["railway"~"^(switch|railway_crossing)$"](around:${SEARCH_RADIUS_M},${line});` +
		`);out geom;`;
}

function parse(data, route, cumulative) {
	const bridges = [];
	const switches = [];
	for (const el of data.elements || []) {
		if (el.type === 'node') {
			const along = project({ lat: el.lat, lng: el.lon }, route, cumulative);
			if (along !== null) switches.push(Math.round(along));
		} else if (el.type === 'way' && el.geometry?.length > 1) {
			const positions = el.geometry.map(g => project({ lat: g.lat, lng: g.lon }, route, cumulative)).filter(v => v !== null);
			if (!positions.length) continue;
			let length = 0;
			for (let i = 1; i < el.geometry.length; i++) {
				length += metres({ lat: el.geometry[i - 1].lat, lng: el.geometry[i - 1].lon }, { lat: el.geometry[i].lat, lng: el.geometry[i].lon });
			}
			let start = Math.min(...positions);
			let end = Math.max(...positions);
			if (end - start < length * 0.6) {
				const mid = (start + end) / 2;
				start = mid - length / 2;
				end = mid + length / 2;
			}
			if (end - start >= 8) bridges.push([Math.round(start), Math.round(end)]);
		}
	}
	// Parallel tracks map the same bridge/turnout several times: merge overlaps and near-duplicates.
	bridges.sort((a, b) => a[0] - b[0]);
	const merged = [];
	for (const b of bridges) {
		const last = merged[merged.length - 1];
		if (last && b[0] <= last[1] + 10) last[1] = Math.max(last[1], b[1]);
		else merged.push(b);
	}
	switches.sort((a, b) => a - b);
	const uniqueSwitches = switches.filter((s, i) => i === 0 || s - switches[i - 1] > 6);
	return { bridges: merged, switches: uniqueSwitches };
}

/**
 * Bridges ([startM, endM]) and turnouts (m) along the route, from cache or one Overpass request.
 * Resolves null when unavailable; callers fall back to synthetic station-throat turnouts.
 */
export async function getRailFeatures(route, cumulative) {
	if (!route?.length || route.length < 2 || cumulative?.length !== route.length) return null;
	const totalM = cumulative[cumulative.length - 1];
	const key = routeKey(route, totalM);
	const store = readStore();
	const hit = store[key];
	if (hit && Date.now() - hit.t < (hit.failed ? FAILURE_AGE : MAX_AGE)) {
		APIMonitor.log('railFeatures', key, true);
		return hit.v;
	}
	if (gate.isBlocked() || persistentlyBlocked() || (typeof navigator !== 'undefined' && navigator.onLine === false)) return null;

	const result = await gate.run(key, async () => {
		try {
			const response = await monitoredFetch(ENDPOINT, {
				method: 'POST',
				body: new URLSearchParams({ data: buildQuery(route) }),
				signal: AbortSignal.timeout(30000)
			});
			if (!response.ok) {
				if (response.status === 406 || response.status === 429) blockFor(REJECTED_BLOCK_MS);
				else blockFor(10 * 60_000);
				remember(key, null);
				return null;
			}
			const value = parse(await response.json(), route, cumulative);
			remember(key, value);
			gate.reportSuccess();
			return value;
		} catch {
			blockFor(10 * 60_000);
			remember(key, null);
			return null;
		}
	});
	return result ?? null;
}
