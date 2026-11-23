import { calculateDistance } from './utils.js';

let traffic = null;
let arrivalListener = null;

function isLooping(route) {
	if (!route || route.length < 3) return false;
	const first = route[0];
	const last = route[route.length - 1];
	const a = first.latlng || first;
	const b = last.latlng || last;
	const firstName = (first.placeName || '').trim().toLowerCase();
	const lastName = (last.placeName || '').trim().toLowerCase();
	return calculateDistance(a, b) < 0.1 || (firstName.length > 0 && firstName === lastName);
}

function populateWaiting(stations, loop, lastStation, waiting, cycle) {
	for (const { point, index } of stations) {
		if (index === lastStation) continue;
		const nextStations = stations.filter(stop => stop.index > index && stop.index !== lastStation);
		const destinations = nextStations.length ? nextStations : (loop ? stations.filter(stop => stop.index < index) : []);
		const list = waiting.get(index) || [];
		const target = destinations.length ? 4 + ((index * 7 + stations.length * 3) % 7) : 0;
		const count = Math.max(0, target - list.length);
		for (let i = 0; i < count; i++) {
			const destination = destinations[(i * 3 + index) % destinations.length];
			const p = point.latlng || point;
			const d = destination.point.latlng || destination.point;
			const distanceKm = calculateDistance(p, d);
			list.push({
				id: `traffic-${cycle}-${index}-${i}`,
				destIndex: destination.index,
				remainingKm: distanceKm
			});
		}
		waiting.set(index, list);
	}
}

export function startPassengerTraffic(route, capacity = 90) {
	stopPassengerTraffic();
	if (!Array.isArray(route) || route.length < 2) return;
	const stations = route
		.map((point, index) => ({ point, index }))
		.filter(({ point }) => !['waypoint', 'dummy'].includes(point.type || 'stop'));
	const loop = isLooping(route);
	const waiting = new Map();
	const lastStation = loop ? route.length - 1 : -1;
	populateWaiting(stations, loop, lastStation, waiting, 0);
	traffic = { stations, waiting, passengers: [], capacity: Math.max(1, capacity), loop, lastStation, originVisits: 0 };
}

export function stopPassengerTraffic() {
	traffic = null;
}

export function setPassengerArrivalListener(listener) {
	arrivalListener = typeof listener === 'function' ? listener : null;
}

export function getWaitingPassengers(stopIndex) {
	return traffic?.waiting.get(stopIndex) || [];
}

export function getOnboardPassengers() {
	return traffic ? [...traffic.passengers] : [];
}

export function processPassengerArrival(stopIndex) {
	if (!traffic) return { boarded: 0, alighted: 0 };
	if (traffic.loop && stopIndex === 0 && traffic.originVisits++ > 0) {
		populateWaiting(traffic.stations, true, traffic.lastStation, traffic.waiting, traffic.originVisits - 1);
	}
	const alighting = traffic.passengers.filter(passenger => passenger.destIndex === stopIndex);
	traffic.passengers = traffic.passengers.filter(passenger => passenger.destIndex !== stopIndex);
	const waiting = traffic.waiting.get(stopIndex) || [];
	const available = Math.max(0, traffic.capacity - traffic.passengers.length);
	const boarding = waiting.splice(0, available);
	traffic.passengers.push(...boarding);
	const result = { boarded: boarding.length, alighted: alighting.length };
	arrivalListener?.({ stopIndex, ...result });
	return result;
}
