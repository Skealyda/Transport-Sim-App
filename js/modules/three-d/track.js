import { calculateRotationAngle } from '../utils.js';
import { offsetPosition } from './pose.js';

// Two ground-following rails around the existing simulation route.
export function buildRailLines(points, gauge = 1.676) {
	const unique = [];
	for (const point of points) {
		const lng = point.lng ?? point.lon;
		const lat = point.lat;
		if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
		const last = unique[unique.length - 1];
		if (!last || last.lng !== lng || last.lat !== lat) unique.push({ lng, lat });
	}
	if (unique.length < 2) return null;

	const left = [];
	const right = [];
	for (let i = 0; i < unique.length; i++) {
		const previous = unique[Math.max(0, i - 1)];
		const current = unique[i];
		const next = unique[Math.min(unique.length - 1, i + 1)];
		const endsCoincide = previous.lng === next.lng && previous.lat === next.lat;
		const bearing = endsCoincide
			? calculateRotationAngle(current, next)
			: calculateRotationAngle(previous, next);
		const a = offsetPosition(current.lng, current.lat, bearing - 90, gauge / 2);
		const b = offsetPosition(current.lng, current.lat, bearing + 90, gauge / 2);
		left.push(a.lng, a.lat);
		right.push(b.lng, b.lat);
	}
	return { left, right };
}
