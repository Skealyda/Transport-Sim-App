import state from './state.js';
import { convertSpeed, getSpeedUnit } from './utils.js';

let peaks = [];
let displayedIndex = null;

export function setSegmentSpeedProfile(segmentPeaks) {
	peaks = Array.isArray(segmentPeaks) ? segmentPeaks : [];
	updateSegmentSpeedSign(0);
	const sign = document.getElementById('speedLimitSign');
	if (sign) sign.style.opacity = '1';
}

export function updateSegmentSpeedSign(index = displayedIndex) {
	displayedIndex = index;
	const sign = document.getElementById('speedLimitSign');
	if (!sign) return;
	const value = sign.querySelector('.sign-number');
	const unit = document.getElementById('speedLimitUnit');
	const peak = Number.isInteger(index) && index >= 0 ? peaks[index] : null;
	const valid = Number.isFinite(peak) && peak > 0 && index < state.route.length - 1;
	if (value) value.textContent = valid ? String(Math.round(convertSpeed(peak, state.useImperialUnits))) : '—';
	if (unit) unit.textContent = getSpeedUnit(state.useImperialUnits);
	const from = valid ? (state.route[index].placeName || `Point ${index + 1}`) : '';
	const to = valid ? (state.route[index + 1].placeName || `Point ${index + 2}`) : '';
	sign.title = valid
		? `${from} → ${to}: estimated planned peak speed; not a posted or enforced limit. Curves may lower actual speed.`
		: 'No segment peak speed available.';
	sign.setAttribute('aria-label', valid
		? `${from} to ${to}, estimated peak ${value?.textContent} ${getSpeedUnit(state.useImperialUnits)}; not a speed limit`
		: 'No segment peak speed available');
}

export function clearSegmentSpeedProfile() {
	peaks = [];
	updateSegmentSpeedSign(null);
	const sign = document.getElementById('speedLimitSign');
	if (sign) sign.style.opacity = '0';
}
