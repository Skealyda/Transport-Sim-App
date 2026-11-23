import state from './state.js';
import { convertSpeed, getSpeedUnit, formatDistanceShort } from './utils.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const START_ANGLE = -135;
const SWEEP_ANGLE = 270;
// Dial ranges in display units; growth leaves headroom so the scale rarely changes during acceleration.
const SCALES = [40, 60, 80, 100, 120, 160, 200, 240, 280, 320, 400, 500, 600, 800, 1000, 1200, 1600, 2000,
	2500, 3000, 4000, 5000, 6000, 8000, 10000, 12000, 16000, 20000, 25000, 30000, 40000, 50000];
const MAJOR_STEPS = [5, 10, 20, 25, 40, 50, 100, 200, 250, 400, 500, 1000, 2000, 2500, 4000, 5000, 10000];
const GROW_ABOVE = 0.92;
const SHRINK_BELOW = 0.3;
const HEADROOM = 0.55;
const SHRINK_HOLD_MS = 1500;

let elements = null;
let scale = 0;
let scaleUnit = '';
let scaleChangedAt = 0;
let renderedDial = '';
let renderedLimit = '';
let renderedNeedle = '';
let renderedSweep = '';

function getElements() {
	if (!elements) {
		const byId = id => document.getElementById(id);
		elements = {
			panel: document.querySelector('.speed-panel'),
			value: byId('liveSpeed'),
			unit: byId('speedUnitLabel'),
			dial: byId('analogSpeedometer'),
			ticks: byId('speedometerTicks'),
			needle: byId('speedometerNeedle'),
			sweep: byId('speedometerSweep'),
			redline: byId('speedometerRedline'),
			limitMarker: byId('speedometerLimitMarker'),
			multiplier: byId('speedometerMultiplier'),
			dialUnit: byId('analogSpeedUnit'),
			odometer: byId('speedometerOdometer'),
			dialDigital: byId('dialDigitalSpeed')
		};
	}
	return elements;
}

function point(radius, angle) {
	const radians = angle * Math.PI / 180;
	return [100 + radius * Math.sin(radians), 100 - radius * Math.cos(radians)];
}

function arcPath(radius, from, to) {
	const [x1, y1] = point(radius, from);
	const [x2, y2] = point(radius, to);
	return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${radius} ${radius} 0 ${to - from > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

function svg(name, attributes, text) {
	const node = document.createElementNS(SVG_NS, name);
	for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
	if (text !== undefined) node.textContent = text;
	return node;
}

export function nextSpeedometerScale(current, speed, heldMs = Infinity) {
	const target = SCALES.find(candidate => speed <= candidate * HEADROOM)
		?? Math.ceil(speed / HEADROOM / 10000) * 10000;
	if (!current) return target;
	if (speed > current * GROW_ABOVE) return Math.max(current, target);
	if (speed < current * SHRINK_BELOW && heldMs >= SHRINK_HOLD_MS) return Math.min(current, target);
	return current;
}

function buildDial(el, range) {
	const step = MAJOR_STEPS.find(candidate => range % candidate === 0 && range / candidate <= 8) ?? range / 8;
	const majors = Math.round(range / step);
	const subdivisions = majors <= 5 ? 10 : 4;
	const divisor = range >= 10000 ? 1000 : range >= 1000 ? 100 : 1;
	const fragment = document.createDocumentFragment();
	const total = majors * subdivisions;
	for (let i = 0; i <= total; i++) {
		const angle = START_ANGLE + i / total * SWEEP_ANGLE;
		const major = i % subdivisions === 0;
		const mid = !major && i % (subdivisions / 2) === 0;
		const [x1, y1] = point(80, angle);
		const [x2, y2] = point(major ? 68 : mid ? 72 : 75, angle);
		fragment.appendChild(svg('line', {
			x1: x1.toFixed(2), y1: y1.toFixed(2), x2: x2.toFixed(2), y2: y2.toFixed(2),
			class: major ? 'dial-tick major' : mid ? 'dial-tick mid' : 'dial-tick'
		}));
		if (major) {
			const label = String(Math.round(step * i / subdivisions / divisor * 10) / 10);
			const [x, y] = point(57, angle);
			fragment.appendChild(svg('text', {
				x: x.toFixed(2), y: y.toFixed(2), class: label.length > 3 ? 'dial-label compact' : 'dial-label'
			}, label));
		}
	}
	el.ticks.replaceChildren(fragment);
	el.multiplier.textContent = divisor > 1 ? `×${divisor}` : '';
	el.ticks.classList.remove('rescaled');
	void el.ticks.getBoundingClientRect();
	el.ticks.classList.add('rescaled');
}

export function setSpeedometerMode(mode) {
	if (!['digital', 'analog', 'combined'].includes(mode)) {
		console.error('Invalid speedometer mode:', mode);
		return;
	}
	state.speedometerMode = mode;
	localStorage.setItem('speedometerMode', mode);
	document.getElementById('speedometerModeSelect').value = mode;
	document.documentElement.dataset.speedometerMode = mode;
	getElements().panel.dataset.speedometerMode = mode;
	renderedDial = '';
	updateSpeedometer();
}

export function updateSpeedometer(speed = state.manualControlState.isManualMode
	? state.manualControlState.currentSpeed : state.currentDisplaySpeed) {
	const el = getElements();
	const imperial = state.useImperialUnits;
	const unit = getSpeedUnit(imperial);
	const value = convertSpeed(Math.max(0, Number.isFinite(speed) ? speed : 0), imperial);
	const displayed = String(Math.round(value));
	if (el.value.textContent !== displayed) el.value.textContent = displayed;
	if (el.unit.textContent !== unit) el.unit.textContent = unit;
	if (state.speedometerMode === 'digital') return;
	if (el.dialDigital && el.dialDigital.textContent !== displayed) el.dialDigital.textContent = displayed;

	const now = performance.now();
	if (scaleUnit !== unit) {
		scale = 0;
		scaleUnit = unit;
	}
	const next = nextSpeedometerScale(scale, value, now - scaleChangedAt);
	if (next !== scale) {
		scale = next;
		scaleChangedAt = now;
	}
	const dialKey = `${scale}:${unit}`;
	if (dialKey !== renderedDial) {
		buildDial(el, scale);
		el.dialUnit.textContent = unit;
		renderedDial = dialKey;
		renderedLimit = '';
	}

	const limitSetting = state.manualControlState.isManualMode ? state.manualControlState.userDefinedMaxSpeed
		: Number(document.getElementById('maxSpeedInput')?.value);
	const limit = convertSpeed(limitSetting > 0 ? limitSetting : 0, imperial);
	const limitKey = limit > 0 && limit < scale ? `${dialKey}:${limit.toFixed(1)}` : `${dialKey}:none`;
	if (limitKey !== renderedLimit) {
		const visible = !limitKey.endsWith(':none');
		const angle = START_ANGLE + Math.min(1, limit / scale) * SWEEP_ANGLE;
		el.redline.setAttribute('d', visible ? arcPath(84, angle, START_ANGLE + SWEEP_ANGLE) : '');
		el.limitMarker.setAttribute('transform', `rotate(${angle.toFixed(2)} 100 100)`);
		el.limitMarker.style.display = visible ? '' : 'none';
		renderedLimit = limitKey;
	}

	const fraction = Math.min(1, value / scale);
	const needle = `rotate(${(START_ANGLE + fraction * SWEEP_ANGLE).toFixed(2)} 100 100)`;
	if (needle !== renderedNeedle) {
		el.needle.setAttribute('transform', needle);
		renderedNeedle = needle;
	}
	const sweep = (1000 * (1 - fraction)).toFixed(1);
	if (sweep !== renderedSweep) {
		el.sweep.setAttribute('stroke-dashoffset', sweep);
		el.sweep.classList.toggle('over-limit', limit > 0 && value > limit);
		renderedSweep = sweep;
	}
	const trip = formatDistanceShort(state.totalDistanceCovered || 0, imperial);
	if (el.odometer.textContent !== trip) el.odometer.textContent = trip;
	const label = `${displayed} ${unit}; scale 0 to ${scale} ${unit}`;
	if (el.dial.getAttribute('aria-label') !== label) el.dial.setAttribute('aria-label', label);
}
