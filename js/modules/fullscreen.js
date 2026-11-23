// ====================================
// FULLSCREEN MODE
// ====================================
import state from './state.js';


// ===============================================
// 🖥️ FULLSCREEN MODE FUNCTIONALITY
// ===============================================

let isFullscreenMode = false;
let originalMapParent = null;
let originalMapStyles = {};

// Toggle fullscreen mode
function toggleFullscreenMode() {
	if (!state.isFullscreenMode) {
		enterFullscreenMode();
	} else {
		exitFullscreenMode();
	}
}

// Enter fullscreen mode
function enterFullscreenMode() {
	const mapElement = document.getElementById('map');
	const hudContainer = document.getElementById('hudContainer');
	
	if (!mapElement) {
		console.error('Map element not found');
		return;
	}
	
	// Store original state
	state.originalMapParent = mapElement.parentNode;
	state.originalMapStyles = {
		position: mapElement.style.position,
		top: mapElement.style.top,
		left: mapElement.style.left,
		width: mapElement.style.width,
		height: mapElement.style.height,
		zIndex: mapElement.style.zIndex,
		background: mapElement.style.background
	};
	
	// Apply fullscreen styles
	mapElement.classList.add('fullscreen-mode');
	
	// Show exit hint
	showFullscreenExitHint();
	
	// Update button text and icon
	const fullscreenBtn = document.getElementById('fullscreenBtn');
	if (fullscreenBtn) {
		fullscreenBtn.innerHTML = '<span>🚪</span><span>Exit Fullscreen</span>';
	}
	
	// Force map to resize to new dimensions
	if (window.map) {
		setTimeout(() => {
			window.map.updateSize();
			if (typeof window.loadHUDPositions === 'function') {
				window.loadHUDPositions();
			}
			console.log('📺 Fullscreen mode activated');
		}, 100);
	}
	
	// Add escape key listener
	document.addEventListener('keydown', handleEscapeKey);
	
	state.isFullscreenMode = true;
}

// Exit fullscreen mode
function exitFullscreenMode() {
	const mapElement = document.getElementById('map');
	
	if (!mapElement || !state.originalMapParent) {
		console.error('Cannot exit fullscreen: missing elements');
		return;
	}
	
	// Remove fullscreen class
	mapElement.classList.remove('fullscreen-mode');
	
	// Restore original styles
	Object.keys(state.originalMapStyles).forEach(property => {
		mapElement.style[property] = state.originalMapStyles[property] || '';
	});
	
	// Update button text and icon
	const fullscreenBtn = document.getElementById('fullscreenBtn');
	if (fullscreenBtn) {
		fullscreenBtn.innerHTML = '<span>🖥️</span><span>Fullscreen</span>';
	}
	
	// Remove exit button if it exists
	const existingBtn = document.querySelector('.fullscreen-exit-btn');
	if (existingBtn) {
		existingBtn.remove();
	}
	
	// Force map to resize to new dimensions
	if (window.map) {
		setTimeout(() => {
			window.map.updateSize();
			if (typeof window.loadHUDPositions === 'function') {
				window.loadHUDPositions();
			}
			console.log('📺 Fullscreen mode deactivated');
		}, 100);
	}
	
	// Remove escape key listener
	document.removeEventListener('keydown', handleEscapeKey);
	
	state.isFullscreenMode = false;
}

// Show persistent fullscreen exit button (clickable, stays visible)
function showFullscreenExitHint() {
	// Remove any existing button
	const existingBtn = document.querySelector('.fullscreen-exit-btn');
	if (existingBtn) existingBtn.remove();

	const btn = document.createElement('button');
	btn.className = 'fullscreen-exit-btn';
	btn.innerHTML = '✕';
	btn.title = 'Exit Fullscreen';
	btn.style.cssText = `
		position: fixed;
		bottom: 16px;
		right: 16px;
		z-index: 99999;
		width: 32px;
		height: 32px;
		border-radius: 50%;
		border: 1.5px solid rgba(255,255,255,0.3);
		background: rgba(0,0,0,0.45);
		color: rgba(255,255,255,0.8);
		font-size: 14px;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		backdrop-filter: blur(4px);
		transition: all 0.2s ease;
		opacity: 0.6;
	`;
	btn.onmouseover = () => {
		btn.style.background = 'rgba(220,38,38,0.8)';
		btn.style.transform = 'scale(1.1)';
		btn.style.opacity = '1';
	};
	btn.onmouseout = () => {
		btn.style.background = 'rgba(0,0,0,0.45)';
		btn.style.transform = 'scale(1)';
		btn.style.opacity = '0.6';
	};
	btn.onclick = () => exitFullscreenMode();

	document.body.appendChild(btn);
}

// Handle escape key press
function handleEscapeKey(event) {
	if (event.key === 'Escape' && state.isFullscreenMode) {
		exitFullscreenMode();
	}
}

// Handle F11 key for fullscreen toggle (common convention)
document.addEventListener('keydown', function(event) {
	// Check for F11 key specifically
	if (event.code === 'F11' || event.key === 'F11') {
		event.preventDefault(); // Prevent browser's native fullscreen
		event.stopPropagation();
		console.log('F11 pressed - toggling fullscreen mode');
		toggleFullscreenMode();
		return false;
	}
});

// Also handle keyup for better compatibility
document.addEventListener('keyup', function(event) {
	if (event.code === 'F11' || event.key === 'F11') {
		event.preventDefault();
		return false;
	}
});

// Auto-exit fullscreen on window resize (optional safety feature)
window.addEventListener('resize', function() {
	if (state.isFullscreenMode) {
		// Delay to allow fullscreen to stabilize
		setTimeout(() => {
			if (window.map) {
				window.map.updateSize();
			}
		}, 200);
	}
});


function formatDuration(durationMs) {
	const seconds = Math.floor(durationMs / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);

	const formattedHours = String(hours).padStart(2, '0');
	const formattedMinutes = String(minutes % 60).padStart(2, '0');
	const formattedSeconds = String(seconds % 60).padStart(2, '0');

	return `${formattedHours}:${formattedMinutes}:${formattedSeconds}`;
}



// Convert time (seconds) to HH:MM format
function formatTime(seconds) {
	let minutes = Math.floor(seconds / 60);
	let hours = Math.floor(minutes / 60);
	minutes = minutes % 60;
	return `${hours}:${minutes.toString().padStart(2, "0")}`;
}

export { toggleFullscreenMode, enterFullscreenMode, exitFullscreenMode };
export { showFullscreenExitHint, handleEscapeKey };