// Headless performance probe: loads the app, starts an automatic sim on a saved
// route and reports network requests per host, duplicate module loads, FPS and heap.
// Usage: node scripts/perf-probe.mjs [url] [routeName] [seconds]
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://127.0.0.1:5173/';
const routeName = process.argv[3] || 'Pdkt-Svga';
const seconds = Number(process.argv[4] || 60);

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-precise-memory-info'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

const requests = [];
page.on('request', r => requests.push({ url: r.url(), t: Date.now() }));
const errors = [];
page.on('pageerror', e => errors.push(e.message));

function summarize(list) {
	const byHost = {};
	for (const r of list) {
		const u = new URL(r.url);
		const key = u.origin === new URL(url).origin ? `self:${u.pathname.split('/')[1] || '/'}` : u.host;
		byHost[key] = (byHost[key] || 0) + 1;
	}
	return Object.entries(byHost).sort((a, b) => b[1] - a[1]);
}

await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(3000);

const loadRequests = [...requests];
const modulePaths = {};
for (const r of loadRequests) {
	const u = new URL(r.url);
	if (u.pathname.endsWith('.js')) {
		(modulePaths[u.pathname] ||= new Set()).add(u.search);
	}
}
const duplicateModules = Object.entries(modulePaths).filter(([, s]) => s.size > 1).map(([p, s]) => `${p} x${s.size}`);

console.log(`\n== Page load: ${loadRequests.length} requests`);
console.table(summarize(loadRequests));
console.log('Duplicate module instances:', duplicateModules.length ? duplicateModules : 'none');

const started = await page.evaluate(async (routeName) => {
	await window.showRouteDialog();
	const dd = document.getElementById('routeDropdown');
	for (let i = 0; i < 50 && !Array.from(dd.options).some(o => o.value === routeName); i++) {
		await new Promise(r => setTimeout(r, 100));
	}
	dd.value = routeName;
	document.getElementById('routeTypeSelector').value = 'rail';
	await window.loadSelectedRoute();
	await new Promise(r => setTimeout(r, 1500));
	document.getElementById('transportMode').value = 'train';
	document.getElementById('maxSpeedInput').value = '300';
	const auto = document.querySelector('input[name="simMode"][value="automatic"]');
	if (auto) auto.checked = true;
	await window.startSimulation();
	return !!(window.state && window.state.route && window.state.route.length);
}, routeName);
console.log(`\nSimulation started: ${started}`);

// Follow the vehicle so tile churn is measured like a real navigation session.
await page.evaluate(() => { if (window.state) window.state.isTracking = true; });

const simStart = Date.now();
await page.evaluate(() => {
	window.__frames = 0;
	window.__mapFrames = 0;
	window.state.map.on('postrender', () => window.__mapFrames++);
	(function tick() { window.__frames++; requestAnimationFrame(tick); })();
});
await page.waitForTimeout(seconds * 1000);
const stats = await page.evaluate(() => ({
	frames: window.__frames,
	mapFrames: window.__mapFrames,
	heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
	speed: window.state ? Math.round(window.state.currentDisplaySpeed || 0) : null,
	covered: window.state ? Number(window.state.totalDistanceCovered || 0).toFixed(2) : null,
}));
const simRequests = requests.filter(r => r.t >= simStart);
const tileZ = {};
for (const r of simRequests) {
	const m = new URL(r.url).pathname.match(/\/(\d{1,2})\/\d+\/\d+\.png$/);
	if (m) tileZ[m[1]] = (tileZ[m[1]] || 0) + 1;
}
const view = await page.evaluate(() => {
	const v = window.state?.map?.getView();
	return v ? { zoom: v.getZoom()?.toFixed(2), rotationDeg: ((v.getRotation() || 0) * 180 / Math.PI).toFixed(1) } : null;
});

console.log(`\n== During ${seconds}s sim: ${simRequests.length} requests (${(simRequests.length / seconds * 60).toFixed(0)}/min)`);
console.table(summarize(simRequests));
console.log(`Headless rAF callbacks ${(stats.frames / seconds).toFixed(1)}/s (not hardware FPS), map renders ${(stats.mapFrames / seconds).toFixed(1)}/s, heap ${stats.heapMB} MB, speed ${stats.speed} km/h, covered ${stats.covered} km`);
console.log('Tile requests by zoom:', tileZ, 'final view:', view);
if (errors.length) console.log('Page errors:', [...new Set(errors)].slice(0, 10));

await browser.close();
