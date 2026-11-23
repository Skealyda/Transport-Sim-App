import state from '../state.js';
import { MAP_QUALITY_OPTIONS } from '../constants.js';
import { loadClientConfig, getClientConfig } from './config.js';

const API = 'https://tile.googleapis.com';
const STORAGE_KEY = 'google_2d_session_v2';
const sessions = new Map();
const viewports = new Map();
const pending = new Map();
const disabled = new Set();
const statuses = new Map();

export function getGoogleSatelliteStatus(quality = state.mapQuality) {
	return statuses.get(quality) || 'Loading Google satellite configuration';
}

export function resetGoogleSatelliteConfiguration() {
	disabled.clear();
	pending.clear();
	sessions.clear();
	viewports.clear();
	statuses.clear();
}

function getSession(quality) {
	if (disabled.has(quality)) return null;
	const key = getClientConfig().googleMapsApiKey;
	const session = sessions.get(quality);
	return key && session && session.expiry * 1000 - Date.now() > 60000 ? { ...session, key } : null;
}

function readStoredSession(quality) {
	try {
		const stored = JSON.parse(localStorage.getItem(`${STORAGE_KEY}_${quality}`));
		return stored && stored.token && stored.expiry * 1000 - Date.now() > 3600000 ? stored : null;
	} catch {
		console.warn('Google satellite session storage could not be read');
		return null;
	}
}

function viewportParams(active, quality, view, extent) {
	const [west, south, east, north] = ol.proj.transformExtent(extent, view.projection, 'EPSG:4326');
	const clamp = (value, limit) => Math.max(-limit, Math.min(limit, value)).toFixed(5);
	return new URLSearchParams({
		session: active.token, key: active.key,
		zoom: String(Math.min(MAP_QUALITY_OPTIONS[quality].maxZoom, Math.max(0, Math.round(Math.log2(156543.03392 / view.resolution))))),
		north: clamp(north, 85), south: clamp(south, 85), east: clamp(east, 180), west: clamp(west, 180)
	});
}

async function fetchViewport(active, quality, view, extent) {
	const params = viewportParams(active, quality, view, extent);
	const response = await fetch(`${API}/tile/v1/viewport?${params}`, { signal: AbortSignal.timeout(10000) });
	if (!response.ok) throw new Error(`Viewport information HTTP ${response.status}`);
	const data = await response.json();
	if (!Array.isArray(data.maxZoomRects)) throw new Error('Invalid Google imagery coverage response');
	return data;
}

function coverageZoom(data, quality, view, extent) {
	const [west, south, east, north] = ol.proj.transformExtent(extent, view.projection, 'EPSG:4326');
	const points = [[west, south], [east, south], [west, north], [east, north], ol.proj.toLonLat(view.center, view.projection)];
	const available = points.map(([lng, lat]) => {
		let maxZoom = 0;
		for (const rect of data.maxZoomRects) {
			const insideLongitude = rect.west <= rect.east
				? lng >= rect.west && lng <= rect.east
				: lng >= rect.west || lng <= rect.east;
			if (insideLongitude && lat >= rect.south && lat <= rect.north && Number.isFinite(rect.maxZoom)) {
				maxZoom = Math.max(maxZoom, rect.maxZoom);
			}
		}
		return maxZoom;
	});
	return Math.min(MAP_QUALITY_OPTIONS[quality].maxZoom, ...available);
}

export function ensureGoogleSatelliteSession(quality = state.mapQuality) {
	if (disabled.has(quality)) return Promise.resolve(null);
	if (pending.has(quality)) return pending.get(quality);
	const work = loadClientConfig().then(async config => {
		const key = config.googleMapsApiKey;
		if (!key) throw new Error('GOOGLE_MAPS_API_KEY is not configured');
		// The server supplies a non-secret fingerprint, including on non-secure HTTP origins.
		const fingerprint = config.googleMapsKeyId;
		const canPersist = typeof fingerprint === 'string' && fingerprint.length === 64;
		if (!canPersist) console.warn('Google key identity is unavailable; session caching across reloads is disabled');
		const stored = canPersist ? readStoredSession(quality) : null;
		if (!getSession(quality) && stored && stored.fingerprint === fingerprint) sessions.set(quality, stored);
		if (!getSession(quality)) {
			const options = MAP_QUALITY_OPTIONS[quality];
			const response = await fetch(`${API}/v1/createSession?key=${encodeURIComponent(key)}`, {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				signal: AbortSignal.timeout(10000),
				body: JSON.stringify({
					mapType: 'satellite', language: navigator.language || 'en-US',
					region: /-([A-Z]{2})$/i.exec(navigator.language || '')?.[1]?.toUpperCase() || 'US',
					scale: options.highDpi ? 'scaleFactor2x' : 'scaleFactor1x',
					highDpi: options.highDpi
				})
			});
			if (!response.ok) throw new Error(`createSession HTTP ${response.status}. Check Map Tiles API, billing and key restrictions`);
			const data = await response.json();
			if (!data.session || !Number.isFinite(Number(data.expiry))) throw new Error('Invalid Google satellite session response');
			const session = {
				token: data.session, expiry: Number(data.expiry), fingerprint,
				tilePixelRatio: Number(data.tileWidth || 256) / 256
			};
			sessions.set(quality, session);
			if (canPersist) {
				try {
					localStorage.setItem(`${STORAGE_KEY}_${quality}`, JSON.stringify(session));
				} catch {
					console.warn('Google satellite session could not be persisted; using the current browser session');
				}
			}
		}
		const active = getSession(quality);
		const view = state.map.getView();
		viewports.set(quality, await fetchViewport(active, quality, view.getState(), view.calculateExtent(state.map.getSize())));
		statuses.set(quality, 'Google satellite');
		return active;
	}).catch(error => {
		statuses.set(quality, `Google satellite unavailable: ${error.message}`);
		console.warn(getGoogleSatelliteStatus(quality));
		disabled.add(quality);
		return null;
	}).finally(() => pending.delete(quality));
	pending.set(quality, work);
	return work;
}

function escapeHtml(value) {
	return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

export function createGoogleSatelliteLayer(onFailure, quality = state.mapQuality) {
	const active = getSession(quality);
	let data = viewports.get(quality);
	if (!active || !data) return null;
	const view = state.map.getView();
	let maxZoom = coverageZoom(data, quality, view.getState(), view.calculateExtent(state.map.getSize()));
	let lastFetch = Date.now();
	let lastZoom = Math.round(view.getZoom());
	let refreshing = false;
	let errors = 0;
	const layer = new ol.layer.Tile();

	const attribution = frame => {
		if (frame?.viewState && !refreshing) {
			const zoom = Math.round(Math.log2(156543.03392 / frame.viewState.resolution));
			const now = Date.now();
			const interval = zoom !== lastZoom ? 1000 : 30000;
			if (now - lastFetch >= interval && !frame.viewHints?.[0]) {
				lastFetch = now;
				lastZoom = zoom;
				refreshing = true;
				fetchViewport(active, quality, frame.viewState, frame.extent).then(updated => {
					data = updated;
					viewports.set(quality, updated);
					const currentView = state.map.getView();
					const nextMaxZoom = coverageZoom(updated, quality, currentView.getState(), currentView.calculateExtent(state.map.getSize()));
					if (nextMaxZoom !== maxZoom) {
						maxZoom = nextMaxZoom;
						layer.setSource(makeSource());
					}
				}).catch(error => console.warn('Google imagery coverage refresh failed:', error.message))
					.finally(() => { refreshing = false; });
			}
		}
		return `Google Maps${data.copyright ? ` &middot; ${escapeHtml(data.copyright)}` : ''}`;
	};

	function makeSource() {
		const source = new ol.source.XYZ({
			url: `${API}/v1/2dtiles/{z}/{x}/{y}?session=${encodeURIComponent(active.token)}&key=${encodeURIComponent(active.key)}`,
			maxZoom, tilePixelRatio: active.tilePixelRatio,
			attributions: attribution, attributionsCollapsible: false
		});
		source.on('tileloaderror', () => {
			if (++errors !== 6) return;
			statuses.set(quality, 'Google satellite tile requests failed; check session, quota and key restrictions');
			console.warn(getGoogleSatelliteStatus(quality));
			disabled.add(quality);
			sessions.delete(quality);
			try {
				localStorage.removeItem(`${STORAGE_KEY}_${quality}`);
			} catch {
				console.warn('Failed to clear the expired Google satellite session from browser storage');
			}
			onFailure?.();
		});
		source.on('tileloadend', () => { errors = 0; });
		return source;
	}
	layer.setSource(makeSource());
	return layer;
}
