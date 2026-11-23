import { expect, it } from 'vitest';
import { createRoutePath } from '../js/modules/three-d/routePath.js';
import { createHillField } from '../js/modules/three-d/hills.js';

it('keeps hills fixed across origin and cell changes and clear of the route', () => {
	const path = createRoutePath([{ lng: 78, lat: 11 }, { lng: 78.1, lat: 11 }]);
	const hills = createHillField(path);
	const first = hills({ lng: 78.0099, lat: 11 });
	const second = hills({ lng: 78.0101, lat: 11 });
	const byKey = new Map(second.map(hill => [hill.key, hill]));
	const shared = first.filter(hill => byKey.has(hill.key));
	expect(shared.length).toBeGreaterThan(10);
	for (const hill of shared) {
		expect(byKey.get(hill.key)).toEqual(hill);
		expect(path.project(hill).error).toBeGreaterThan(500);
	}
	expect(hills({ lng: 78.0099, lat: 11 })).toEqual(first);
});
