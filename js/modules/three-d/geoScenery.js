// Coordinates exposed by this module are always { lng, lat }; GeoJSON input is [lng, lat].
const PRIORITY = ['building', 'water', 'forest', 'farmland', 'grass'];
const GEOMETRY_TYPES = new Set([
	'Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon', 'GeometryCollection'
]);

export class GeoSceneryError extends Error {
	constructor(code, message) {
		super(message);
		this.name = 'GeoSceneryError';
		this.code = code;
	}
}

function invalid(message) {
	throw new GeoSceneryError('INVALID_DATA', message);
}

function checkPoint(point, label) {
	if (!point || !Number.isFinite(point.lng) || !Number.isFinite(point.lat) ||
		point.lng < -180 || point.lng > 180 || point.lat < -90 || point.lat > 90) {
		invalid(`${label} must have finite longitude and latitude in range`);
	}
}

function deltaLongitude(from, to) {
	return ((to - from + 540) % 360) - 180;
}

function positionPoint(position, label) {
	if (!Array.isArray(position) || position.length < 2 ||
		position.some(value => !Number.isFinite(value))) invalid(`${label} is invalid`);
	const point = { lng: position[0], lat: position[1] };
	checkPoint(point, label);
	return point;
}

function normalizeRing(ring, label) {
	if (!Array.isArray(ring) || ring.length < 4) invalid(`${label} must contain at least four positions`);
	const result = ring.map((position, index) => Object.freeze(positionPoint(position, `${label} position ${index}`)));
	const first = result[0];
	const last = result[result.length - 1];
	if (first.lng !== last.lng || first.lat !== last.lat) invalid(`${label} must be closed`);
	let area = 0;
	let x = 0;
	for (let i = 1; i < result.length; i++) {
		const nextX = x + deltaLongitude(result[i - 1].lng, result[i].lng);
		area += x * (result[i].lat - first.lat) - nextX * (result[i - 1].lat - first.lat);
		x = nextX;
	}
	if (Math.abs(x) > 1e-9 || Math.abs(area) < 1e-16) {
		invalid(`${label} is degenerate or winds around the globe`);
	}
	return Object.freeze(result);
}

function normalizePolygon(coordinates, label) {
	if (!Array.isArray(coordinates) || coordinates.length === 0) invalid(`${label} must contain an outer ring`);
	const rings = coordinates.map((ring, i) => normalizeRing(ring, `${label} ring ${i}`));
	return Object.freeze({ outer: rings[0], holes: Object.freeze(rings.slice(1)) });
}

function normalizeGeometry(geometry, label) {
	if (geometry === null) return [];
	if (!geometry || typeof geometry !== 'object' || !GEOMETRY_TYPES.has(geometry.type)) {
		invalid(`${label} has an invalid geometry`);
	}
	if (geometry.type === 'GeometryCollection') {
		if (!Array.isArray(geometry.geometries)) invalid(`${label} has an invalid geometry collection`);
		return geometry.geometries.flatMap((item, i) => {
			if (item === null) invalid(`${label} contains a null geometry`);
			return normalizeGeometry(item, `${label} geometry ${i}`);
		});
	}
	if (!Array.isArray(geometry.coordinates)) invalid(`${label} has invalid coordinates`);
	if (geometry.type === 'Polygon') return [normalizePolygon(geometry.coordinates, label)];
	if (geometry.type === 'MultiPolygon') {
		if (geometry.coordinates.length === 0) invalid(`${label} has an empty multipolygon`);
		return geometry.coordinates.map((polygon, i) => normalizePolygon(polygon, `${label} polygon ${i}`));
	}
	const validateLine = (line, minLength) => {
		if (!Array.isArray(line) || line.length < minLength) invalid(`${label} has invalid coordinates`);
		line.forEach((position, i) => positionPoint(position, `${label} position ${i}`));
	};
	if (geometry.type === 'Point') positionPoint(geometry.coordinates, label);
	if (geometry.type === 'MultiPoint') validateLine(geometry.coordinates, 1);
	if (geometry.type === 'LineString') validateLine(geometry.coordinates, 2);
	if (geometry.type === 'MultiLineString') {
		if (!geometry.coordinates.length) invalid(`${label} has invalid coordinates`);
		geometry.coordinates.forEach(line => validateLine(line, 2));
	}
	return [];
}

function categoriesFor(properties) {
	const value = key => typeof properties[key] === 'string' ? properties[key].trim().toLowerCase() : '';
	const building = properties.building;
	const isBuilding = building === true || (typeof building === 'string' &&
		!['', 'no', 'false', '0'].includes(building.trim().toLowerCase()));
	const landuse = value('landuse');
	const natural = value('natural');
	const result = [];
	if (isBuilding) result.push('building');
	if (natural === 'water' || value('waterway') === 'riverbank' ||
		['reservoir', 'basin'].includes(landuse)) result.push('water');
	if (landuse === 'forest' || natural === 'wood') result.push('forest');
	if (['farmland', 'farm', 'orchard', 'vineyard'].includes(landuse)) result.push('farmland');
	if (['grass', 'meadow', 'recreation_ground'].includes(landuse) ||
		natural === 'grassland') result.push('grass');
	return result;
}

function positiveNumber(value, metres = false) {
	if (typeof value === 'string') {
		const match = value.trim().match(metres ? /^(\d+(?:\.\d+)?)\s*(?:m|meters?|metres?)?$/i : /^(\d+(?:\.\d+)?)$/);
		value = match ? Number(match[1]) : NaN;
	}
	return Number.isFinite(value) && value > 0 ? value : null;
}

// Returns 0 outside, 1 inside, 2 on an edge. Longitude is unwrapped per ring.
function ringLocation(point, ring) {
	let inside = false;
	let previousX = point.lng + deltaLongitude(point.lng, ring[0].lng);
	let previousY = ring[0].lat;
	for (let i = 1; i < ring.length; i++) {
		const x = previousX + deltaLongitude(ring[i - 1].lng, ring[i].lng);
		const y = ring[i].lat;
		const queryX = point.lng;
		const cross = (queryX - previousX) * (y - previousY) - (point.lat - previousY) * (x - previousX);
		const tolerance = 1e-10 * Math.max(1, Math.abs(x - previousX), Math.abs(y - previousY));
		if (Math.abs(cross) <= tolerance &&
			queryX >= Math.min(previousX, x) - tolerance && queryX <= Math.max(previousX, x) + tolerance &&
			point.lat >= Math.min(previousY, y) - tolerance && point.lat <= Math.max(previousY, y) + tolerance) return 2;
		if ((previousY > point.lat) !== (y > point.lat) &&
			queryX < previousX + (point.lat - previousY) * (x - previousX) / (y - previousY)) inside = !inside;
		previousX = x;
		previousY = y;
	}
	return inside ? 1 : 0;
}

function contains(point, polygon) {
	if (!ringLocation(point, polygon.outer)) return false;
	return !polygon.holes.some(hole => ringLocation(point, hole) !== 0);
}

// Exterior boundaries count as inside; hole boundaries count as outside.
export function pointInPolygon(point, polygon) {
	checkPoint(point, 'Point');
	if (!polygon || !Array.isArray(polygon.outer) || !Array.isArray(polygon.holes)) {
		invalid('Polygon must have normalized outer and holes rings');
	}
	// Revalidate caller-supplied normalized geometry as well as coordinates.
	const asPositions = ring => {
		if (!Array.isArray(ring)) invalid('Polygon ring must be an array');
		return ring.map(p => {
			checkPoint(p, 'Polygon position');
			return [p.lng, p.lat];
		});
	};
	return contains(point, normalizePolygon([polygon.outer, ...polygon.holes].map(asPositions), 'Polygon'));
}

/**
 * Normalize caller-provided GeoJSON. An empty FeatureCollection is valid;
 * null/undefined means unavailable, while malformed data raises INVALID_DATA.
 * Polygon coordinates crossing the date line use the shorter longitude arc.
 * Validation checks structure and non-degenerate rings, not polygon topology
 * (such as self-intersections or holes outside their outer ring).
 */
export function createGeoScenery(collection) {
	if (collection == null) throw new GeoSceneryError('UNAVAILABLE', 'Geographic scenery data is unavailable');
	if (typeof collection !== 'object' || collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
		invalid('Expected a GeoJSON FeatureCollection');
	}
	const records = [];
	collection.features.forEach((feature, index) => {
		if (!feature || feature.type !== 'Feature' || !Object.prototype.hasOwnProperty.call(feature, 'geometry') ||
			!Object.prototype.hasOwnProperty.call(feature, 'properties') ||
			(feature.properties != null && (typeof feature.properties !== 'object' || Array.isArray(feature.properties)))) {
			invalid(`Feature ${index} is invalid`);
		}
		if (feature.id !== undefined && typeof feature.id !== 'string' &&
			!(typeof feature.id === 'number' && Number.isFinite(feature.id))) invalid(`Feature ${index} has an invalid id`);
		const polygons = normalizeGeometry(feature.geometry, `Feature ${index}`);
		const properties = feature.properties || {};
		const categories = categoriesFor(properties);
		if (!polygons.length || !categories.length) return;
		records.push(Object.freeze({
			id: feature.id ?? null,
			categories: Object.freeze(categories),
			polygons: Object.freeze(polygons),
			heightMetres: categories.includes('building') ? positiveNumber(properties.height, true) : null,
			levels: categories.includes('building') ? positiveNumber(properties['building:levels']) : null
		}));
	});
	Object.freeze(records);
	const footprints = Object.freeze(records.filter(record => record.categories.includes('building')));
	return Object.freeze({
		records,
		footprints,
		classify(point) {
			checkPoint(point, 'Point');
			const matches = records.filter(record => record.polygons.some(polygon => contains(point, polygon)));
			const categories = PRIORITY.filter(category => matches.some(record => record.categories.includes(category)));
			return { category: categories[0] ?? null, categories, matches,
				footprints: matches.filter(record => record.categories.includes('building')) };
		}
	});
}
