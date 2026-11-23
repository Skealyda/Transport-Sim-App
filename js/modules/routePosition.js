// Sample the same route geometry used by the automatic movement engine.
export function sampleRoutePosition(route, smoothRoute, index, progress) {
	const from = route[index]?.latlng || route[index];
	const to = route[index + 1]?.latlng || route[index + 1];
	if (!from || !to) throw new Error('Route segment is unavailable.');
	if (!smoothRoute || smoothRoute.length < 3) {
		return { lng: from.lng + (to.lng - from.lng) * progress,
			lat: from.lat + (to.lat - from.lat) * progress, smoothIndex: null };
	}
	let low = 0, high = smoothRoute.length - 1;
	while (low < high) {
		const mid = (low + high) >>> 1;
		const point = smoothRoute[mid];
		if (point.originalIndex < index || (point.originalIndex === index && point.originalProgress < progress)) low = mid + 1;
		else high = mid;
	}
	const current = smoothRoute[low];
	const previous = smoothRoute[Math.max(0, low - 1)];
	let fraction = 0;
	if (current.originalIndex === previous.originalIndex && current.originalProgress !== previous.originalProgress) {
		fraction = (progress - previous.originalProgress) / (current.originalProgress - previous.originalProgress);
	} else if (current.originalIndex > index && previous.originalIndex === index) {
		const gap = 1 - previous.originalProgress;
		fraction = gap > 0.0001 ? (progress - previous.originalProgress) / gap : 1;
	} else if (current !== previous) {
		fraction = 1;
	}
	fraction = Math.max(0, Math.min(1, fraction));
	return { lng: previous.lng + (current.lng - previous.lng) * fraction,
		lat: previous.lat + (current.lat - previous.lat) * fraction, smoothIndex: low };
}
