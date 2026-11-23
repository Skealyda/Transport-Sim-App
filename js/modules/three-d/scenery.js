import { offsetPosition } from './pose.js';

const CELL_METRES = 80;

function random(cell, slot) {
	let value = Math.imul(cell ^ 0x6d2b79f5, 0x45d9f3b) ^ Math.imul(slot + 1, 0x27d4eb2d);
	value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
	return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

// Decorative scenery, not a land-cover or building dataset.
export function generateCorridorScenery(path, distance, sparse = false) {
	const trees = [];
	const buildings = [];
	const fields = [];
	const currentCell = Math.floor(distance / CELL_METRES);
	for (let cell = currentCell - 1; cell <= currentCell + 3; cell++) {
		for (let slot = 0; slot < (sparse ? 12 : 24); slot++) {
			const along = cell * CELL_METRES + 8 + random(cell, slot * 4) * 64;
			if (along < 0 || along > path.length) continue;
			const center = path.poseAt(along, 1);
			const side = slot % 2 ? 1 : -1;
			const offset = 14 + random(cell, slot * 4 + 1) * 165;
			const position = offsetPosition(center.lng, center.lat, center.bearing + side * 90, offset);
			trees.push({ ...position, height: 7 + random(cell, slot * 4 + 2) * 11, species: slot % 5 });
		}
		const along = cell * CELL_METRES + 40;
		if (along >= 0 && along <= path.length) {
			const center = path.poseAt(along, 1);
			const position = offsetPosition(center.lng, center.lat, center.bearing + (cell % 4 === 0 ? 90 : -90), 110);
			buildings.push({ ...position, bearing: center.bearing, height: 4 + random(cell, 90) * 7, variant: Math.abs(cell % 3) });
			for (const side of [-1, 1]) {
				const field = offsetPosition(center.lng, center.lat, center.bearing + side * 90, 260 + random(cell, side + 95) * 40);
				fields.push({ ...field, bearing: center.bearing, variant: Math.abs((cell + side) % 2) });
			}
		}
	}
	return { trees, buildings, fields };
}
