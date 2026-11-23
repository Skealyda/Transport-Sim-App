import { afterEach, describe, expect, it, vi } from 'vitest';
import state from '../js/modules/state.js';
import { calculateManualSegmentPeakSpeeds, preCalculateJourney } from '../js/modules/gforce.js';
import { calculateDistance } from '../js/modules/utils.js';
import { clearSegmentSpeedProfile, setSegmentSpeedProfile, updateSegmentSpeedSign } from '../js/modules/segmentSpeedSign.js';

describe('segment peak speed sign', () => {
	afterEach(() => {
		clearSegmentSpeedProfile();
		vi.unstubAllGlobals();
	});

	it('shows each segment in order, preserves the segment on unit changes, and clears at the end', () => {
		const number = { textContent: '' };
		const unit = { textContent: '' };
		const sign = {
			style: {}, title: '', attributes: {},
			querySelector: () => number,
			setAttribute(name, value) { this.attributes[name] = value; }
		};
		vi.stubGlobal('document', { getElementById: id => id === 'speedLimitSign' ? sign : id === 'speedLimitUnit' ? unit : null });
		state.route = ['A', 'B', 'C', 'D', 'E'].map(placeName => ({ placeName }));
		state.useImperialUnits = false;
		setSegmentSpeedProfile([20, 40, 60, 80]);
		expect(sign.style.opacity).toBe('1');
		for (let i = 0; i < 4; i++) {
			updateSegmentSpeedSign(i);
			expect(number.textContent).toBe(String((i + 1) * 20));
			expect(sign.title).toContain(`${state.route[i].placeName} → ${state.route[i + 1].placeName}`);
			expect(sign.title).toContain('not a posted or enforced limit');
		}
		state.useImperialUnits = true;
		updateSegmentSpeedSign();
		expect(number.textContent).toBe('50');
		expect(unit.textContent).toBe('mph');
		updateSegmentSpeedSign(4);
		expect(number.textContent).toBe('—');
		expect(sign.title).toContain('No segment');
		clearSegmentSpeedProfile();
		expect(sign.style.opacity).toBe('0');
	});

	it('leaves unavailable peaks blank rather than displaying a target speed', () => {
		const number = { textContent: '' };
		const sign = { style: {}, querySelector: () => number, setAttribute() {} };
		vi.stubGlobal('document', { getElementById: id => id === 'speedLimitSign' ? sign : null });
		state.route = [{}, {}];
		setSegmentSpeedProfile([NaN]);
		expect(number.textContent).toBe('—');
	});
});

describe('manual segment peak profile', () => {
	it('matches the shared timetable solver using manual straight-line distances, including waypoints', () => {
		state.route = [
			{ latlng: { lat: 11, lng: 78 }, type: 'stop' },
			{ latlng: { lat: 11.001, lng: 78 }, type: 'stop' },
			{ latlng: { lat: 11.004, lng: 78 }, type: 'waypoint' },
			{ latlng: { lat: 11.006, lng: 78 }, type: 'stop' },
			{ latlng: { lat: 11.02, lng: 78 }, type: 'stop' }
		];
		state.segmentDistances = state.route.slice(1).map((p, i) => calculateDistance(state.route[i].latlng, p.latlng));
		state.segmentSmoothDistances = [];
		const manual = calculateManualSegmentPeakSpeeds(120, 0.1, 0.05);
		const planned = preCalculateJourney(120, 0.1, 0.05, 24).segmentPeakSpeeds;
		expect(manual).toHaveLength(4);
		manual.forEach((speed, i) => expect(speed).toBeCloseTo(planned[i], 6));
		expect(manual[0]).toBeLessThan(manual[3]);
		expect(manual[1]).toBeGreaterThan(0);
	});
});
