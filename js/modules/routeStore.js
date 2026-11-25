// ====================================
// ROUTE STORE — local-first routes for the standalone web app
// ====================================
// The device copy always lives in localStorage. Where the File System Access API exists
// (desktop Chrome/Edge) the same JSON is also written to a user-chosen Downloads/routes/ folder;
// elsewhere it can be downloaded/imported manually (browsers cannot write to Downloads silently).
//
// Bundled routes are copied into the device store once. Browser storage remains the
// source of truth; an optional File System Access folder is only a local mirror.

import bundledRoutes from '../../routes.json';

const MIRROR_KEY = 'transportSimulatorWebApp_routes_v1';
const DB_NAME = 'transportSimulator';
const DB_STORE = 'handles';
const HANDLE_KEY = 'routesFolder';
const FILE_NAME = 'routes.json';
const FOLDER_NAME = 'routes';

export const supportsFolderAccess = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

let mirror = loadMirror();
let folder = null;
let pendingHandle = null;
let folderState = supportsFolderAccess ? 'disconnected' : 'unsupported';
let syncPromise = null;
let initPromise = null;

// ---------- Persistence helpers ----------

function loadMirror() {
	try {
		const parsed = JSON.parse(localStorage.getItem(MIRROR_KEY) || 'null');
		if (parsed && typeof parsed.routes === 'object') {
			return {
				routes: parsed.routes || {},
				dirty: parsed.dirty || [],
				pendingDeletes: parsed.pendingDeletes || [],
				syncedAt: parsed.syncedAt || 0,
				folderWrittenAt: parsed.folderWrittenAt || 0,
				seededAt: parsed.seededAt || 0
			};
		}
	} catch { /* corrupted mirror — start fresh */ }
	return { routes: {}, dirty: [], pendingDeletes: [], syncedAt: 0, folderWrittenAt: 0, seededAt: 0 };
}

function saveMirror() {
	try {
		localStorage.setItem(MIRROR_KEY, JSON.stringify(mirror));
	} catch (e) {
		console.warn('Route store: could not save device copy', e);
	}
}

function idb(mode, fn) {
	return new Promise((resolve, reject) => {
		const open = indexedDB.open(DB_NAME, 1);
		open.onupgradeneeded = () => open.result.createObjectStore(DB_STORE);
		open.onerror = () => reject(open.error);
		open.onsuccess = () => {
			const tx = open.result.transaction(DB_STORE, mode);
			const req = fn(tx.objectStore(DB_STORE));
			tx.oncomplete = () => { open.result.close(); resolve(req?.result); };
			tx.onerror = () => { open.result.close(); reject(tx.error); };
		};
	});
}

// ---------- Route normalisation ----------

function round6(v) {
	return Math.round(v * 1e6) / 1e6;
}

function routePointCoordinates(point) {
	const source = point?.latlng ?? point?.coordinates ?? point;
	if (Array.isArray(source)) {
		const lat = Number(source[0]);
		const lng = Number(source[1]);
		return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
	}
	const lat = Number(source?.lat ?? source?.latitude);
	const lng = Number(source?.lng ?? source?.longitude ?? source?.lon);
	return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
}

function distanceBetweenPoints(from, to) {
	const radians = Math.PI / 180;
	const latitude = (to[0] - from[0]) * radians;
	const longitude = (to[1] - from[1]) * radians;
	const a = Math.sin(latitude / 2) ** 2
		+ Math.cos(from[0] * radians) * Math.cos(to[0] * radians) * Math.sin(longitude / 2) ** 2;
	return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function normalizeRoute(route) {
	if (!route) return null;
	let rawPoints = Array.isArray(route.points) ? route.points : null;
	let isGeoJsonLine = false;
	if (!rawPoints && route.type === 'Feature' && route.geometry?.type === 'LineString') {
		rawPoints = route.geometry.coordinates;
		isGeoJsonLine = true;
	}
	if (!Array.isArray(rawPoints) || !rawPoints.length) return null;
	const points = [];
	let previous = null;
	let distance = 0;
	for (const p of rawPoints) {
		const coordinates = routePointCoordinates(p);
		const ll = isGeoJsonLine && coordinates ? [coordinates[1], coordinates[0]] : coordinates;
		if (!ll || ll.length !== 2 || !ll.every(Number.isFinite)) return null;
		if (Math.abs(ll[0]) > 90 || Math.abs(ll[1]) > 180) return null;
		const point = { latlng: [round6(ll[0]), round6(ll[1])], placeName: p?.placeName || p?.name || 'Unknown' };
		if (p?.type) point.type = p.type;
		if (p?.placeType) point.placeType = p.placeType;
		if (previous) distance += distanceBetweenPoints(previous, point.latlng);
		previous = point.latlng;
		points.push(point);
	}
	const storedDistance = Number(route.total_distance ?? route.totalDistance ?? route.distance);
	return {
		points,
		total_distance: Number.isFinite(storedDistance) && storedDistance > 0 ? storedDistance : round6(distance),
		updated_at: Number(route.updated_at) || 0
	};
}

export function parseRoutesDocument(payload) {
	const entries = [];
	let invalid = 0;
	const visit = (candidate, fallbackName = '') => {
		if (!candidate || typeof candidate !== 'object') {
			invalid++;
			return;
		}
		const raw = candidate.routes ?? candidate.route;
		if (raw !== undefined && !candidate.points && candidate.type !== 'Feature') {
			visit(raw, candidate.route_name || candidate.name || fallbackName);
			return;
		}
		if (candidate.type === 'FeatureCollection' && Array.isArray(candidate.features)) {
			for (const feature of candidate.features) visit(feature, feature?.properties?.name || '');
			return;
		}
		if (Array.isArray(candidate)) {
			for (let index = 0; index < candidate.length; index++) {
				const item = candidate[index];
				visit(item, String(item?.route_name || item?.name || `Imported route ${index + 1}`));
			}
			return;
		}
		const route = normalizeRoute(candidate);
		if (route) {
			const name = String(candidate.route_name || candidate.name || candidate.properties?.name || fallbackName || '').trim();
			if (name) entries.push([name, route]);
			else invalid++;
			return;
		}
		for (const [name, value] of Object.entries(candidate)) visit(value, name);
	};
	visit(payload);
	if (!entries.length) throw new Error('No valid routes were found. Use a routes.json export or a route with a points array.');
	return { routes: Object.fromEntries(entries), invalid };
}

function sameRoute(a, b) {
	const key = r => {
		const n = normalizeRoute(r);
		return n ? JSON.stringify([n.points, String(n.total_distance ?? '')]) : null;
	};
	const ka = key(a);
	return ka !== null && ka === key(b);
}

function addTo(list, name) {
	if (!list.includes(name)) list.push(name);
}

function removeFrom(list, name) {
	const i = list.indexOf(name);
	if (i >= 0) list.splice(i, 1);
}

function seedBundledRoutes() {
	if (mirror.seededAt) return false;
	let added = 0;
	for (const [name, raw] of Object.entries(bundledRoutes || {})) {
		const route = normalizeRoute(raw);
		if (!route || mirror.routes[name]) continue;
		mirror.routes[name] = route;
		added++;
	}
	mirror.seededAt = Date.now();
	saveMirror();
	return added > 0;
}

// ---------- Device folder (Downloads/routes) ----------

async function restoreFolder() {
	if (!supportsFolderAccess || !('indexedDB' in window)) return;
	try {
		const handle = await idb('readonly', s => s.get(HANDLE_KEY));
		if (!handle) return;
		const perm = await handle.queryPermission({ mode: 'readwrite' });
		if (perm === 'granted') {
			folder = handle;
			folderState = 'connected';
		} else {
			pendingHandle = handle;
			folderState = 'needs-permission';
		}
	} catch (e) {
		console.warn('Route store: could not restore routes folder', e);
	}
}

async function readFolderFile() {
	if (!folder) return null;
	try {
		const fileHandle = await folder.getFileHandle(FILE_NAME);
		const file = await fileHandle.getFile();
		return { routes: JSON.parse(await file.text() || '{}'), lastModified: file.lastModified };
	} catch (e) {
		if (e?.name !== 'NotFoundError') console.warn('Route store: could not read routes.json', e);
		return null;
	}
}

async function writeFolderFile() {
	if (!folder) return;
	try {
		const fileHandle = await folder.getFileHandle(FILE_NAME, { create: true });
		const writable = await fileHandle.createWritable();
		await writable.write(JSON.stringify(mirror.routes, null, 2));
		await writable.close();
		mirror.folderWrittenAt = (await fileHandle.getFile()).lastModified;
		saveMirror();
	} catch (e) {
		console.warn('Route store: could not write routes.json', e);
		if (e?.name === 'NotAllowedError') {
			pendingHandle = folder;
			folder = null;
			folderState = 'needs-permission';
		}
	}
}

// Routes edited or copied into the folder file since our last write count as device edits.
function mergeFileIntoMirror(file) {
	if (!file || typeof file.routes !== 'object' || file.lastModified <= mirror.folderWrittenAt) return;
	for (const [name, raw] of Object.entries(file.routes)) {
		const route = normalizeRoute(raw);
		if (!route) continue;
		if (!mirror.routes[name] || !sameRoute(route, mirror.routes[name])) {
			mirror.routes[name] = route;
			addTo(mirror.dirty, name);
		}
	}
}

/** Pick (or re-authorise) the Downloads/routes folder. Must run from a user gesture. */
export async function connectRoutesFolder() {
	if (!supportsFolderAccess) {
		importRoutesFile();
		return;
	}
	try {
		let handle = null;
		if (pendingHandle && await pendingHandle.requestPermission({ mode: 'readwrite' }) === 'granted') {
			handle = pendingHandle;
		} else {
			const picked = await window.showDirectoryPicker({ id: 'transport-sim-routes', mode: 'readwrite', startIn: 'downloads' });
			handle = picked.name === FOLDER_NAME ? picked : await picked.getDirectoryHandle(FOLDER_NAME, { create: true });
			await idb('readwrite', s => s.put(handle, HANDLE_KEY));
		}
		folder = handle;
		pendingHandle = null;
		folderState = 'connected';
		mirror.folderWrittenAt = 0; // merge whatever the folder already holds
		await syncRoutes();
	} catch (e) {
		if (e?.name !== 'AbortError') {
			console.warn('Route store: folder connection failed', e);
			alert('Could not open the routes folder. Your routes are still stored in this browser.');
		}
	}
	renderStatus();
}

// ---------- Sync ----------

async function runSync() {
	if (initPromise) await initPromise;
	if (folder) mergeFileIntoMirror(await readFolderFile());
	seedBundledRoutes();
	mirror.dirty = [];
	mirror.pendingDeletes = [];
	mirror.syncedAt = Date.now();
	saveMirror();
	await writeFolderFile();
	return true;
}

/** Refresh the optional folder mirror; concurrent callers share one run. */
export function syncRoutes() {
	if (!syncPromise) {
		syncPromise = runSync()
			.catch(e => { console.warn('Route store: sync failed', e); return false; })
			.finally(() => { syncPromise = null; renderStatus(); });
	}
	return syncPromise;
}

function announceRouteChange(reason) {
	window.dispatchEvent(new CustomEvent('routes:changed', { detail: { reason } }));
	renderStatus();
}

export function initRouteStore() {
	initPromise = restoreFolder().finally(() => { initPromise = null; });
	renderStatus();
	return syncRoutes();
}

// ---------- Route operations ----------

/** Save a route to local browser storage. */
export async function saveRoute(routeData) {
	const name = String(routeData.route_name || '').trim();
	const route = normalizeRoute({ ...routeData, updated_at: Date.now() });
	if (!name || !route) return { ok: false, server: false, message: 'Invalid route' };

	mirror.routes[name] = route;
	addTo(mirror.dirty, name);
	removeFrom(mirror.pendingDeletes, name);
	saveMirror();
	await writeFolderFile();
	removeFrom(mirror.dirty, name);
	saveMirror();
	announceRouteChange('save');
	return { ok: true, server: false };
}

export async function deleteRoute(name) {
	delete mirror.routes[name];
	removeFrom(mirror.dirty, name);
	addTo(mirror.pendingDeletes, name);
	saveMirror();
	await writeFolderFile();
	removeFrom(mirror.pendingDeletes, name);
	saveMirror();
	announceRouteChange('delete');
	return { ok: true, server: false };
}

/** Route list for dialogs: syncs first, so it includes device-only routes and works offline. */
export async function getRouteMetadata() {
	await syncRoutes();
	return Object.entries(mirror.routes).map(([name, r]) => ({
		name,
		distance: parseFloat(r.total_distance) || 0,
		pointCount: r.points.length
	}));
}

/** Route in runtime format ({latlng: {lat, lng}}). */
export async function loadRoute(name) {
	const route = mirror.routes[name];
	if (!route) return null;
	return {
		...route,
		points: route.points.map(p => ({ ...p, latlng: { lat: p.latlng[0], lng: p.latlng[1] } }))
	};
}

// ---------- Manual export / import (mobile and browsers without folder access) ----------

export function exportRoutesFile() {
	const blob = new Blob([JSON.stringify(mirror.routes, null, 2)], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const a = Object.assign(document.createElement('a'), { href: url, download: FILE_NAME });
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function importRoutesFile() {
	const input = Object.assign(document.createElement('input'), {
		type: 'file',
		accept: '.json,application/json,application/geo+json',
		multiple: true,
		hidden: true
	});
	document.body.appendChild(input);
	input.onchange = async () => {
		const files = [...(input.files || [])];
		if (!files.length) { input.remove(); return; }
		try {
			let count = 0;
			let invalid = 0;
			const errors = [];
			for (const file of files) {
				try {
					const payload = JSON.parse(await file.text());
					const parsed = parseRoutesDocument(payload);
					invalid += parsed.invalid;
					for (const [name, raw] of Object.entries(parsed.routes)) {
						const route = normalizeRoute(raw);
						if (!route || (mirror.routes[name] && sameRoute(route, mirror.routes[name]))) continue;
						mirror.routes[name] = { ...route, updated_at: Date.now() };
						addTo(mirror.dirty, name);
						removeFrom(mirror.pendingDeletes, name);
						count++;
					}
				} catch (error) {
					errors.push(`${file.name}: ${error.message}`);
				}
			}
			saveMirror();
			await writeFolderFile();
			mirror.dirty = [];
			saveMirror();
			announceRouteChange('import');
			const result = count ? `Imported ${count} route${count === 1 ? '' : 's'}.` : 'No new or changed routes were found.';
			const skipped = invalid ? ` Skipped ${invalid} invalid route${invalid === 1 ? '' : 's'}.` : '';
			const failed = errors.length ? `\n\n${errors.join('\n')}` : '';
			alert(`${result}${skipped}${failed}`);
		} catch (e) {
			alert(`Could not import routes: ${e.message}`);
		} finally {
			input.value = '';
			input.remove();
		}
	};
	input.click();
}

// ---------- Settings UI ----------

function renderStatus() {
	const status = document.getElementById('routeStorageStatus');
	if (!status) return;
	const count = Object.keys(mirror.routes).length;
	const device = {
		connected: 'Downloads/routes/routes.json',
		'needs-permission': 'routes folder needs permission',
		disconnected: 'this browser (no folder chosen)',
		unsupported: 'this browser'
	}[folderState];
	status.textContent = `${count} route${count === 1 ? '' : 's'} · saved locally · ${device}`;

	const folderBtn = document.getElementById('routeFolderBtn');
	if (folderBtn) {
		folderBtn.style.display = supportsFolderAccess ? '' : 'none';
		folderBtn.textContent = folderState === 'needs-permission' ? 'Reconnect folder'
			: folderState === 'connected' ? 'Change folder' : 'Choose Downloads/routes';
	}
	const refreshBtn = document.getElementById('routeRefreshBtn');
	if (refreshBtn) refreshBtn.style.display = supportsFolderAccess ? '' : 'none';
	const hint = document.getElementById('routeStorageHint');
	if (hint) {
		hint.textContent = supportsFolderAccess
			? 'Pick your Downloads folder once; routes are kept in this browser and mirrored to Downloads/routes/routes.json.'
			: 'Android browsers keep routes inside the app. Use Import JSON to bring in route files and Download for a backup; folder permission does not grant browser storage access.';
	}
}

export function refreshRouteStorageUI() {
	renderStatus();
}
