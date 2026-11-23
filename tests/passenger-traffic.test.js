import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	startPassengerTraffic,
	stopPassengerTraffic,
	getWaitingPassengers,
	processPassengerArrival,
	setPassengerArrivalListener,
	getOnboardPassengers
} from '../js/modules/passengerTraffic.js';

const route = [
	{ latlng: { lat: 0, lng: 0 }, placeName: 'A' },
	{ latlng: { lat: 0, lng: 1 }, placeName: 'B' },
	{ latlng: { lat: 0, lng: 2 }, placeName: 'C' },
	{ latlng: { lat: 0, lng: 3 }, placeName: 'D' }
];

describe('standard passenger traffic', () => {
	afterEach(() => {
		stopPassengerTraffic();
		setPassengerArrivalListener(null);
	});

	it('boards waiting passengers and alights them at their destination on station arrivals', () => {
		const onArrival = vi.fn();
		setPassengerArrivalListener(onArrival);
		startPassengerTraffic(route);

		const initiallyWaiting = getWaitingPassengers(0).length;
		const firstArrival = processPassengerArrival(0);
		expect(firstArrival.boarded).toBeGreaterThan(0);
		expect(getWaitingPassengers(0)).toHaveLength(initiallyWaiting - firstArrival.boarded);

		const nextArrival = processPassengerArrival(1);
		expect(nextArrival.alighted).toBeGreaterThan(0);
		expect(onArrival).toHaveBeenNthCalledWith(1, { stopIndex: 0, ...firstArrival });
		expect(onArrival).toHaveBeenNthCalledWith(2, { stopIndex: 1, ...nextArrival });
		expect(getOnboardPassengers()).toHaveLength(firstArrival.boarded - nextArrival.alighted + nextArrival.boarded);
	});

	it('limits boarding to available capacity and ignores waypoints', () => {
		const withWaypoint = [
			route[0],
			{ latlng: { lat: 0, lng: 0.5 }, type: 'waypoint' },
			...route.slice(1)
		];
		startPassengerTraffic(withWaypoint, 2);

		expect(processPassengerArrival(0).boarded).toBe(2);
		expect(processPassengerArrival(1).boarded).toBe(0);
	});

	it('replenishes waiting passengers on later loops and alights passengers at the origin', () => {
		startPassengerTraffic([route[0], route[1], { ...route[0] }]);
		expect(processPassengerArrival(0).boarded).toBeGreaterThan(0);
		const atMiddle = processPassengerArrival(1);
		expect(atMiddle.alighted).toBeGreaterThan(0);
		expect(atMiddle.boarded).toBeGreaterThan(0);
		const atOrigin = processPassengerArrival(0);
		expect(atOrigin.alighted).toBeGreaterThan(0);
		expect(atOrigin.boarded).toBeGreaterThan(0);
		expect(getWaitingPassengers(1).length).toBeGreaterThan(0);
	});
});
