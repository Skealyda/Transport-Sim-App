import assert from 'node:assert/strict';
import { chromium, devices } from 'playwright-core';
import { createFramePacer } from '../js/modules/framePacing.js';

const baseURL = process.env.WORLD_TEST_URL || 'http://127.0.0.1:5173';
for (const refresh of [60, 120, 144]) {
	for (const target of [30, 60, 120]) {
		const ready = createFramePacer();
		const times = [];
		for (let frame = 0; frame < refresh * 3; frame++) {
			const timestamp = Math.round(frame * 10000 / refresh) / 10;
			if (ready(timestamp, target)) times.push(timestamp);
		}
		assert.ok(Math.abs(times.length / 3 - Math.min(refresh, target)) < 1, `${target} FPS pacing on ${refresh} Hz must use available refreshes`);
		const gaps = times.slice(1).map((time, i) => time - times[i]);
		assert.ok(Math.max(...gaps) - Math.min(...gaps) < 1000 / refresh + 0.2, 'Pacing must not skip an extra refresh at quantized deadlines');
		assert.ok(ready(10000, target), 'A foreground stall should render one current frame');
		assert.equal(ready(10000, target), false, 'No burst catch-up frames after a stall');
	}
}
console.log('30/60/120 FPS deadline pacing passed at 60/120/144 Hz');

const baseline = process.argv.includes('--baseline');
const performanceMode = process.argv.includes('--performance');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));

function slowFrames() {
	// Exercise low FPS independently of the host GPU or refresh rate.
	window.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 1000 / 15);
	window.cancelAnimationFrame = id => clearTimeout(id);
}

async function checkManualMotion() {
	const manualPage = await browser.newPage();
	try {
		await manualPage.addInitScript(slowFrames);
		await manualPage.goto(baseURL, { waitUntil: 'load' });
		await manualPage.evaluate(async () => {
			const { default: state } = await import('/js/modules/state.js');
			const { startManualSimulation } = await import('/js/modules/manualControls.js');
			window.setPerformanceMode(true);
			state.route = [
				{ latlng: { lat: 11.1271, lng: 78.6569 }, placeName: 'Start', type: 'stop' },
				{ latlng: { lat: 11.1271, lng: 80.6569 }, placeName: 'End', type: 'stop' }
			];
			document.getElementById('maxSpeedInput').value = '120';
			state.maxGForceLimit = 1;
			startManualSimulation(state.route, 'train', 120, 3);
			state.manualControlState.targetSpeed = 120;
			state.manualControlState.acceleration = 100;
			state.manualControlState.brakeLevel = 0;
		});
		await manualPage.waitForFunction(() => window.state.manualControlState.currentSpeed === 120);
		const start = await manualPage.evaluate(() => ({
			t: performance.now(), coords: window.state.movingFeature.getGeometry().getCoordinates()
		}));
		await manualPage.waitForTimeout(2000);
		const result = await manualPage.evaluate(start => {
			const state = window.state;
			const end = state.movingFeature.getGeometry().getCoordinates();
			const distanceKm = ol.sphere.getDistance(ol.proj.toLonLat(start.coords), ol.proj.toLonLat(end)) / 1000;
			return { ratio: distanceKm / (120 * (performance.now() - start.t) / 3600000), couplingsInVehicleLayer: state.trainCouplings.every(feature => window.vehicleLayer.getSource().hasFeature(feature)) };
		}, start);
		assert.ok(Math.abs(result.ratio - 1) < 0.08, `Manual 15-FPS movement / speed: ${result.ratio}`);
		assert.ok(result.couplingsInVehicleLayer, 'Manual couplings must stay in the vehicle layer');
		assert.match(await manualPage.locator('#nextStopTime').textContent(), /\d+[hms]/, 'Manual ETA must use the shared route estimate');
		await manualPage.evaluate(() => window.pauseSimulation());
		const paused = await manualPage.evaluate(() => window.state.movingFeature.getGeometry().getCoordinates());
		await manualPage.waitForTimeout(600);
		assert.deepEqual(await manualPage.evaluate(() => window.state.movingFeature.getGeometry().getCoordinates()), paused, 'Paused train must not move');
		await manualPage.evaluate(() => window.resumeSimulation());
		await manualPage.waitForTimeout(500);
		const resumedKm = await manualPage.evaluate(paused => ol.sphere.getDistance(
			ol.proj.toLonLat(paused), ol.proj.toLonLat(window.state.movingFeature.getGeometry().getCoordinates())
		) / 1000, paused);
		assert.ok(resumedKm > 0.005 && resumedKm < 0.025, 'Resume must move without catching up paused time');
		console.log('Manual 15 FPS motion:', JSON.stringify(result));
		await manualPage.evaluate(async () => {
			window.stopSimulation();
			const { default: state } = await import('/js/modules/state.js');
			const { initCareerMode } = await import('/js/modules/careerMode.js');
			const { initializeTrainCoaches } = await import('/js/modules/vehicle.js');
			initCareerMode(3);
			state.map.getView().setZoom(22);
			initializeTrainCoaches('train', ol.proj.fromLonLat([78.6569, 11.1271]), 90, 3);
		});
		const careerRatio = await manualPage.evaluate(() => {
			const state = window.state;
			const [loco, coach] = state.trainCoaches;
			const a = loco.getGeometry().getCoordinates(), b = coach.getGeometry().getCoordinates();
			const image = loco.getStyle().getImage();
			return Math.hypot(a[0] - b[0], a[1] - b[1]) / state.map.getView().getResolution() / (image.getSize()[0] * image.getScale());
		});
		assert.ok(careerRatio >= 1 && careerRatio <= 1.3, 'Career coach spacing must also remain consistent at close zoom');
	} finally {
		await manualPage.close();
	}
}

async function checkSatellite(configured, rejected = false, quality = 'high', coverage = 22) {
	const mapPage = await browser.newPage();
	const tileZooms = [];
	let sessions = 0;
	let weatherRequests = 0;
	try {
		await mapPage.addInitScript(configured => {
			window.__TRANSPORT_SIM_CONFIG__ = {
				googleMapsApiKey: configured ? 'mock-key-never-sent-to-google' : null,
				googleMapsKeyId: configured ? 'a'.repeat(64) : null
			};
		}, configured);
		await mapPage.addInitScript(quality => localStorage.setItem('mapQuality', quality), quality);
		await mapPage.addInitScript(() => Object.defineProperty(window.crypto, 'subtle', { value: undefined }));
		await mapPage.route('https://tile.googleapis.com/**', route => {
			if (route.request().url().includes('/createSession')) {
				sessions++;
				return route.fulfill(rejected
					? { status: 403, json: { error: { code: 403 } } }
					: { json: { session: 'mock-session', expiry: Math.floor(Date.now() / 1000) + 86400, tileWidth: route.request().postDataJSON().highDpi ? 512 : 256 } });
			}
			if (route.request().url().includes('/viewport')) return route.fulfill({
				json: { copyright: 'Mock imagery', maxZoomRects: [{ maxZoom: coverage, west: -180, east: 180, south: -90, north: 90 }] }
			});
			return route.fulfill({
				contentType: 'image/png',
				body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
			});
		});
		await mapPage.route('**/World_Imagery/MapServer/tilemap/**', route => {
			const zoom = Number(/tilemap\/(\d+)\//.exec(route.request().url())[1]);
			return route.fulfill({ json: { data: [zoom <= 18 ? 1 : 0] } });
		});
		mapPage.on('request', request => {
			if (new URL(request.url()).pathname === '/api/weather/current') weatherRequests++;
			const match = new URL(request.url()).pathname.match(/\/MapServer\/tile\/(\d+)\//);
			if (match) tileZooms.push(Number(match[1]));
		});
		await mapPage.goto(baseURL, { waitUntil: 'load' });
		await mapPage.evaluate(async () => {
			const { default: state } = await import('/js/modules/state.js');
			const { changeMapTheme } = await import('/js/modules/mapInit.js');
			changeMapTheme('satellite');
			state.map.getView().setZoom(22);
		});
		const expected = !configured ? 'GOOGLE_MAPS_API_KEY is not configured' : rejected ? 'HTTP 403' : 'Google satellite';
		await mapPage.waitForFunction(expected => {
			const text = document.querySelector('.satellite-status')?.textContent || '';
			return text.includes(expected) && !text.includes('Loading');
		}, expected);
		await mapPage.locator('#map').scrollIntoViewIfNeeded();
		await mapPage.waitForTimeout(500);
		const result = await mapPage.evaluate(async () => {
			const { default: state } = await import('/js/modules/state.js');
			return {
				google: !!state.baseMapLayer.getSource().getUrls()?.[0]?.includes('tile.googleapis.com'),
				theme: state.currentMapTheme,
				maxZoom: state.baseMapLayer.getSource().getTileGrid().getMaxZoom(),
				tilePixelRatio: state.baseMapLayer.getSource().getTilePixelRatio(1),
				banner: document.querySelector('.satellite-status').textContent
			};
		});
		assert.equal(result.google, configured && !rejected, 'Expected satellite provider');
		assert.equal(result.theme, 'satellite', 'Google must remain selected when unavailable');
		assert.equal(sessions, configured ? 1 : 0, 'No duplicate Google session requests');
		if (result.google) {
			assert.equal(result.maxZoom, Math.min(coverage, quality === 'high' ? 22 : quality === 'medium' ? 19 : 16), 'Native detail must honor quality and imagery coverage');
			assert.equal(result.tilePixelRatio, quality === 'high' ? 2 : 1, 'High quality must preserve high-DPI tile resolution');
		}
		if (!result.google) {
			assert.ok(result.banner.includes('Select Esri Satellite'), 'Show an explicit provider error, not a silent fallback');
			assert.equal(tileZooms.length, 0, 'Google must not automatically request Esri imagery');
			await mapPage.locator('#themeControlToggle').click();
			await mapPage.locator('#mapThemeSelect').selectOption('esri_satellite');
			await mapPage.waitForFunction(() => document.querySelector('.satellite-status').textContent.includes('detail: zoom 18'));
			await mapPage.waitForTimeout(500);
			assert.ok(tileZooms.includes(18) && tileZooms.every(zoom => zoom <= 18), 'Esri High must fetch available detail beyond zoom 16 without requesting missing tiles');
		}
		await mapPage.getByText('Unavailable', { exact: false }).first().waitFor({ state: 'attached' });
		assert.equal(weatherRequests, 0, 'Unconfigured live weather must not issue unavailable API calls');
		console.log('Satellite:', result.banner);
	} finally {
		await mapPage.close();
	}
}

async function checkDisplayPreferences(mobile) {
	const context = await browser.newContext(mobile ? devices['iPhone 13'] : {});
	const prefsPage = await context.newPage();
	try {
		await prefsPage.goto(baseURL, { waitUntil: 'load' });
		const initial = await prefsPage.evaluate(() => ({ quality: window.state.mapQuality, fps: window.state.targetFPS }));
		assert.deepEqual(initial, mobile ? { quality: 'low', fps: 30 } : { quality: 'high', fps: 60 }, 'Device-appropriate defaults');
		await prefsPage.evaluate(() => window.showSettingsDialog());
		await prefsPage.locator('#mapQualitySelect').selectOption(mobile ? 'high' : 'low');
		await prefsPage.locator('#targetFPSSelect').selectOption('120');
		await prefsPage.reload({ waitUntil: 'load' });
		assert.deepEqual(await prefsPage.evaluate(() => ({ quality: window.state.mapQuality, fps: window.state.targetFPS })),
			{ quality: mobile ? 'high' : 'low', fps: 120 }, 'Saved overrides must survive reload');
		console.log(mobile ? 'Mobile defaults: Low / 30 FPS; saved overrides passed' : 'Desktop defaults: High / 60 FPS; saved overrides passed');
	} finally {
		await context.close();
	}
}

async function checkFpsLimits(automatic = false) {
	const fpsPage = await browser.newPage();
	try {
		await fpsPage.goto(baseURL, { waitUntil: 'load' });
		const availableFPS = await fpsPage.evaluate(() => new Promise(resolve => {
			const start = performance.now();
			let frames = 0;
			function sample(timestamp) {
				frames++;
				if (timestamp - start >= 500) resolve(frames * 1000 / (timestamp - start));
				else requestAnimationFrame(sample);
			}
			requestAnimationFrame(sample);
		}));
		await fpsPage.evaluate(async automatic => {
			const { startManualSimulation } = await import('/js/modules/manualControls.js');
			const state = window.state;
			state.route = [
				{ latlng: { lat: 11.1271, lng: 78.6569 }, placeName: 'Start', type: 'stop' },
				{ latlng: { lat: 11.1271, lng: 80.6569 }, placeName: 'End', type: 'stop' }
			];
			document.getElementById('maxSpeedInput').value = '120';
			state.maxGForceLimit = 1;
			if (automatic) {
				const { animateMovement } = await import('/js/modules/autoAnimation.js');
				state.accelGForceLimit = 1;
				state.isTracking = true;
				animateMovement(state.route, 'train', 120, 3);
			} else {
				startManualSimulation(state.route, 'train', 120, 3);
				state.manualControlState.targetSpeed = 120;
				state.manualControlState.acceleration = 100;
			}
		}, automatic);
		await fpsPage.waitForFunction(automatic => (automatic ? window.state.currentDisplaySpeed : window.state.manualControlState.currentSpeed) >= 119, automatic);
		await fpsPage.evaluate(() => {
			window.__simulationUpdates = 0;
			window.__mapRenders = 0;
			window.state.movingFeature.getGeometry().on('change', () => window.__simulationUpdates++);
			window.state.map.on('postrender', () => window.__mapRenders++);
		});
		for (const fps of [30, 60, 120]) {
			const start = await fpsPage.evaluate(fps => {
				window.setTargetFPS(fps);
				window.__simulationUpdates = 0;
				window.__mapRenders = 0;
				return performance.now();
			}, fps);
			await fpsPage.waitForTimeout(2000);
			const result = await fpsPage.evaluate(start => ({ count: window.__simulationUpdates, renders: window.__mapRenders, seconds: (performance.now() - start) / 1000 }), start);
			assert.ok(result.count > 5 && result.count <= fps * result.seconds + 2, `FPS limit ${fps} must cap simulation updates`);
			assert.ok(result.renders > 5 && result.renders <= fps * result.seconds + 4, 'Map rendering must follow the requested cap');
			assert.ok(result.renders / result.seconds >= Math.min(fps, availableFPS) * 0.9, 'Animation should achieve at least 90% of the selected rate within the available browser refresh rate');
			console.log(`${automatic ? 'Automatic' : 'Manual'} FPS limit ${fps}: ${(result.count / result.seconds).toFixed(1)} simulation updates/s; ${(result.renders / result.seconds).toFixed(1)} map renders/s`);
		}
	} finally {
		await fpsPage.close();
	}
}

async function checkCockpit(mobile) {
	const context = await browser.newContext(mobile ? devices['iPhone 13'] : { viewport: { width: 1440, height: 1000 } });
	const cockpitPage = await context.newPage();
	try {
		await cockpitPage.goto(baseURL, { waitUntil: 'load' });
		assert.equal(await cockpitPage.locator('#speedometerModeSelect').inputValue(), 'combined');
		await cockpitPage.evaluate(async () => {
			const { initCareerMode, updateEconomyHUD } = await import('/js/modules/careerMode.js');
			initCareerMode(3);
			document.getElementById('economyPanel').style.display = 'block';
			updateEconomyHUD();
		});
		for (const mode of ['analog', 'combined', 'digital']) {
			await cockpitPage.evaluate(mode => window.setSpeedometerMode(mode), mode);
			await cockpitPage.evaluate(async () => {
				document.getElementById('maxSpeedInput').value = '200';
				const { updateSpeedometer } = await import('/js/modules/speedometer.js');
				updateSpeedometer(100);
			});
			if (mode !== 'digital') {
				assert.equal(await cockpitPage.locator('#speedometerNeedle').getAttribute('transform'), 'rotate(0.00 100 100)', 'Half-scale speed must point the dial needle upward');
				assert.match(await cockpitPage.locator('#analogSpeedometer').getAttribute('aria-label'), /100 km\/h; scale 0 to 200 km\/h/);
			}
			const layout = await cockpitPage.evaluate(() => {
				const map = document.getElementById('map').getBoundingClientRect();
				const panels = [...document.querySelectorAll('.hud-panel')].filter(panel => panel.offsetWidth && panel.offsetHeight);
				return panels.map(panel => {
					const rect = panel.getBoundingClientRect();
					return { name: panel.className, inside: rect.left >= map.left - 1 && rect.top >= map.top - 1 && rect.right <= map.right + 1 && rect.bottom <= map.bottom + 1 };
				});
			});
			assert.ok(layout.every(panel => panel.inside), `All ${mode} HUD panels must stay within the ${mobile ? 'mobile' : 'desktop'} map: ${JSON.stringify(layout)}`);
			const stack = await cockpitPage.evaluate(() => {
				const rect = selector => document.querySelector(selector).getBoundingClientRect();
				const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
				const speed = rect('.speed-panel'), force = rect('.gforce-panel'), weather = rect('.weather-panel');
				const digital = document.getElementById('dialDigitalSpeed');
				const dial = rect('#analogSpeedometer');
				const digitalRect = digital.getBoundingClientRect();
				return {
					speedBelowWeather: speed.top >= weather.bottom,
					separated: !overlaps(speed, force) && !overlaps(speed, weather) && !overlaps(force, weather),
					inDial: getComputedStyle(digital.parentNode).display !== 'none'
						? digital.textContent === document.getElementById('liveSpeed').textContent
							&& digitalRect.top >= dial.top && digitalRect.bottom <= dial.bottom && digitalRect.width > 0
						: null
				};
			});
			assert.ok(stack.speedBelowWeather && stack.separated, `Speedometer must sit below the weather card without overlapping instruments (${mode}): ${JSON.stringify(stack)}`);
			assert.equal(stack.inDial, mode === 'combined' ? true : null, `Digital readout must render inside the dial only in combined mode (${mode})`);
		}
		await cockpitPage.evaluate(() => window.setSpeedometerMode('combined'));
		await cockpitPage.evaluate(async () => {
			window.setUnitSystem(true);
			const { updateSpeedometer } = await import('/js/modules/speedometer.js');
			updateSpeedometer(100);
		});
		assert.equal(await cockpitPage.locator('#liveSpeed').textContent(), '62', 'Imperial digital speed must match the analog units');
		assert.equal(await cockpitPage.locator('#analogSpeedUnit').textContent(), 'mph');
		await cockpitPage.evaluate(async () => {
			document.getElementById('maxSpeedInput').value = '1500';
			window.setUnitSystem(false);
			const { updateSpeedometer } = await import('/js/modules/speedometer.js');
			updateSpeedometer(1000);
		});
		assert.equal(await cockpitPage.locator('#speedometerNeedle').getAttribute('transform'), 'rotate(0.00 100 100)', 'The dial must scale correctly for high-speed vehicles');
		assert.match(await cockpitPage.locator('#analogSpeedometer').getAttribute('aria-label'), /1000 km\/h; scale 0 to 2000 km\/h/);
		await cockpitPage.waitForTimeout(1600);
		await cockpitPage.evaluate(async () => {
			const { updateSpeedometer } = await import('/js/modules/speedometer.js');
			updateSpeedometer(0);
		});
		assert.match(await cockpitPage.locator('#analogSpeedometer').getAttribute('aria-label'), /scale 0 to 40 km\/h/, 'The dial range must shrink back after slowing down');
		await cockpitPage.evaluate(() => {
			localStorage.setItem('hudElementPositions', JSON.stringify({
				'speed-panel': { anchorX: 'right', anchorY: 'top', xPx: 10, yPx: 10, widthPx: 120, heightPx: 65 },
				'gforce-panel': { anchorX: 'right', anchorY: 'top', xPx: 10, yPx: 80, widthPx: 120, heightPx: 100 }
			}));
			window.setSpeedometerMode('analog');
		});
		const legacyFits = await cockpitPage.evaluate(() => {
			const speed = document.querySelector('.speed-panel').getBoundingClientRect();
			const force = document.querySelector('.gforce-panel').getBoundingClientRect();
			const dial = document.querySelector('#analogSpeedometer').getBoundingClientRect();
			return dial.height >= 96 && Math.abs(speed.width - speed.height) < 1
				&& (force.top >= speed.bottom || force.bottom <= speed.top);
		});
		assert.ok(legacyFits, 'Legacy panel sizes must not distort the round analog dial or overlap the G-force panel');
		await cockpitPage.evaluate(() => {
			window.resetHUDPositions();
			window.setSpeedometerMode('combined');
		});
		await cockpitPage.reload({ waitUntil: 'load' });
		assert.equal(await cockpitPage.locator('#speedometerModeSelect').inputValue(), 'combined', 'Speedometer selection must persist');
		const contentFits = await cockpitPage.evaluate(() => ['#nextStopTime', '#nextStopDistance', '#journeyProgress', '#renderFps'].every(id => {
			const element = document.querySelector(id);
			const rect = element.getBoundingClientRect();
			const panel = element.closest('.hud-panel').getBoundingClientRect();
			return rect.bottom <= panel.bottom && rect.right <= panel.right;
		}));
		assert.ok(contentFits, 'ETA and telemetry values must not be clipped inside their panels');
		await cockpitPage.locator('#themeControlToggle').click();
		assert.equal(await cockpitPage.locator('#themeControlToggle').getAttribute('aria-expanded'), 'true');
		await cockpitPage.evaluate(() => window.switchMainTheme('desert'));
		assert.ok(await cockpitPage.locator('body').evaluate(element => element.classList.contains('cockpit')), 'Changing themes must preserve cockpit styling');
		await cockpitPage.getByRole('button', { name: 'Close themes', exact: true }).click();
		assert.ok(await cockpitPage.locator('#themeControlPanel').evaluate(element => element.inert), 'Closed theme drawer must not capture keyboard focus');
		await cockpitPage.locator('#perfToggleBtn').click();
		assert.equal(await cockpitPage.locator('#fpsCounter').textContent(), '—', 'Idle metrics must not report browser callback frequency as rendered FPS');
		await cockpitPage.locator('#performanceMetrics button').click();
		assert.equal(await cockpitPage.locator('#performanceMetrics').evaluate(element => element.style.display), 'none', 'Metrics close button must use the cleanup path');
		for (const [show, selector] of [['showSettingsDialog', '#settingsDialog'], ['showSimulateDialog', '#simulateDialog'], ['showWeatherDialog', '#weatherDialog'], ['showHUDCustomizeDialog', '#hudCustomizeDialog'], ['showManualControlPanel', '#manualControlPanel']]) {
			await cockpitPage.evaluate(async show => {
				if (show === 'showManualControlPanel') {
					const { showManualControlPanel } = await import('/js/modules/manualControls.js');
					showManualControlPanel();
				} else {
					window[show]();
				}
			}, show);
			await cockpitPage.waitForTimeout(350);
			const inside = await cockpitPage.locator(selector).evaluate(element => {
				const rect = element.getBoundingClientRect();
				return rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1;
			});
			assert.ok(inside, `${selector} must stay inside the viewport`);
			await cockpitPage.locator(selector).evaluate(element => { element.style.display = 'none'; });
		}
		console.log(`${mobile ? 'Mobile' : 'Desktop'} cockpit bounds, dial/units, settings and dialogs passed`);
	} finally {
		await context.close();
	}
}

try {
	await page.addInitScript(slowFrames);
	await page.goto(baseURL, { waitUntil: 'load' });
	await page.evaluate(performanceMode => window.setPerformanceMode(performanceMode), performanceMode);
	await page.evaluate(async () => {
		const { default: state } = await import('/js/modules/state.js');
		const { initializeTrainCoaches } = await import('/js/modules/vehicle.js');
		state.map.getView().setZoom(22);
		initializeTrainCoaches('train', ol.proj.fromLonLat([78.6569, 11.1271]), 90, 3);
	});
	await page.waitForTimeout(1000);
	const spacing = await page.evaluate(async () => {
		const { default: state } = await import('/js/modules/state.js');
		const { initializeTrainCoaches, updateTrainCoaches, updateTrainCouplings } = await import('/js/modules/vehicle.js');
		const results = [];
		for (const zoom of [16, 19, 22]) {
			state.map.getView().setZoom(zoom);
			initializeTrainCoaches('train', ol.proj.fromLonLat([78.6569, 11.1271]), 90, 3);
			const [loco, coach] = state.trainCoaches;
			const image = loco.getStyle().getImage();
			const size = image.getSize();
			const lengthPx = size[0] * image.getScale();
			const a = loco.getGeometry().getCoordinates();
			const b = coach.getGeometry().getCoordinates();
			results.push({ zoom, ratio: Math.hypot(a[0] - b[0], a[1] - b[1]) / state.map.getView().getResolution() / lengthPx });
		}
		updateTrainCouplings();
		const original = [...state.trainCouplings];
		const coords = state.trainCoaches[0].getGeometry().getCoordinates();
		window._forceCoachSnapFrames = 0;
		for (let i = 0; i < 100; i++) updateTrainCoaches('train', [coords[0] + i * 20, coords[1]], 90);
		const [loco, coach] = state.trainCoaches;
		const a = loco.getGeometry().getCoordinates(), b = coach.getGeometry().getCoordinates();
		const image = loco.getStyle().getImage();
		const movingRatio = Math.hypot(a[0] - b[0], a[1] - b[1]) / state.map.getView().getResolution() / (image.getSize()[0] * image.getScale());
		return { zooms: results, movingRatio, couplingsReused: original.every((feature, i) => feature === state.trainCouplings[i]) };
	});
	console.log('Coach spacing:', JSON.stringify(spacing));
	const hudMutations = await page.evaluate(async () => {
		const { updateStats } = await import('/js/modules/hud.js');
		const args = [120, 100, 3600, 7200, 0.1, 'A long station name that should not restart its marquee'];
		updateStats(...args);
		const observer = new MutationObserver(() => {});
		observer.observe(document.getElementById('liveSpeed'), { childList: true });
		observer.observe(document.getElementById('nextstop'), { childList: true, subtree: true });
		updateStats(...args);
		const count = observer.takeRecords().length;
		observer.disconnect();
		return count;
	});
	const etaResult = await page.evaluate(async () => {
		const { updateStats, updateRouteInfo } = await import('/js/modules/hud.js');
		const state = window.state;
		const previous = { route: state.route, index: state.index, progress: state.progress, speed: state.manualControlState.currentSpeed };
		state.route = [
			{ latlng: { lat: 11.1271, lng: 78.6569 }, placeName: 'Start', type: 'stop' },
			{ latlng: { lat: 11.1271, lng: 78.6769 }, placeName: 'End', type: 'stop' }
		];
		state.index = 0;
		state.progress = 0;
		state.manualControlState.currentSpeed = 43;
		updateRouteInfo();
		const eta = document.getElementById('nextStopTime');
		const observer = new MutationObserver(() => {});
		observer.observe(eta, { childList: true });
		for (let i = 0; i < 120; i++) {
			updateStats(43, 2.2, 117, 117, 0.07, 'End');
			updateRouteInfo();
		}
		const count = observer.takeRecords().length;
		observer.disconnect();
		updateStats(0, 0, 0, 0, 0.07, 'End');
		const arrival = eta.textContent;
		Object.assign(state, { route: previous.route, index: previous.index, progress: previous.progress });
		state.manualControlState.currentSpeed = previous.speed;
		return { count, arrival };
	});
	assert.equal(etaResult.count, 0, 'Stats and route updates must not overwrite an unchanged ETA with competing values or formats');
	assert.equal(etaResult.arrival, 'At End', 'Arrival must replace the moving ETA');

	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Performance.enable');
	await page.evaluate(async () => {
		const { default: state } = await import('/js/modules/state.js');
		const { animateMovement } = await import('/js/modules/autoAnimation.js');
		state.route = [
			{ latlng: { lat: 11.1271, lng: 78.6569 }, placeName: 'Start', type: 'stop' },
			{ latlng: { lat: 11.1271, lng: 80.6569 }, placeName: 'End', type: 'stop' }
		];
		state.map.getView().setZoom(19);
		state.maxGForceLimit = 0.5;
		state.accelGForceLimit = 0.5;
		state.isTracking = true;
		animateMovement(state.route, 'train', 120, 3);
	});
	await page.waitForTimeout(15000);
	const before = await cdp.send('Performance.getMetrics');
	await cdp.send('Profiler.enable');
	await cdp.send('Profiler.start');
	await page.evaluate(() => {
		window.__motionSamples = [];
		window.__motionTimer = setInterval(() => {
			const state = window.state;
			window.__motionSamples.push({
				t: performance.now(), speed: state.currentDisplaySpeed,
				distance: state.totalDistanceCovered, position: [...state.newCoords]
			});
		}, 50);
	});
	await page.waitForTimeout(5000);
	const { profile } = await cdp.send('Profiler.stop');
	const sampleCounts = new Map();
	const nodes = new Map(profile.nodes.map(node => [node.id, node]));
	for (const sample of profile.samples || []) {
		const frame = nodes.get(sample).callFrame;
		const name = `${frame.functionName || '(anonymous)'} ${frame.url ? new URL(frame.url).pathname : ''}`;
		sampleCounts.set(name, (sampleCounts.get(name) || 0) + 1);
	}
	console.log('CPU sample hotspots:', JSON.stringify([...sampleCounts].sort((a, b) => b[1] - a[1]).slice(0, 10)));
	const after = await cdp.send('Performance.getMetrics');
	const motion = await page.evaluate(() => {
		clearInterval(window.__motionTimer);
		const samples = window.__motionSamples;
		let expectedKm = 0;
		for (let i = 1; i < samples.length; i++) {
			expectedKm += (samples[i].speed + samples[i - 1].speed) / 2 * (samples[i].t - samples[i - 1].t) / 3600000;
		}
		const first = samples[0], last = samples.at(-1);
		const visualKm = ol.sphere.getDistance(ol.proj.toLonLat(first.position), ol.proj.toLonLat(last.position)) / 1000;
		return { expectedKm, coveredKm: last.distance - first.distance, visualKm, ratio: visualKm / expectedKm, hudSpeed: Number(document.getElementById('liveSpeed').textContent), stateSpeed: window.state.currentDisplaySpeed };
	});
	const metric = (metrics, name) => metrics.metrics.find(item => item.name === name)?.value || 0;
	const taskSeconds = metric(after, 'TaskDuration') - metric(before, 'TaskDuration');
	console.log('15 FPS motion:', JSON.stringify(motion));
	console.log('Main-thread task seconds over 5 seconds:', taskSeconds.toFixed(3));
	if (!baseline) {
		// Center spacing / icon width: the visible body is 1481/1543 of the icon plus a ~4.5% coupler gap.
		for (const result of spacing.zooms) assert.ok(result.ratio >= 0.98 && result.ratio <= 1.04, `Coach gap at zoom ${result.zoom}: ${result.ratio}`);
		assert.ok(spacing.couplingsReused, 'Coupling features should not be recreated every frame');
		assert.ok(spacing.movingRatio >= 0.95 && spacing.movingRatio <= 1.04, `Coach spacing must not grow with speed: ${spacing.movingRatio}`);
		assert.equal(hudMutations, 0, 'Unchanged HUD values must not restart the marquee or rewrite speed');
		assert.ok(Math.abs(motion.ratio - 1) < 0.08, `Visual movement / HUD speed: ${motion.ratio}`);
		assert.ok(Math.abs(motion.hudSpeed - motion.stateSpeed) < 2, 'HUD speed should match simulation speed');
		assert.deepEqual(errors, [], 'No browser runtime errors');
		await page.close();
		await checkManualMotion();
		await checkFpsLimits();
		await checkFpsLimits(true);
		await checkDisplayPreferences(false);
		await checkDisplayPreferences(true);
		await checkCockpit(false);
		await checkCockpit(true);
		await checkSatellite(false);
		await checkSatellite(true);
		await checkSatellite(true, true);
		await checkSatellite(true, false, 'low');
		await checkSatellite(true, false, 'high', 17);
	}
} finally {
	await browser.close();
}
