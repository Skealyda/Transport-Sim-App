import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const baseURL = process.env.WORLD_TEST_URL || 'http://127.0.0.1:5173';

async function exercise(viewport) {
	const page = await browser.newPage({ viewport });
	const errors = [];
	const dialogs = [];
	page.on('pageerror', error => errors.push(error.message));
	page.on('dialog', async dialog => {
		dialogs.push(dialog.message());
		await dialog.accept();
	});
	await page.route('**/nominatim.openstreetmap.org/**', route => route.abort());
	await page.addInitScript(() => localStorage.setItem('voiceAnnouncements', 'false'));

	try {
		await page.goto(baseURL, { waitUntil: 'load' });
		await page.evaluate(() => {
			window.state.route = [0, 0.1, 0.2].map((offset, index) => ({
				latlng: { lat: 11.1271, lng: 78.6569 + offset },
				placeName: 'ABC'[index],
				type: index === 1 ? 'waypoint' : 'stop'
			}));
			window.state.currentRouteType = 'rail';
			window.state.maxGForceLimit = 0.8;
		});
		async function start(mode = 'train') {
			await page.evaluate(() => window.showSimulateDialog());
			await page.locator('label[for="manualMode"]').click();
			await page.locator('#transportMode').selectOption(mode);
			await page.locator('#maxSpeedInput').fill('120');
			await page.locator('#simulateDialog .btn-primary-compact').click();
			await page.locator('#manualControlPanel').waitFor({ state: 'visible' });
			await page.waitForTimeout(350);
		}
		await start();
		const panel = page.locator('#manualControlPanel');
		const bounds = await panel.boundingBox();
		assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width + 1, 'panel fits viewport width');
		assert.ok(bounds.height <= (viewport.width <= 768 ? viewport.height * 0.45 + 1 : 300), 'controls stay compact');
		assert.equal(await page.locator('.page-container > h2').count(), 0, 'title row is removed');
		await page.mouse.move(0, 0);
		const overflow = await panel.locator('.manual-actions button:visible, .speed-presets button').evaluateAll(buttons =>
			buttons.filter(button => {
				const range = document.createRange();
				range.selectNodeContents(button);
				const text = range.getBoundingClientRect();
				const box = button.getBoundingClientRect();
				return text.width > box.width;
			}).map(button => button.textContent));
		assert.deepEqual(overflow, [], 'control labels fit their buttons');
		const waitingAtOrigin = await page.evaluate(async () =>
			(await import('/js/modules/passengerTraffic.js')).getWaitingPassengers(0).length);
		assert.ok(waitingAtOrigin > 0, 'passengers wait at the origin');
		assert.equal(await page.evaluate(() => window.state.vectorSource.getFeatures()
			.filter(feature => feature.get('careerPlatformIdx') !== undefined).length), 2,
		'2D platforms appear at stops but not waypoints');
		await page.locator('#doorsBtn').click();
		assert.equal(await page.locator('#doorsBtn').textContent(), 'Close doors');
		assert.equal(await page.evaluate(async () =>
			(await import('/js/modules/passengerTraffic.js')).getWaitingPassengers(0).length), 0,
		'passengers board when the doors open');
		assert.ok(await page.evaluate(() => window.state.vectorSource.getFeatures()
			.find(feature => feature.get('careerPlatformIdx') === 0).get('flowDots').length) > 0,
		'boarding produces a visible platform flow');
		await page.locator('.speed-btn').last().click();
		assert.match(dialogs.pop(), /close doors/i);
		assert.equal(await page.evaluate(() => window.state.manualControlState.targetSpeed), 0);
		await page.locator('#doorsBtn').click();
		await page.locator('.speed-btn').last().click();
		assert.equal(await page.evaluate(() => window.state.manualControlState.acceleration), 0, 'raising the limit does not apply power');
		await page.waitForTimeout(300);
		assert.equal(await page.evaluate(() => window.state.manualControlState.currentSpeed), 0, 'the limit alone does not move the vehicle');
		await page.locator('#accelerationSlider').fill('20');
		await page.waitForFunction(() => window.state.manualControlState.currentSpeed > 1);
		await page.locator('#doorsBtn').click();
		assert.match(dialogs.pop(), /stop the vehicle/i);
		assert.equal(await page.evaluate(() => window.state.manualControlState.doorsOpen), false);

		const input = page.locator('#targetSpeedInput');
		await input.fill('45');
		await page.waitForTimeout(300);
		assert.equal(await input.inputValue(), '45', 'typing is not overwritten by live updates');
		await input.press('Tab');
		assert.equal(await page.evaluate(() => window.state.manualControlState.targetSpeed), 45);
		await input.fill('999');
		await input.press('Tab');
		assert.match(dialogs.pop(), /between 0 and 120/i);
		assert.equal(await input.inputValue(), '45');
		await page.locator('#accelerationSlider').fill('100');
		await page.waitForFunction(() => window.state.manualControlState.currentSpeed > 15);
		await page.locator('#brakeSlider').fill('100');
		const beforeBrake = await page.evaluate(() => window.state.manualControlState.currentSpeed);
		await page.waitForFunction(speed => window.state.manualControlState.currentSpeed < speed - 1, beforeBrake);
		await page.locator('#brakeSlider').fill('0');
		await page.waitForFunction(speed => window.state.manualControlState.currentSpeed > speed, beforeBrake - 1);
		await page.locator('#pauseBtn').click();
		const paused = await page.evaluate(() => ({ speed: window.state.manualControlState.currentSpeed, progress: window.state.progress }));
		await page.waitForTimeout(400);
		assert.deepEqual(await page.evaluate(() => ({ speed: window.state.manualControlState.currentSpeed, progress: window.state.progress })), paused);
		const physics = await page.evaluate(async () => {
			const { updateManualSpeedRealistic } = await import('/js/modules/manualControls.js');
			const s = window.state.manualControlState;
			const saved = { ...s };
			const limit = window.state.maxGForceLimit;
			window.state.maxGForceLimit = 0.1;
			Object.assign(s, { currentSpeed: 0, targetSpeed: 100, acceleration: 100, brakeLevel: 0 });
			updateManualSpeedRealistic(1, 'car');
			const acceleration = s.currentSpeed;
			Object.assign(s, { currentSpeed: 40, targetSpeed: 10, acceleration: 100, brakeLevel: 0 });
			updateManualSpeedRealistic(1, 'car');
			const targetBraking = 40 - s.currentSpeed;
			Object.assign(s, { currentSpeed: 40, targetSpeed: 100, acceleration: 100, brakeLevel: 100 });
			updateManualSpeedRealistic(1, 'car');
			const brake = 40 - s.currentSpeed;
			Object.assign(s, saved);
			window.state.maxGForceLimit = limit;
			return { acceleration, targetBraking, brake };
		});
		const permitted = 0.1 * 9.81 * 3.6;
		assert.ok(Math.abs(physics.acceleration - permitted) < 1e-8);
		assert.ok(Math.abs(physics.brake - permitted) < 1e-8);
		assert.equal(physics.targetBraking, 3, 'a lowered limit decelerates gently without exceeding the G-force limit');
		await input.fill('0');
		await input.press('Tab');
		assert.equal(await page.evaluate(() => window.state.manualControlState.acceleration), 100, 'lowering the limit preserves power');
		await input.fill('45');
		await input.press('Tab');
		assert.equal(await page.evaluate(() => window.state.manualControlState.acceleration), 100, 'raising the limit preserves power');
		await page.locator('#resumeBtn').click();
		await page.waitForFunction(progress => window.state.progress > progress, paused.progress);

		await page.evaluate(() => { window.state.progress = 1; });
		await page.waitForFunction(() => window.state.index === 1);
		const transition = await page.evaluate(() => ({
			lng: window.state.fractionalLng,
			start: window.state.route[1].latlng.lng,
			title: document.getElementById('speedLimitSign').title
		}));
		assert.ok(Math.abs(transition.lng - transition.start) < 0.001, 'vehicle stays at the waypoint on transition');
		assert.ok(transition.title.includes('B \u2192 C'));

		await page.locator('.manual-emergency').click();
		assert.equal(await page.evaluate(() => window.state.safetyState.emergencyBrakeApplied), true);
		await page.waitForFunction(() => !window.state.safetyState.emergencyBrakeApplied, null, { timeout: 10000 });
		assert.ok(await page.evaluate(() => window.state.manualControlState.currentSpeed < 0.1));
		await page.locator('#brakeSlider').fill('0');
		await page.locator('.speed-btn').last().click();
		await page.locator('#accelerationSlider').fill('20');
		await page.waitForFunction(() => window.state.manualControlState.currentSpeed > 0.1);
		await page.locator('.minimize-btn').click();
		assert.ok(await panel.evaluate(element => element.classList.contains('minimized')));
		const compactBounds = await panel.boundingBox();
		assert.ok(compactBounds.width <= 251 && compactBounds.width * compactBounds.height < bounds.width * bounds.height,
			'minimized controls occupy less screen area');
		await page.locator('#compactSpeed').fill('40');
		assert.equal(await page.evaluate(() => window.state.manualControlState.targetSpeed), 40);
		assert.equal(await page.locator('#targetSpeedInput').inputValue(), '40');
		await page.locator('#compactPower').fill('35');
		assert.equal(await page.locator('#accelerationSlider').inputValue(), '35');
		await page.locator('#compactBrake').fill('25');
		assert.equal(await page.locator('#brakeSlider').inputValue(), '25');
		await page.locator('.manual-compact-emergency').click();
		assert.ok(await page.evaluate(() => window.state.safetyState.emergencyBrakeApplied || window.state.manualControlState.currentSpeed < 0.1));
		assert.equal(await page.locator('#compactSpeed').inputValue(), '0');
		assert.equal(await page.locator('#compactPower').inputValue(), '0');
		await page.locator('.manual-compact-restore').click();
		assert.ok(!(await panel.evaluate(element => element.classList.contains('minimized'))));
		await page.locator('#stopBtn').click();
		assert.equal(await panel.isVisible(), false);
		assert.equal(await page.evaluate(() => window.state.manualControlState.currentSpeed), 0);

		await start('car');
		assert.equal(await page.locator('#doorsBtn').isVisible(), false, 'doors are train-only');
		assert.deepEqual(await page.evaluate(() => {
			const s = window.state.manualControlState;
			return [s.currentSpeed, s.targetSpeed, s.acceleration, s.brakeLevel, s.isPaused];
		}), [0, 0, 0, 0, false], 'restart resets controls');
		await page.locator('.speed-btn').last().click();
		await page.locator('#accelerationSlider').fill('20');
		await page.waitForFunction(() => window.state.manualControlState.currentSpeed > 0);
		await page.evaluate(() => { window.state.index = 1; window.state.progress = 1; });
		await page.waitForFunction(() => document.getElementById('statusText').textContent === 'Completed');
		assert.equal(await page.evaluate(() => window.state.manualControlState.currentSpeed), 0);
		assert.equal(await page.locator('#accelerationSlider').isDisabled(), true);
		assert.ok(await page.evaluate(() => Math.abs(window.state.fractionalLng - window.state.route[2].latlng.lng) < 1e-8));
		await page.locator('.close-btn').click();
		assert.match(dialogs.pop(), /end the manual simulation/i);
		assert.equal(await page.evaluate(() => window.state.route.length), 3, 'closing preserves the route');
		if (viewport.width > 768) {
			await page.evaluate(async () => {
				const state = window.state;
				state.route = [
					{ latlng: { lat: 11, lng: 78 }, type: 'stop', placeName: 'A' },
					{ latlng: { lat: 11.02, lng: 78.02 }, type: 'waypoint', placeName: 'B' },
					{ latlng: { lat: 11, lng: 78.04 }, type: 'waypoint', placeName: 'C' },
					{ latlng: { lat: 11.02, lng: 78.06 }, type: 'stop', placeName: 'D' }
				];
				state.currentRouteType = 'rail';
				window.currentRouteType = 'rail';
				(await import('/js/modules/routeManager.js')).drawRoute();
			});
			await start();
			assert.equal(await page.evaluate(() => window.state.manualUsesSmoothRoute), true);
			await page.locator('.speed-btn').last().click();
			await page.locator('#accelerationSlider').fill('20');
			await page.waitForFunction(() => window.state.manualControlState.currentSpeed > 1);
			await page.evaluate(() => {
				const map = window.state.map;
				const original = map.forEachFeatureAtPixel;
				map.forEachFeatureAtPixel = () => window.state.trainCoaches[0];
				map.dispatchEvent({ type: 'click', pixel: [0, 0] });
				map.forEachFeatureAtPixel = original;
				window.state.index = 1;
				window.state.progress = 0.3;
			});
			await page.waitForTimeout(300);
			const curve = await page.evaluate(async () => {
				const s = window.state;
				const sampled = (await import('/js/modules/routePosition.js')).sampleRoutePosition(s.route, s.smoothRoute, s.index, s.progress);
				const a = s.route[1].latlng.lat, b = s.route[2].latlng.lat;
				return { lat: s.fractionalLat, expected: sampled.lat, straight: a + (b - a) * s.progress };
			});
			assert.ok(Math.abs(curve.lat - curve.expected) < 0.00001, 'manual train follows smooth track');
			assert.ok(Math.abs(curve.expected - curve.straight) > 0.00001, 'test route is curved');
			const zoom = await page.evaluate(() => {
				const view = window.state.map.getView();
				view.cancelAnimations();
				const target = view.getZoom() + 1;
				view.animate({ zoom: target, duration: 500 });
				return target;
			});
			await page.waitForTimeout(800);
			assert.ok(Math.abs(await page.evaluate(() => window.state.map.getView().getZoom()) - zoom) < 0.01, 'tracking does not interrupt zoom');
			const curvedHandover = await page.evaluate(async () => {
				const m = await import('/js/modules/manualControls.js');
				const s = window.state;
				const before = { index: s.index, progress: s.progress, speed: s.manualControlState.currentSpeed, bearing: s.currentBearing };
				const train = s.trainCoaches[0];
				m.toggleManualAutopilot();
				return { before, after: { index: s.index, progress: s.progress, speed: s.manualControlState.currentSpeed, bearing: s.currentBearing },
					sameTrain: train === s.trainCoaches[0], tracking: s.isTracking, active: s.manualControlState.autopilotActive };
			});
			assert.deepEqual(curvedHandover.after, curvedHandover.before, 'curved-track handover preserves pose and speed');
			assert.ok(curvedHandover.sameTrain && curvedHandover.tracking && curvedHandover.active, 'handover preserves train and tracking');
			await page.waitForTimeout(500);
			const autoCurve = await page.evaluate(async () => {
				const s = window.state;
				const sampled = (await import('/js/modules/routePosition.js')).sampleRoutePosition(s.route, s.smoothRoute, s.index, s.progress);
				return { lat: s.fractionalLat, expected: sampled.lat };
			});
			assert.ok(Math.abs(autoCurve.lat - autoCurve.expected) < 0.00001, 'automatic handover follows the same curved track');
			await page.evaluate(async () => (await import('/js/modules/manualControls.js')).toggleManualAutopilot());
			await page.locator('#stopBtn').click();
		}
		assert.deepEqual(errors, [], 'no uncaught browser errors');
		console.log(`Manual controls passed at ${viewport.width}x${viewport.height}`);
	} finally {
		await page.close();
	}
}

async function exerciseAutopilot() {
	const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
	const errors = [];
	const dialogs = [];
	page.on('pageerror', error => errors.push(error.message));
	page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
	await page.route('**/nominatim.openstreetmap.org/**', route => route.abort());
	await page.addInitScript(() => localStorage.setItem('voiceAnnouncements', 'false'));
	try {
		await page.goto(baseURL, { waitUntil: 'load' });
		await page.evaluate(async () => {
			const s = window.state;
			s.route = [0, 0.1, 0.2].map((offset, index) => ({
				latlng: { lat: 11.1271, lng: 78.6569 + offset }, placeName: 'ABC'[index], type: 'stop'
			}));
			s.currentRouteType = 'rail';
			s.stationDelayTime = 1;
			const manual = await import('/js/modules/manualControls.js');
			manual.showManualControlPanel();
			manual.showDoorControls();
			manual.startManualSimulation(s.route, 'train', 120, 3);
		});
		const handover = await page.evaluate(async () => {
			const m = await import('/js/modules/manualControls.js');
			const s = window.state;
			m.setTargetSpeedDirect(80);
			m.updateBrakeFromSlider(20);
			s.index = 0;
			s.progress = 0.25;
			s.manualControlState.currentSpeed = 40;
			s.manualControlState.currentAcceleration = -2;
			const before = { index: s.index, progress: s.progress, speed: s.manualControlState.currentSpeed, train: s.trainCoaches[0] };
			m.toggleManualAutopilot();
			return { before: { index: before.index, progress: before.progress, speed: before.speed },
				after: { index: s.index, progress: s.progress, speed: s.manualControlState.currentSpeed },
				sameTrain: before.train === s.trainCoaches[0], active: s.manualControlState.autopilotActive };
		});
		assert.deepEqual(handover.after, handover.before, 'handover preserves position and speed');
		assert.equal(handover.sameTrain, true, 'handover preserves vehicle features');
		assert.equal(handover.active, true);
		await page.waitForFunction(() => window.state.progress > 0.25, null, { timeout: 5000 });
		const auto = await page.evaluate(() => ({
			speed: window.state.manualControlState.currentSpeed,
			acceleration: window.state.manualControlState.currentAcceleration,
			progress: window.state.progress
		}));
		assert.ok(auto.speed > 35 && auto.speed < 45 && auto.progress > 0.25,
			`automatic engine continues without a speed jump: ${JSON.stringify(auto)}`);
		assert.ok(Math.abs(auto.acceleration + 2) < 4, 'brake force changes gradually');
		const limited = await page.evaluate(async () => {
			const m = await import('/js/modules/manualControls.js');
			const before = window.state.manualControlState.currentSpeed;
			m.setTargetSpeedDirect(10);
			return { before, after: window.state.manualControlState.currentSpeed };
		});
		assert.equal(limited.after, limited.before, 'reducing the limit does not instantly change speed');
		await page.waitForTimeout(500);
		assert.ok(await page.evaluate(() => window.state.manualControlState.currentSpeed) > limited.before - 4,
			'automatic braking towards a lower limit is gradual');
		await page.evaluate(async () => (await import('/js/modules/manualControls.js')).setTargetSpeedDirect(80));
		const back = await page.evaluate(async () => {
			const m = await import('/js/modules/manualControls.js');
			const s = window.state;
			const before = { index: s.index, progress: s.progress, speed: s.manualControlState.currentSpeed };
			m.updateAccelerationFromSlider(35);
			return { before, after: { index: s.index, progress: s.progress, speed: s.manualControlState.currentSpeed },
				active: s.manualControlState.autopilotActive, power: s.manualControlState.acceleration };
		});
		assert.deepEqual(back.after, back.before, 'manual takeover preserves position and speed');
		assert.equal(back.active, false);
		assert.equal(back.power, 35);
		await page.evaluate(async () => {
			const m = await import('/js/modules/manualControls.js');
			m.toggleManualAutopilot();
			m.emergencyBrake();
		});
		assert.deepEqual(await page.evaluate(() => ({
			active: window.state.manualControlState.autopilotActive,
			brake: window.state.manualControlState.brakeLevel,
			emergency: window.state.safetyState.emergencyBrakeApplied
		})), { active: false, brake: 100, emergency: true }, 'emergency brake takes control');
		await page.evaluate(async () => {
			const m = await import('/js/modules/manualControls.js');
			m.stopSimulation();
			m.showManualControlPanel();
			m.startManualSimulation(window.state.route, 'train', 120, 3);
			m.openDoors();
			m.toggleManualAutopilot();
		});
		assert.match(dialogs.pop(), /close the doors/i);
		assert.equal(await page.evaluate(() => window.state.manualControlState.autopilotActive), false);
		await page.evaluate(async () => {
			const m = await import('/js/modules/manualControls.js');
			m.closeDoors();
			m.pauseSimulation();
			window.state.progress = 0.99999;
			window.state.manualControlState.currentSpeed = 80;
			m.toggleManualAutopilot();
		});
		assert.match(dialogs.pop(), /not enough distance/i);
		assert.equal(await page.evaluate(() => window.state.manualControlState.autopilotActive), false);
		await page.evaluate(async () => {
			const m = await import('/js/modules/manualControls.js');
			window.state.manualControlState.currentSpeed = 0;
			window.state.manualControlState.currentAcceleration = 0;
			window.state.progress = 1;
			m.resumeSimulation();
			m.toggleManualAutopilot();
		});
		await page.waitForFunction(() => window.state.manualControlState.doorsOpen, null, { timeout: 10000 });
		await page.evaluate(async () => (await import('/js/modules/manualControls.js')).toggleManualAutopilot());
		await page.waitForTimeout(2500);
		assert.deepEqual(await page.evaluate(() => ({
			index: window.state.index, progress: window.state.progress,
			active: window.state.manualControlState.autopilotActive, doors: window.state.manualControlState.doorsOpen
		})), { index: 0, progress: 1, active: false, doors: true }, 'cancelled station dwell cannot depart later');
		await page.evaluate(async () => {
			const m = await import('/js/modules/manualControls.js');
			m.closeDoors();
			m.setTargetSpeedDirect(80);
			window.state.progress = 0.99999;
			window.state.manualControlState.currentSpeed = 0.5;
			window.state.manualControlState.currentAcceleration = -window.state.decelGForceLimit * 9.81 * 3.6;
			m.toggleManualAutopilot();
		});
		await page.waitForFunction(() => window.state.manualControlState.doorsOpen, null, { timeout: 10000 });
		await page.evaluate(async () => (await import('/js/modules/manualControls.js')).pauseSimulation());
		await page.waitForTimeout(1500);
		assert.equal(await page.evaluate(() => window.state.index), 0, 'paused autopilot cannot depart a station');
		await page.evaluate(async () => (await import('/js/modules/manualControls.js')).resumeSimulation());
		await page.waitForFunction(() => window.state.index === 1 && !window.state.manualControlState.doorsOpen, null, { timeout: 15000 });
		assert.equal(await page.evaluate(() => window.state.manualControlState.autopilotActive), true,
			'autopilot continues after station dwell');
		await page.waitForFunction(() => window.state.manualControlState.currentSpeed > 0.2, null, { timeout: 10000 });
		const capTest = await page.evaluate(async () => {
			const m = await import('/js/modules/manualControls.js');
			const before = window.state.manualControlState.currentSpeed;
			m.setTargetSpeedDirect(Math.ceil(before) + 1);
			const limit = window.state.manualControlState.targetSpeed;
			let peak = before;
			const end = performance.now() + 3000;
			while (performance.now() < end) {
				await new Promise(resolve => requestAnimationFrame(resolve));
				peak = Math.max(peak, window.state.manualControlState.currentSpeed);
			}
			return { peak, limit };
		});
		assert.ok(capTest.peak <= capTest.limit + 0.001, 'autopilot does not accelerate past the selected limit');
		const paused = await page.evaluate(async () => {
			const m = await import('/js/modules/manualControls.js');
			m.pauseSimulation();
			return { progress: window.state.progress, speed: window.state.manualControlState.currentSpeed };
		});
		await page.waitForTimeout(500);
		assert.deepEqual(await page.evaluate(() => ({
			progress: window.state.progress, speed: window.state.manualControlState.currentSpeed
		})), paused, 'pausing also pauses automatic movement');
		await page.evaluate(async () => (await import('/js/modules/manualControls.js')).resumeSimulation());
		await page.evaluate(() => window.stopSimulation());
		await page.evaluate(async () => {
			const m = await import('/js/modules/manualControls.js');
			const s = window.state;
			s.route = [
				{ latlng: { lat: 11, lng: 78 }, placeName: 'Start', type: 'stop' },
				{ latlng: { lat: 11, lng: 78.1 }, placeName: 'End', type: 'waypoint' }
			];
			s.isLooping = false;
			m.showManualControlPanel();
			m.startManualSimulation(s.route, 'train', 120, 3);
			m.setTargetSpeedDirect(80);
			s.progress = 0.99999;
			s.manualControlState.currentSpeed = 0.5;
			s.manualControlState.currentAcceleration = -s.decelGForceLimit * 9.81 * 3.6;
			m.toggleManualAutopilot();
		});
		await page.waitForFunction(() => !window.state.manualControlState.isManualMode, null, { timeout: 10000 });
		assert.deepEqual(await page.evaluate(() => ({
			speed: window.state.manualControlState.currentSpeed,
			active: window.state.manualControlState.autopilotActive,
			doors: window.state.manualControlState.doorsOpen
		})), { speed: 0, active: false, doors: false }, 'autopilot stops safely at a terminal waypoint');
		await page.evaluate(() => window.stopSimulation());
		assert.deepEqual(errors, [], 'no uncaught handover errors');
		console.log('Autopilot handover and safety checks passed');
	} finally {
		await page.close();
	}
}

try {
	await exerciseAutopilot();
	await exercise({ width: 1280, height: 800 });
	await exercise({ width: 390, height: 844 });
	await exercise({ width: 740, height: 360 });
} finally {
	await browser.close();
}
