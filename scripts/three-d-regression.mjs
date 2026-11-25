import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const baseURL = process.env.WORLD_TEST_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({
	channel: 'msedge',
	headless: true,
	args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader']
});

async function exercise(viewport) {
	const page = await browser.newPage({ viewport, deviceScaleFactor: viewport.width === 390 ? 2 : 1 });
	const errors = [];
	const requests = [];
	page.on('pageerror', error => errors.push(error.message));
	page.on('dialog', async dialog => { errors.push(dialog.message()); await dialog.dismiss(); });
	page.on('request', request => requests.push(request.url()));
	await page.route('**/api/interpreter', route => route.fulfill({ json: { elements: [] } }));
	await page.route('https://server.arcgisonline.com/**/tile/**', route => route.fulfill({
		contentType: 'image/png',
		body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
	}));
	await page.addInitScript(() => localStorage.setItem('voiceAnnouncements', 'false'));
	try {
		await page.goto(baseURL, { waitUntil: 'load' });
		await page.evaluate(async () => {
			const state = window.state;
			state.route = [0, 0.02, 0.04].map((offset, i) => ({
				latlng: { lat: 11, lng: 78 + offset },
				placeName: 'ABC'[i], type: i === 1 ? 'waypoint' : 'stop'
			}));
			state.currentRouteType = 'rail';
			const manual = await import('/js/modules/manualControls.js');
			manual.showManualControlPanel();
			manual.showDoorControls();
			manual.startManualSimulation(state.route, 'train', 120, 3);
			(await import('/js/modules/passengerTraffic.js')).startPassengerTraffic(state.route, 90);
		});
		await page.locator('#toggle3DBtn').click();
		await page.waitForFunction(() => window.state.is3DMode && window.state.world3D?.getStats().frames > 3, null, { timeout: 60000 });
		await page.waitForFunction(() => window.state.world3D.getStats().satelliteTiles > 0, null, { timeout: 15000 });
		assert.equal(await page.evaluate(() => window.state.world3D.getStats().satelliteTiles), 9);
		assert.ok(await page.locator('#world3dContainer canvas').isVisible());
		assert.ok(await page.locator('#hudContainer').isVisible());
		assert.ok(await page.locator('#manualControlPanel').isVisible());
		assert.match(await page.locator('#world3dStatus').textContent(), /route geography|satellite ground|mapped features/i);
		assert.match(await page.locator('#world3dStatus').getAttribute('title'), /loads automatically|features are used/i);
		assert.equal(await page.evaluate(() => window.state.world3D.getStats().stationCount), 2);
		const stationStats = await page.evaluate(() => window.state.world3D.getStats());
		assert.ok(stationStats.visibleStationCount > 0);
		assert.ok(stationStats.stationMeshCount <= stationStats.visibleStationCount * 7,
			'station structures are batched into at most seven meshes per platform');
		assert.ok(stationStats.drawCalls < 180, '3D draw calls stay within the scene budget');
		assert.ok(stationStats.triangles < 500000, '3D triangle count stays within the scene budget');
		assert.ok(stationStats.dynamicLights <= 2, '3D tunnel lighting uses at most two dynamic lights');
		assert.ok(Number.isFinite(stationStats.frameTime) && stationStats.frameTime < 250,
			'3D frame-time telemetry remains responsive');
		assert.equal(await page.evaluate(() => window.state.world3D.getStats().portalCount), 2);
		assert.ok(await page.evaluate(() => window.state.world3D.getStats().groundOpenings) > 0, 'portal ramps open through the ground');
		assert.equal(await page.evaluate(() => window.state.world3D.getStats().underground), true);
		assert.equal(await page.evaluate(() => window.state.world3D.getStats().trackHeight), -28);
		assert.ok((await page.evaluate(() => window.state.world3D.getStats().train.meshCount)) < 180);
		await page.evaluate(() => { window.state.performanceModeEnabled = false; window.state.targetFPS = 120; });
		assert.equal(await page.evaluate(() => window.state.world3D.getStats().targetFPS), 120);
		if (viewport.width === 390) {
			await page.waitForFunction(() => window.state.world3D.getStats().pixelRatio === 1.5);
		}
		await page.evaluate(() => { window.state.performanceModeEnabled = true; });
		assert.equal(await page.evaluate(() => window.state.world3D.getStats().targetFPS), 30);
		await page.waitForFunction(() => window.state.world3D.getStats().pixelRatio <= 1);
		await page.evaluate(() => { window.state.performanceModeEnabled = false; window.state.targetFPS = 60; });
		assert.equal(await page.evaluate(() => window.state.world3D.getStats().tunnelShadows), false,
			'tunnel lighting avoids six-pass point-light shadows');
		const initialLights = await page.evaluate(() => window.state.world3D.getStats().tunnelLights);
		assert.ok(initialLights.length <= 3, 'tunnel lighting uses a bounded local light budget');
		assert.ok(initialLights.some(light => light.distance === 0 && light.intensity > 0), 'station light is on while stopped');
		const oldFrame = await page.evaluate(() => {
			window.state.progress = 0.05;
			return window.state.world3D.getStats().frames;
		});
		await page.waitForFunction(frame => window.state.world3D.getStats().frames > frame + 1, oldFrame);
		const movingLights = await page.evaluate(() => window.state.world3D.getStats().tunnelLights);
		for (const light of initialLights.filter(light => movingLights.some(next => next.distance === light.distance))) {
			assert.deepEqual(movingLights.find(next => next.distance === light.distance), light, 'fixed lights retain their position and intensity');
		}
		await page.evaluate(() => { window.state.progress = 0; });
		assert.equal(await page.evaluate(() => window.state.map.getTarget()), null, '2D rendering is suspended');
		await page.waitForFunction(() => document.getElementById('world3dStatus').hidden && document.getElementById('world3dWeather').hidden, null, { timeout: 15000 });
		const controls = await page.locator('#world3dControls').boundingBox();
		const map = await page.locator('#map').boundingBox();
		assert.ok(controls.x >= map.x && controls.y >= map.y && controls.x + controls.width <= map.x + map.width &&
			controls.y + controls.height <= map.y + map.height, '3D controls remain inside the map');
		if (viewport.width <= 768) await page.locator('#world3dMobileCameraSelect').selectOption('cab');
		else await page.locator('#world3dCab').click();
		assert.equal(await page.locator('#world3dCab').getAttribute('aria-pressed'), 'true');
		assert.equal(await page.locator('#world3dZoomIn').isDisabled(), false);
		await page.waitForFunction(() => document.body.classList.contains('world3d-cab-manual'));
		await page.waitForFunction(() => {
			const canvas = document.querySelector('#world3dContainer canvas');
			return Math.abs(canvas.width / canvas.height - canvas.clientWidth / canvas.clientHeight) < 0.02;
		});
		await page.waitForFunction(() => !document.body.classList.contains('world3d-ui-active'), null, { timeout: 8000 });
		await page.waitForFunction(() =>
			Number(getComputedStyle(document.querySelector('.world3d-camera-buttons')).opacity) < 0.05);
		assert.ok(await page.locator('.world3d-camera-buttons').evaluate(element =>
			Number(getComputedStyle(element).opacity) < 0.05), 'cab chrome auto-hides from the windshield');
		const worldCanvasBounds = await page.locator('#world3dContainer').boundingBox();
		await page.mouse.move(worldCanvasBounds.x + worldCanvasBounds.width / 2, worldCanvasBounds.y + 8);
		await page.waitForFunction(() => document.body.classList.contains('world3d-ui-active'));
		assert.ok(!(await page.locator('#manualControlPanel').isVisible()), 'cab does not obscure the view with an overlay');
		if (viewport.width <= 768) {
			assert.ok(await page.locator('#world3dMobileDrive').isVisible(), 'mobile cab uses the simplified touch dock');
			assert.ok(await page.locator('#world3dMobileHud').isVisible(), 'mobile cab shows a compact unobstructive HUD');
			await page.locator('#world3dMobileHudToggle').click();
			assert.equal(await page.locator('#world3dMobileHud').isVisible(), false);
			await page.locator('#world3dMobileHudToggle').click();
			assert.equal(await page.locator('#world3dMobileHud').isVisible(), true);
			await page.locator('#world3dMobileLimitUp').click();
			assert.equal(await page.evaluate(() => window.state.manualControlState.targetSpeed), 10);
			await page.locator('[data-drive-mode="power"]').click();
			assert.equal(await page.evaluate(() => window.state.manualControlState.acceleration), 55);
			await page.locator('[data-drive-mode="brake"]').click();
			assert.equal(await page.evaluate(() => window.state.manualControlState.brakeLevel), 100);
			await page.locator('[data-drive-mode="coast"]').click();
			assert.equal(await page.evaluate(() => window.state.manualControlState.brakeLevel), 0);
			await page.locator('#world3dMobileWiper').click();
			assert.equal(await page.evaluate(() => window.state.world3D.getStats().wipers), true);
			await page.locator('#world3dMobileWiper').click();
			await page.locator('#world3dMobileDoors').click();
			assert.equal(await page.evaluate(() => window.state.manualControlState.doorsOpen), true);
			await page.locator('#world3dMobileDoors').click();
			await page.locator('#world3dMobileAutopilot').click();
			assert.equal(await page.evaluate(() => window.state.manualControlState.autopilotActive), true);
			await page.locator('#world3dMobileAutopilot').click();
			const initialFov = await page.evaluate(() => window.state.world3D.getStats().cameraFov);
			await page.locator('#world3dMobileZoomIn').click();
			assert.ok(await page.evaluate(value => window.state.world3D.getStats().cameraFov < value, initialFov));
			await page.locator('#world3dMobileZoomOut').click();
		} else {
			const deskCanvas = await page.locator('#world3dContainer canvas').boundingBox();
			const aspect = deskCanvas.width / deskCanvas.height;
			const scale = Math.min(1, aspect * 0.55);
			const field = Math.tan(57 * Math.PI / 360);
			const deskPoint = (x, y) => ({
				x: deskCanvas.x + deskCanvas.width * (1 + x * scale / (1.31 * field * aspect)) / 2,
				y: deskCanvas.y + deskCanvas.height * (1 - y / (1.31 * field)) / 2
			});
			const limit = deskPoint(-0.39, -0.57);
			await page.mouse.move(limit.x, limit.y);
			await page.mouse.wheel(0, -100);
			assert.equal(await page.evaluate(() => window.state.manualControlState.targetSpeed), 5, 'physical speed roller responds');
			const wiper = deskPoint(0.18, -0.56);
			await page.mouse.click(wiper.x, wiper.y);
			assert.equal(await page.evaluate(() => window.state.world3D.getStats().wipers), true, 'physical wiper button responds');
			await page.mouse.click(wiper.x, wiper.y);
			assert.equal(await page.evaluate(() => window.state.world3D.getStats().wipers), false);
			const doors = deskPoint(0.45, -0.56);
			await page.mouse.click(doors.x, doors.y);
			assert.equal(await page.evaluate(() => window.state.manualControlState.doorsOpen), true, 'physical door button responds');
			assert.ok(await page.evaluate(() => window.state.world3D.getStats().passengerAnimations) > 0,
				'opening doors at a station starts a 3D passenger flow');
			await page.mouse.click(doors.x, doors.y);
			assert.equal(await page.evaluate(() => window.state.manualControlState.doorsOpen), false);
			const horn = deskPoint(0.72, -0.56);
			await page.mouse.click(horn.x, horn.y);
			const autopilot = deskPoint(0.99, -0.56);
			await page.mouse.click(autopilot.x, autopilot.y);
			assert.equal(await page.evaluate(() => window.state.manualControlState.autopilotActive), true, 'physical autopilot button enables automatic control');
			await page.mouse.click(autopilot.x, autopilot.y);
			assert.equal(await page.evaluate(() => window.state.manualControlState.autopilotActive), false, 'physical autopilot button returns control');
			await page.mouse.move(worldCanvasBounds.x + worldCanvasBounds.width / 2, worldCanvasBounds.y + 8);
			await page.waitForFunction(() => document.body.classList.contains('world3d-ui-active'));
			await page.locator('#world3dScreens').click();
			assert.equal(await page.evaluate(() => window.state.world3D.getStats().cabDisplays), false);
			await page.locator('#world3dScreens').click();
			assert.equal(await page.evaluate(() => window.state.world3D.getStats().cabDisplays), true);
			await page.locator('#world3dAssist').click();
			assert.ok(await page.locator('#compactPower').isVisible(), 'accessible cab controls are available');
			await page.locator('#compactSpeed').fill('40');
			assert.equal(await page.evaluate(() => window.state.manualControlState.targetSpeed), 40);
			await page.locator('#compactBrake').fill('25');
			assert.equal(await page.evaluate(() => window.state.manualControlState.brakeLevel), 25);
			await page.locator('#compactBrake').fill('0');
			await page.locator('#compactWiper').click();
			assert.equal(await page.evaluate(() => window.state.world3D.getStats().wipers), true);
			assert.equal(await page.locator('#compactWiper').getAttribute('aria-pressed'), 'true');
			await page.locator('#compactDoors').click();
			assert.equal(await page.evaluate(() => window.state.manualControlState.doorsOpen), true);
			await page.locator('#compactDoors').click();
			assert.equal(await page.evaluate(() => window.state.manualControlState.doorsOpen), false);
			await page.mouse.move(worldCanvasBounds.x + worldCanvasBounds.width / 2, worldCanvasBounds.y + 8);
			await page.waitForFunction(() => document.body.classList.contains('world3d-ui-active'));
			await page.locator('#world3dAssist').click();
			const initialFov = await page.evaluate(() => window.state.world3D.getStats().cameraFov);
			await page.locator('#world3dZoomIn').click();
			assert.ok(await page.evaluate(value => window.state.world3D.getStats().cameraFov < value, initialFov));
			await page.locator('#world3dZoomOut').click();
		}
		await page.evaluate(() => {
			window.state.weatherCardState.currentWeatherData = { condition: 'Rain' };
		});
		await page.waitForFunction(() => window.state.world3D.getStats().weather === 'Rain', null, { timeout: 15000 });
		assert.match(await page.locator('#world3dWeather').textContent(), /Rain/);
		await page.evaluate(() => { window.state.progress = 0.75; });
		await page.waitForFunction(() => window.state.world3D.getStats().precipitation, null, { timeout: 15000 });
		await page.evaluate(() => { window.state.progress = 0; });
		await page.mouse.move(worldCanvasBounds.x + worldCanvasBounds.width / 2, worldCanvasBounds.y + 8);
		await page.waitForFunction(() => document.body.classList.contains('world3d-ui-active'));
		if (viewport.width <= 768) await page.locator('#world3dMobileCameraSelect').selectOption('free');
		else await page.locator('#world3dFree').click();
		assert.equal(await page.locator('#world3dFree').getAttribute('aria-pressed'), 'true');
		const canvas = page.locator('#world3dContainer canvas');
		const canvasBounds = await canvas.boundingBox();
		await page.mouse.move(canvasBounds.x + canvasBounds.width / 2, canvasBounds.y + canvasBounds.height / 2);
		await page.mouse.down();
		await page.mouse.move(canvasBounds.x + canvasBounds.width / 2 + 40, canvasBounds.y + canvasBounds.height / 2 + 10);
		await page.mouse.up();
		if (viewport.width <= 768) await page.locator('#world3dMobileCameraSelect').selectOption('chase');
		else await page.locator('#world3dChase').click();
		for (const camera of ['front', 'side', 'roof']) {
			if (viewport.width <= 768) {
				await page.locator('#world3dMobileCameraSelect').selectOption(camera);
			} else {
				await page.locator(`#world3d${camera[0].toUpperCase()}${camera.slice(1)}`).click();
			}
			await page.waitForTimeout(100);
			const fov = await page.evaluate(() => window.state.world3D.getStats().cameraFov);
			assert.ok(Number.isFinite(fov), `${camera} camera provides a valid projection`);
		}
		if (viewport.width <= 768) await page.locator('#world3dMobileCameraSelect').selectOption('chase');
		else await page.locator('#world3dChase').click();
		if (viewport.width > 768) {
			const lengths = await page.evaluate(async () => {
				const { createWorldRoute } = await import('/js/modules/three-d/worldRoute.js');
				const world = createWorldRoute(window.state.route, null, true);
				return [world.boundaries[1], world.path.length - world.boundaries[1]];
			});
			for (const camera of ['#world3dChase', '#world3dCab']) {
				await page.locator(camera).click();
				for (const entering of [false, true]) {
					let previous;
					for (let metres = 800; metres <= 1200; metres += 50) {
						const before = await page.evaluate(({ entering, metres, lengths }) => {
							const state = window.state;
							state.index = entering ? 1 : 0;
							state.progress = entering ? 1 - metres / lengths[1] : metres / lengths[0];
							return state.world3D.getStats().frames;
						}, { entering, metres: entering ? 2000 - metres : metres, lengths });
						await page.waitForFunction(frame => window.state.world3D.getStats().frames > frame, before);
						const stats = await page.evaluate(() => window.state.world3D.getStats());
						assert.ok(Number.isFinite(stats.trackHeight) && Number.isFinite(stats.cameraHeight));
						if (previous) {
							assert.ok(Math.abs(stats.trackHeight - previous.trackHeight) < 3, 'track altitude changes gradually');
							const allowedAltitudeStep = camera.includes('Chase') ? 8 : 5;
							assert.ok(Math.abs(stats.cameraHeight - previous.cameraHeight) < allowedAltitudeStep,
								`${camera} altitude jumps at ${metres}m (${previous.cameraHeight} to ${stats.cameraHeight})`);
						}
						previous = stats;
					}
				}
			}
			await page.evaluate(() => { window.state.index = 0; window.state.progress = 0; });
			await page.mouse.move(worldCanvasBounds.x + worldCanvasBounds.width / 2, worldCanvasBounds.y + 8);
			await page.waitForFunction(() => document.body.classList.contains('world3d-ui-active'));
			await page.locator('#world3dChase').click();
		}
		const data = {
			type: 'FeatureCollection', features: [{
				type: 'Feature', properties: { building: 'yes', height: '9' },
				geometry: { type: 'Polygon', coordinates: [[
					[78.001, 11.0004], [78.0012, 11.0004], [78.0012, 11.0006],
					[78.001, 11.0006], [78.001, 11.0004]
				]] }
			}]
		};
		await page.locator('#world3dDataFile').setInputFiles({
			name: 'scenery.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify(data))
		});
		await page.waitForFunction(() => window.state.world3D.getStats().mappedFeatures > 0);
		assert.match(await page.locator('#world3dStatus').textContent(), /mapped features/i);
		assert.ok(await page.locator('#world3dAttribution').isVisible());
		await page.waitForFunction(() => /^\d+$/.test(document.getElementById('renderFps').textContent));
		assert.match(await page.locator('#renderFps').evaluate(el => el.parentElement.title), /3D frames/);
		await page.locator('.speed-btn').last().click();
		await page.locator('#accelerationSlider').fill('20');
		const initial = await page.evaluate(() => window.state.world3D.getStats().distance);
		try {
			await page.waitForFunction(start => window.state.world3D.getStats().distance > start + 1, initial, { timeout: 30000 });
		} catch (error) {
			console.error('Movement diagnostic:', await page.evaluate(() => ({
				control: window.state.manualControlState, index: window.state.index,
				progress: window.state.progress, distance: window.state.world3D.getStats().distance
			})));
			throw error;
		}
		await page.locator(viewport.width <= 768 ? '#world3dMobileBack' : '#world3dBack').click();
		assert.equal(await page.evaluate(() => window.state.is3DMode), false);
		assert.equal(await page.locator('#world3dContainer canvas').count(), 0);
		assert.equal(await page.locator('#map .ol-viewport').evaluate(el => getComputedStyle(el).visibility), 'visible');
		await page.locator('#toggle3DBtn').click();
		await page.waitForFunction(() => window.state.is3DMode && window.state.world3D?.getStats().frames > 1);
		await page.locator(viewport.width <= 768 ? '#world3dMobileBack' : '#world3dBack').click();
		if (viewport.width > 768) {
			await page.evaluate(() => {
				window.stopSimulation();
				const state = window.state;
				state.route = [0, 0.001, 0.03].map((offset, i) => ({
					latlng: { lat: 11, lng: 78 + offset }, placeName: `Stop ${i}`, type: 'stop'
				}));
				state.smoothRoute = [];
				state.currentRouteType = 'rail';
				state.semiAutoMode = true;
				state.isLooping = false;
				window.animateMovement(state.route, 'train', 120, 2);
			});
			await page.locator('#toggle3DBtn').click();
			await page.waitForFunction(() => window.state.world3D?.getStats().stationCount === 3);
			await page.waitForTimeout(12000);
			await page.evaluate(() => { window.state.progress = 1; });
			await page.locator('#semiAutoCloseDoorsBtn').waitFor({ state: 'visible', timeout: 10000 });
			await page.locator('#semiAutoCloseDoorsBtn').click();
			await page.waitForFunction(() => window.state.index === 1, null, { timeout: 15000 });
			await page.locator(viewport.width <= 768 ? '#world3dMobileBack' : '#world3dBack').click();
		}
		assert.ok(!requests.some(url => /cesium|3dtiles|terrain\/tiles/i.test(url)), '3D never requests Cesium or terrain tiles');
		assert.deepEqual(errors, [], 'no uncaught 3D errors');
		console.log(`Standalone 3D world passed at ${viewport.width}x${viewport.height}`);
	} finally {
		await page.close();
	}
}

try {
	await exercise({ width: 1280, height: 800 });
	await exercise({ width: 390, height: 844 });
	await exercise({ width: 740, height: 360 });
} finally {
	await browser.close();
}
