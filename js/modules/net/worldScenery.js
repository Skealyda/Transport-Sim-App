import { PersistentCache, monitoredFetch } from '../cache.js';
import { createGate } from './gate.js';

const gate = createGate({ minIntervalMs: 5000, baseBackoffMs: 60_000 });
const imageryGate = createGate({ minIntervalMs: 120, baseBackoffMs: 5000 });
const CACHE = { storageKey: 'worldScenery_v1', maxAge: 7 * 24 * 60 * 60 * 1000 };
const MAX_POINTS = 180;
const MAX_FEATURES = 1800;
const imageryMemory = new Map();
const OVERPASS_ENDPOINTS = [
	'https://overpass-api.de/api/interpreter',
	'https://overpass.kumi.systems/api/interpreter',
	'https://overpass.nchc.org.tw/api/interpreter'
];

function sampleRoute(route) {
	const step = Math.max(1, Math.ceil(route.length / MAX_POINTS));
	return route.filter((_, index) => index % step === 0 || index === route.length - 1);
}

function routeKey(route) {
	let hash = 2166136261;
	for (const point of sampleRoute(route)) {
		for (const char of `${point.lat.toFixed(4)},${point.lng.toFixed(4)};`) {
			hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
		}
	}
	return (hash >>> 0).toString(36);
}

function geometryFor(element) {
	if (!element.geometry || element.geometry.length < 4) return null;
	const coordinates = element.geometry.map(point => [point.lon, point.lat]);
	const first = coordinates[0];
	const last = coordinates[coordinates.length - 1];
	if (first[0] !== last[0] || first[1] !== last[1]) coordinates.push([...first]);
	if (coordinates.length < 4) return null;
	return { type: 'Polygon', coordinates: [coordinates] };
}

function queryFor(route) {
	const line = sampleRoute(route).map(point => `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`).join(',');
	return `[out:json][timeout:30];(` +
		`way["building"](around:220,${line});` +
		`way["landuse"~"forest|farmland|farm|orchard|vineyard|grass|meadow|recreation_ground"](around:220,${line});` +
		`way["natural"~"wood|water|grassland"](around:220,${line});` +
		`relation["natural"="water"](around:220,${line});` +
		`);out body geom;`;
}

function toFeatureCollection(data) {
	const features = [];
	for (const element of data.elements || []) {
		if (features.length >= MAX_FEATURES || element.type !== 'way') continue;
		const geometry = geometryFor(element);
		if (!geometry) continue;
		features.push({
			type: 'Feature',
			id: `${element.type}/${element.id}`,
			properties: element.tags || {},
			geometry
		});
	}
	return { type: 'FeatureCollection', features };
}

/** One cached, rate-limited OSM footprint/land-cover request for a route corridor. */
export async function fetchWorldScenery(route) {
	const points = route.map(point => point.latlng || point)
		.filter(point => Number.isFinite(point?.lat) && Number.isFinite(point?.lng));
	if (points.length < 2) return null;
	const key = routeKey(points);
	const store = PersistentCache.load(CACHE.storageKey) || {};
	if (store[key] && Date.now() - store[key].t < CACHE.maxAge) return store[key].v;
	if (gate.isBlocked() || navigator.onLine === false) return null;
	const result = await gate.run(key, async () => {
		let value = null;
		const failures = [];
		for (const endpoint of OVERPASS_ENDPOINTS) {
			try {
				const response = await monitoredFetch(endpoint, {
					method: 'POST',
					body: new URLSearchParams({ data: queryFor(points) }),
					signal: AbortSignal.timeout(30000)
				});
				if (!response.ok) {
					failures.push(`HTTP ${response.status}`);
					continue;
				}
				value = toFeatureCollection(await response.json());
				break;
			} catch (error) {
				failures.push(error.message);
			}
		}
		if (!value) throw new Error(`Scenery providers unavailable (${failures.join(', ')})`);
		store[key] = { v: value, t: Date.now() };
		PersistentCache.save(CACHE.storageKey, store, CACHE.maxAge);
		gate.reportSuccess();
		return value;
	});
	return result || null;
}

export function satelliteTileUrl(z, x, y) {
	const size = 2 ** z;
	return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${((y % size) + size) % size}/${((x % size) + size) % size}`;
}

export function satelliteTileIndices(lat, lng, zoom = 14) {
	const size = 2 ** zoom;
	const latitude = Math.max(-85, Math.min(85, lat)) * Math.PI / 180;
	const x = (lng + 180) / 360 * size;
	const y = (1 - Math.asinh(Math.tan(latitude)) / Math.PI) / 2 * size;
	return { x, y, zoom, tileX: Math.floor(x), tileY: Math.floor(y) };
}

export async function fetchSatelliteMosaic(lat, lng, zoom = 14) {
	const cacheKey = `${zoom}:${lat.toFixed(3)}:${lng.toFixed(3)}`;
	if (imageryMemory.has(cacheKey)) return imageryMemory.get(cacheKey);
	const center = satelliteTileIndices(lat, lng, zoom);
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = 768;
	const context = canvas.getContext('2d');
	context.fillStyle = '#75835f';
	context.fillRect(0, 0, canvas.width, canvas.height);
	let loaded = 0;
	await Promise.all(Array.from({ length: 9 }, (_, slot) => {
		const column = slot % 3 - 1;
		const row = Math.floor(slot / 3) - 1;
		return imageryGate.run(`${zoom}/${center.tileY + row}/${center.tileX + column}`, async () => {
			const url = satelliteTileUrl(zoom, center.tileX + column, center.tileY + row);
			const response = await monitoredFetch(url, { mode: 'cors', signal: AbortSignal.timeout(12000) });
			if (!response.ok) throw new Error(`Satellite imagery HTTP ${response.status}`);
			const image = await createImageBitmap(await response.blob());
			context.drawImage(image, (column + 1) * 256, (row + 1) * 256, 256, 256);
			image.close();
			loaded++;
		}).catch(error => console.warn('Satellite tile skipped:', error.message));
	}));
	const metresPerPixel = 156543.03392 * Math.cos(lat * Math.PI / 180) / 2 ** zoom;
	const result = { canvas, loaded, center: { lat, lng }, metresPerPixel };
	if (imageryMemory.size >= 3) imageryMemory.delete(imageryMemory.keys().next().value);
	imageryMemory.set(cacheKey, result);
	return result;
}

export function categorizeSatelliteRgb(red, green, blue) {
	const brightness = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
	const saturation = Math.max(red, green, blue) - Math.min(red, green, blue);
	if (green > red * 1.07 && green > blue * 1.08 && brightness > 28) return 'forest';
	if (brightness > 48 && saturation > 9) return 'building';
	return 'none';
}

function squareAt(lat, lng, widthMetres, lengthMetres, bearing) {
	const forward = bearing * Math.PI / 180;
	const east = Math.sin(forward);
	const south = -Math.cos(forward);
	const right = { east: Math.cos(forward), south: Math.sin(forward) };
	const corners = [
		[-widthMetres / 2, -lengthMetres / 2], [widthMetres / 2, -lengthMetres / 2],
		[widthMetres / 2, lengthMetres / 2], [-widthMetres / 2, lengthMetres / 2]
	].map(([side, along]) => {
		const x = right.east * side + east * along;
		const y = right.south * side + south * along;
		return {
			lat: lat + y / 110540,
			lng: lng + x / (111320 * Math.cos(lat * Math.PI / 180))
		};
	});
	return [...corners, corners[0]].map(point => [point.lng, point.lat]);
}

/** Generate conservative 3D footprints from actual satellite colour/structure patterns. */
export function deriveSatelliteScenery(imagery, route, zoom = 14) {
	if (!imagery?.canvas || !imagery.loaded || !Array.isArray(route)) return { type: 'FeatureCollection', features: [] };
	const points = route.map(point => point.latlng || point)
		.filter(point => Number.isFinite(point?.lat) && Number.isFinite(point?.lng));
	if (points.length < 2) return { type: 'FeatureCollection', features: [] };
	const center = satelliteTileIndices(imagery.center.lat, imagery.center.lng, zoom);
	const originX = center.tileX - 1;
	const originY = center.tileY - 1;
	const context = imagery.canvas.getContext('2d', { willReadFrequently: true });
	if (!context) return { type: 'FeatureCollection', features: [] };
	const image = context.getImageData(0, 0, imagery.canvas.width, imagery.canvas.height).data;
	const features = [];
	const occupied = new Set();
	const width = imagery.canvas.width;
	const sample = (lat, lng) => {
		const projected = satelliteTileIndices(lat, lng, zoom);
		const rawX = (projected.x - originX) * 256;
		const rawY = (projected.y - originY) * 256;
		if (rawX < 0 || rawX >= width || rawY < 0 || rawY >= imagery.canvas.height) return { category: 'none', x: -1, y: -1 };
		const x = Math.round(rawX);
		const y = Math.round(rawY);
		const offset = (y * width + x) * 4;
		return {
			category: categorizeSatelliteRgb(image[offset], image[offset + 1], image[offset + 2]),
			x, y
		};
	};
	for (let index = 0; index < points.length - 1; index++) {
		const from = points[index];
		const to = points[index + 1];
		const dx = (to.lng - from.lng) * 111320 * Math.cos(from.lat * Math.PI / 180);
		const dy = (to.lat - from.lat) * 110540;
		const length = Math.hypot(dx, dy);
		const bearing = Math.atan2(dx, dy) * 180 / Math.PI;
		const steps = Math.max(1, Math.ceil(length / 90));
		for (let step = 0; step <= steps; step++) {
			const progress = step / steps;
			const lat = from.lat + (to.lat - from.lat) * progress;
			const lng = from.lng + (to.lng - from.lng) * progress;
			for (const side of [-1, 1]) {
				for (const distance of [55, 120, 210]) {
					const angle = (bearing + side * 90) * Math.PI / 180;
					const sampleLat = lat + Math.cos(angle) * distance / 110540;
					const sampleLng = lng + Math.sin(angle) * distance / (111320 * Math.cos(lat * Math.PI / 180));
					const result = sample(sampleLat, sampleLng);
					const key = `${Math.floor(result.x / 8)}:${Math.floor(result.y / 8)}`;
					if (result.category === 'none' || occupied.has(key)) continue;
					occupied.add(key);
					const isBuilding = result.category === 'building';
					features.push({
						type: 'Feature',
						id: `satellite/${key}`,
						properties: isBuilding
							? { building: 'yes', height: `${8 + ((result.x + result.y) % 12)} m`, source: 'satellite-derived' }
							: { natural: 'wood', source: 'satellite-derived' },
						geometry: {
							type: 'Polygon',
							coordinates: [squareAt(sampleLat, sampleLng, isBuilding ? 12 : 34, isBuilding ? 18 : 34, bearing)]
						}
					});
					if (features.length >= 420) return { type: 'FeatureCollection', features };
				}
			}
		}
	}
	return { type: 'FeatureCollection', features };
}
