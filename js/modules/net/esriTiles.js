import state from '../state.js';
import { MAP_QUALITY_OPTIONS } from '../constants.js';

const API = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer';
let grid = null;
const availability = new Map();

async function hasCoverage(zoom, extent) {
	if (!grid) grid = ol.tilegrid.createXYZ({ maxZoom: 22 });
	const range = grid.getTileRangeForExtentAndZ(extent, zoom);
	const limit = 2 ** zoom - 1;
	const minX = Math.max(0, Math.min(limit, range.minX));
	const minY = Math.max(0, Math.min(limit, range.minY));
	const maxX = Math.max(minX, Math.min(limit, range.maxX));
	const maxY = Math.max(minY, Math.min(limit, range.maxY));
	const key = `${zoom}/${minY}/${minX}/${maxY - minY + 1}/${maxX - minX + 1}`;
	if (availability.has(key)) return availability.get(key);
	const response = await fetch(`${API}/tilemap/${key}`, { signal: AbortSignal.timeout(10000) });
	if (!response.ok) throw new Error(`Esri coverage HTTP ${response.status}`);
	const data = await response.json();
	if (!Array.isArray(data.data) || !data.data.length || !data.data.every(value => value === 0 || value === 1)) {
		throw new Error('Invalid Esri imagery coverage response');
	}
	const available = data.data.every(value => value === 1);
	if (availability.size >= 128) availability.delete(availability.keys().next().value);
	availability.set(key, available);
	return available;
}

export function createEsriSatelliteLayer(quality, attributions, onStatus) {
	const profile = MAP_QUALITY_OPTIONS[quality];
	let nativeZoom = Math.min(16, profile.maxZoom);
	let lastFetch = 0;
	let lastZoom = null;
	let pending = false;
	const layer = new ol.layer.Tile();

	function makeSource() {
		return new ol.source.XYZ({
			url: `${API}/tile/{z}/{y}/{x}`,
			maxZoom: nativeZoom,
			attributions: frame => {
				const zoom = Math.round(Math.log2(156543.03392 / frame.viewState.resolution));
				const interval = zoom !== lastZoom ? 1000 : 30000;
				if (!pending && Date.now() - lastFetch >= interval && !frame.viewHints?.[0]) refresh();
				return attributions;
			}
		});
	}

	async function refresh() {
		pending = true;
		lastFetch = Date.now();
		const view = state.map.getView();
		lastZoom = Math.round(view.getZoom());
		const extent = view.calculateExtent(state.map.getSize());
		let low = 0;
		let high = Math.min(profile.maxZoom, Math.ceil(view.getZoom()));
		let best = 0;
		try {
			while (low <= high) {
				const zoom = Math.floor((low + high) / 2);
				if (await hasCoverage(zoom, extent)) {
					best = zoom;
					low = zoom + 1;
				} else {
					high = zoom - 1;
				}
			}
			if (best !== nativeZoom) {
				nativeZoom = best;
				layer.setSource(makeSource());
			}
			onStatus(`Esri Satellite | ${quality} quality | available detail: zoom ${nativeZoom}`);
		} catch (error) {
			console.warn('Esri imagery coverage lookup failed:', error.message);
			onStatus(`Esri Satellite: ${error.message}; retaining zoom ${nativeZoom} imagery`);
		} finally {
			pending = false;
		}
	}

	layer.setSource(makeSource());
	refresh();
	return layer;
}
