const timers = new Map();

export function showWorldNotice(id, text) {
	const element = document.getElementById(id);
	clearTimeout(timers.get(id));
	element.textContent = text;
	element.hidden = false;
	timers.set(id, setTimeout(() => {
		element.hidden = true;
		timers.delete(id);
	}, 5000));
}

export function clearWorldNotices() {
	for (const [id, timer] of timers) {
		clearTimeout(timer);
		document.getElementById(id).hidden = true;
	}
	timers.clear();
}
