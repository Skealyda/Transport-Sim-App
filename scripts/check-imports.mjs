// Fails if any JS module is imported with a query string (e.g. './state.js?v=3').
// Mixed URLs make the browser load separate module instances with split state.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir) {
	return readdirSync(dir).flatMap(name => {
		const p = join(dir, name);
		return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : [];
	});
}

const pattern = /(?:from\s+|import\(\s*)['"][^'"]+\.js\?[^'"]*['"]/g;
const offenders = [];
for (const file of walk('js')) {
	const lines = readFileSync(file, 'utf8').split(/\r?\n/);
	lines.forEach((line, i) => {
		if (pattern.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
		pattern.lastIndex = 0;
	});
}

if (offenders.length) {
	console.error('Versioned module imports found (use plain paths):\n' + offenders.join('\n'));
	process.exit(1);
}
console.log('OK: no versioned module imports');
