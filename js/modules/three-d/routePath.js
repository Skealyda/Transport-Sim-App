import { calculateDistance, calculateRotationAngle } from '../utils.js';
import { offsetPosition } from './pose.js';

const METRES_PER_DEGREE = 111195;
const wrapLongitude = lng => ((lng + 540) % 360) - 180;
const longitudeDelta = (a, b) => wrapLongitude(b - a);

export function createRoutePath(points) {
	const vertices = [];
	const cumulative = [];
	for (const point of points) {
		const lng = point.lng ?? point.lon;
		const lat = point.lat;
		if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
		const previous = vertices[vertices.length - 1];
		const distance = previous ? calculateDistance(previous, { lng, lat }) * 1000 : 0;
		if (previous && distance < 0.01) continue;
		vertices.push({ lng, lat });
		cumulative.push((cumulative[cumulative.length - 1] || 0) + distance);
	}
	if (vertices.length < 2) return null;

	function pointAt(distance) {
		if (distance < 0) {
			const bearing = calculateRotationAngle(vertices[0], vertices[1]);
			return offsetPosition(vertices[0].lng, vertices[0].lat, bearing + 180, -distance);
		}
		const end = cumulative[cumulative.length - 1];
		if (distance > end) {
			const last = vertices.length - 1;
			const bearing = calculateRotationAngle(vertices[last - 1], vertices[last]);
			return offsetPosition(vertices[last].lng, vertices[last].lat, bearing, distance - end);
		}
		let low = 0;
		let high = cumulative.length - 1;
		while (low + 1 < high) {
			const mid = (low + high) >> 1;
			if (cumulative[mid] <= distance) low = mid;
			else high = mid;
		}
		const fraction = (distance - cumulative[low]) / (cumulative[high] - cumulative[low]);
		return {
			lat: vertices[low].lat + (vertices[high].lat - vertices[low].lat) * fraction,
			lng: wrapLongitude(vertices[low].lng + longitudeDelta(vertices[low].lng, vertices[high].lng) * fraction)
		};
	}

	function project(point, hint) {
		function search(start, end) {
			let best = null;
			for (let i = start; i < end; i++) {
				const a = vertices[i];
				const b = vertices[i + 1];
				const scaleX = METRES_PER_DEGREE * Math.cos(a.lat * Math.PI / 180);
				const dx = longitudeDelta(a.lng, b.lng) * scaleX;
				const dy = (b.lat - a.lat) * METRES_PER_DEGREE;
				const px = longitudeDelta(a.lng, point.lng) * scaleX;
				const py = (point.lat - a.lat) * METRES_PER_DEGREE;
				const fraction = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)));
				const error = Math.hypot(px - fraction * dx, py - fraction * dy);
				if (!best || error < best.error) {
					best = { index: i, error, distance: cumulative[i] + fraction * (cumulative[i + 1] - cumulative[i]) };
				}
			}
			return best;
		}
		const lastSegment = vertices.length - 1;
		if (!Number.isInteger(hint) || hint < 0 || hint >= lastSegment) return search(0, lastSegment);
		const local = search(Math.max(0, hint - 80), Math.min(lastSegment, hint + 81));
		return local.error > 200 ? search(0, lastSegment) : local;
	}

	function poseAt(distance, halfLength = 8) {
		const center = pointAt(distance);
		const rear = pointAt(distance - halfLength);
		const front = pointAt(distance + halfLength);
		return { ...center, bearing: calculateRotationAngle(rear, front) };
	}

	return { vertices, cumulative, pointAt, project, poseAt, length: cumulative[cumulative.length - 1] };
}
