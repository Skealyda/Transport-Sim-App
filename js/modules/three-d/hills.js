const CELL_DEGREES = 0.01;
const LONGITUDE_CELLS = 360 / CELL_DEGREES;

function random(x, y, seed) {
	const value = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
	return value - Math.floor(value);
}

export function createHillField(path) {
	const cache = new Map();
	return origin => {
		const centerX = Math.floor((origin.lng + 180) / CELL_DEGREES);
		const centerY = Math.floor((origin.lat + 90) / CELL_DEGREES);
		const hills = [];
		for (let y = centerY - 3; y <= centerY + 3; y++) {
			if (y < 0 || y >= 180 / CELL_DEGREES) continue;
			for (let x = centerX - 3; x <= centerX + 3; x++) {
				const wrappedX = ((x % LONGITUDE_CELLS) + LONGITUDE_CELLS) % LONGITUDE_CELLS;
				const key = `${wrappedX}:${y}`;
				let hill = cache.get(key);
				if (!hill) {
					const point = {
						lng: (wrappedX + 0.2 + random(wrappedX, y, 0) * 0.6) * CELL_DEGREES - 180,
						lat: (y + 0.2 + random(wrappedX, y, 1) * 0.6) * CELL_DEGREES - 90
					};
					hill = {
						key, ...point,
						height: 80 + random(wrappedX, y, 2) * 130,
						width: 250 + random(wrappedX, y, 3) * 160,
						length: 230 + random(wrappedX, y, 4) * 100,
						awayFromTrack: path.project(point).error > 500
					};
					cache.set(key, hill);
				}
				if (hill.awayFromTrack) hills.push(hill);
			}
		}
		if (cache.size > 512) cache.clear();
		return hills;
	};
}
