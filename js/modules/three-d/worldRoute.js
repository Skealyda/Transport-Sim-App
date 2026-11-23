import { calculateDistance } from '../utils.js';
import { createRoutePath } from './routePath.js';

const STATION_DEPTH = 28;
const PLATFORM_HALF_LENGTH = 100;
const RAMP_LENGTH = 900;
const TUNNEL_COVER_DEPTH = 8.5;

export function createWorldRoute(route, smoothRoute, manual) {
	if (!Array.isArray(route) || route.length < 2) throw new Error('A route with at least two points is required.');
	const smooth = !manual && Array.isArray(smoothRoute) && smoothRoute.length > 2;
	const source = smooth ? smoothRoute : route.map(point => point.latlng || point);
	const points = [];
	const metadata = [];
	for (const point of source) {
		const lng = point.lng ?? point.lon;
		const lat = point.lat;
		if (!Number.isFinite(lng) || !Number.isFinite(lat)) throw new Error('The route contains invalid coordinates.');
		const last = points[points.length - 1];
		if (last && calculateDistance(last, { lng, lat }) * 1000 < 0.01) continue;
		points.push({ lng, lat });
		metadata.push(point);
	}
	const path = createRoutePath(points);
	if (!path) throw new Error('The route needs two distinct points.');

	const boundaries = route.map((point, index) => {
		if (index === 0) return 0;
		if (index === route.length - 1) return path.length;
		if (!smooth) {
			let distance = 0;
			for (let i = 1; i <= index; i++) {
				distance += calculateDistance(route[i - 1].latlng || route[i - 1], route[i].latlng || route[i]) * 1000;
			}
			return distance;
		}
		const vertex = metadata.findIndex(item => item.originalIndex >= index);
		if (vertex < 0) throw new Error('The smooth route does not identify every route segment.');
		return path.cumulative[vertex];
	});

	const stations = route.flatMap((point, index) => ['waypoint', 'dummy'].includes(point.type || 'stop')
		? []
		: [{ distance: boundaries[index], name: point.placeName || point.name || `Station ${index + 1}`, index }]);
	const segments = route.map(() => []);
	if (smooth) metadata.forEach((point, vertex) => {
		if (Number.isInteger(point.originalIndex) && segments[point.originalIndex] && Number.isFinite(point.originalProgress)) {
			segments[point.originalIndex].push({ progress: point.originalProgress, distance: path.cumulative[vertex] });
		}
	});
	const underground = [];
	for (const station of stations) {
		const start = station.distance - PLATFORM_HALF_LENGTH;
		const end = station.distance + PLATFORM_HALF_LENGTH;
		const previous = underground[underground.length - 1];
		if (previous && start - previous.end <= RAMP_LENGTH * 2 + 50) previous.end = end;
		else underground.push({ start, end });
	}

	function heightAt(distance) {
		distance = Math.max(0, Math.min(path.length, distance));
		let depth = 0;
		for (const section of underground) {
			const offset = Math.max(section.start - distance, distance - section.end, 0);
			const t = Math.max(0, Math.min(1, offset / RAMP_LENGTH));
			const eased = t * t * (3 - 2 * t);
			depth = Math.max(depth, STATION_DEPTH * (1 - eased));
		}
		return depth ? -depth : 0;
	}

	const portals = [];
	for (const section of underground) {
		for (const [outer, inner, direction] of [
			[section.start - RAMP_LENGTH, section.start, 1],
			[section.end + RAMP_LENGTH, section.end, -1]
		]) {
			let surface = outer, tunnel = inner;
			for (let i = 0; i < 24; i++) {
				const middle = (surface + tunnel) / 2;
				if (heightAt(middle) < -TUNNEL_COVER_DEPTH) tunnel = middle;
				else surface = middle;
			}
			const coverDistance = (surface + tunnel) / 2;
			if (outer > 0 && outer < path.length) portals.push({ distance: outer, direction, coverDistance });
		}
	}

	function distanceAt(index, progress) {
		const segment = Math.max(0, Math.min(boundaries.length - 1, Number.isFinite(index) ? index : 0));
		if (segment === boundaries.length - 1) return path.length;
		const fraction = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
		if (!smooth) return boundaries[segment] + (boundaries[segment + 1] - boundaries[segment]) * fraction;
		const samples = segments[segment];
		if (!samples.length) return boundaries[segment] + (boundaries[segment + 1] - boundaries[segment]) * fraction;
		let low = 0;
		let high = samples.length;
		while (low < high) {
			const middle = (low + high) >>> 1;
			if (samples[middle].progress < fraction) low = middle + 1;
			else high = middle;
		}
		if (low === 0) return boundaries[segment];
		const previous = samples[low - 1];
		const next = samples[low] || { progress: 1, distance: boundaries[segment + 1] };
		const span = next.progress - previous.progress;
		const ratio = span > 0 ? (fraction - previous.progress) / span : 0;
		return previous.distance + (next.distance - previous.distance) * Math.max(0, Math.min(1, ratio));
	}

	function isTunnelAt(distance) {
		const position = Math.max(0, Math.min(path.length, distance));
		return underground.some(section => position >= section.start && position <= section.end
			? true : heightAt(position) <= -TUNNEL_COVER_DEPTH
				&& position >= section.start - RAMP_LENGTH && position <= section.end + RAMP_LENGTH);
	}

	return { path, stations, portals, boundaries, heightAt, distanceAt, isTunnelAt,
		isRampAt: distance => heightAt(distance) < -0.05 && !isTunnelAt(distance),
		gradeAt: distance => (heightAt(distance + 1) - heightAt(distance - 1)) / 2 };
}
