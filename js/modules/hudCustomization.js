// ====================================
// HUD CUSTOMIZATION, DRAGGING & SETTINGS
// ====================================
import state from './state.js';
import { setMapTheme, setHtmlTheme } from './themePanel.js';

// Function to update existing route color
function updateExistingRouteColor() {
	if (state.vectorSource) {
		const features = state.vectorSource.getFeatures();
		features.forEach(feature => {
			const geometry = feature.getGeometry();
			if (geometry instanceof ol.geom.LineString) {
				// This is a route line, update its color
				feature.setStyle(new ol.style.Style({
					stroke: new ol.style.Stroke({
						color: state.routeColor,
						width: 8,
						lineCap: 'round',
						lineJoin: 'round',
					})
				}));
			}
		});
	}
}

// ====================================
// HUD THEME MANAGEMENT
// ====================================
let currentHUDTheme = 'default';

function changeHUDTheme(theme) {
	// Remove previous theme class from HUD container
	const hudContainer = document.getElementById('hudContainer');
	if (hudContainer) {
		// Remove all theme classes
		hudContainer.className = hudContainer.className.replace(/hud-theme-\w+/g, '');
		// Add new theme class
		hudContainer.classList.add(`hud-theme-${theme}`);
	}

	// Update theme selector buttons
	document.querySelectorAll('.theme-btn').forEach(btn => {
		btn.classList.remove('active');
		if (btn.dataset.theme === theme) {
			btn.classList.add('active');
		}
	});

	// Store current theme
	state.currentHUDTheme = theme;

	// Save to localStorage
	localStorage.setItem('hudTheme', theme);
	localStorage.setItem('hudThemeManuallySet', 'true');

	console.log(`🎨 HUD theme changed to: ${theme}`);
}

// HUD Opacity Control
function updateHUDOpacity(opacity) {
	const hudContainer = document.getElementById('hudContainer');
	if (hudContainer) {
		hudContainer.style.opacity = opacity;
	}

	// Update display value
	const hudOpacityValue = document.getElementById('hudOpacityValue');
	if (hudOpacityValue) {
		hudOpacityValue.textContent = Math.round(opacity * 100) + '%';
	}

	// Save to localStorage
	localStorage.setItem('hudOpacity', opacity);

	console.log(`🔍 HUD opacity changed to: ${Math.round(opacity * 100)}%`);
}

// Initialize HUD opacity on page load
function initializeHUDOpacity() {
	const savedOpacity = localStorage.getItem('hudOpacity') || '1.0';
	const slider = document.getElementById('hudOpacitySlider');
	if (slider) {
		slider.value = savedOpacity;
		updateHUDOpacity(parseFloat(savedOpacity));
	}
}

// Initialize HUD theme on page load
// Save all theme and customization settings
function saveAllSettings() {
	const settings = {
		mapTheme: state.currentMapTheme,
		htmlTheme: state.currentHtmlTheme,
		hudBgOpacity: document.getElementById('hudBgOpacity')?.value || 50,
		hudTextOpacity: document.getElementById('hudTextOpacity')?.value || 100,
		hudBackgroundStyle: document.getElementById('hudBackgroundStyle')?.value || 'gradient',
		gforceLimit: document.getElementById('gforceLimit')?.value || 5
	};

	// Save each setting individually for easier access
	Object.keys(settings).forEach(key => {
		localStorage.setItem(key, settings[key]);
	});

	// Also save as a combined object for backup
	localStorage.setItem('allSettings', JSON.stringify(settings));
}

// Load all theme and customization settings
function loadAllSettings() {
	// Load map theme
	const savedMapTheme = localStorage.getItem('mapTheme');
	if (savedMapTheme && savedMapTheme !== state.currentMapTheme) {
		setMapTheme(savedMapTheme);
		// Update dropdown to show current selection
		const mapThemeSelect = document.getElementById('mapThemeSelect');
		if (mapThemeSelect) mapThemeSelect.value = savedMapTheme;
	}

	// Load HTML theme
	const savedHtmlTheme = localStorage.getItem('htmlTheme');
	if (savedHtmlTheme && savedHtmlTheme !== state.currentHtmlTheme) {
		setHtmlTheme(savedHtmlTheme);
		// Update dropdown to show current selection
		const mainThemeSelect = document.getElementById('mainThemeSelect');
		if (mainThemeSelect) mainThemeSelect.value = savedHtmlTheme;
	}

	// Load HUD settings
	const hudBgOpacity = localStorage.getItem('hudBgOpacity') || '92';
	const hudTextOpacity = localStorage.getItem('hudTextOpacity') || '100';
	const gforceLimit = localStorage.getItem('gforceLimit') || '0.5';
	const savedStationDelay = localStorage.getItem('stationDelayTime') || '24';

	// Apply station delay setting
	state.stationDelayTime = parseFloat(savedStationDelay);
	if (document.getElementById('stationDelay')) {
		document.getElementById('stationDelay').value = savedStationDelay;
		document.getElementById('stationDelayValue').textContent = savedStationDelay + 's';
	}

	// Apply basic HUD settings (colors and background handled by loadHUDCustomizationSettings)
	if (document.getElementById('hudBgOpacity')) {
		document.getElementById('hudBgOpacity').value = hudBgOpacity;
		updateHUDBgOpacity(hudBgOpacity);
	}

	if (document.getElementById('hudTextOpacity')) {
		document.getElementById('hudTextOpacity').value = hudTextOpacity;
		updateHUDTextOpacity(hudTextOpacity);
	}

	// Load G-Force limit
	if (document.getElementById('gForceLimitSlider')) {
		document.getElementById('gForceLimitSlider').value = gforceLimit;
		updateGForceLimit(gforceLimit);
	}

	if (document.getElementById('gforceLimit')) {
		document.getElementById('gforceLimit').value = gforceLimit;
		updateGForceLimit(gforceLimit);
	}
}

// Load HUD element positions (called after HUD system is initialized)
let layoutObserver = null;

function getHUDLayoutContainer() {
	return document.getElementById('map') || document.getElementById('hudContainer');
}

function getHUDElementKey(element) {
	if (!element) return 'unknown';
	if (element.dataset && element.dataset.hudKey) return element.dataset.hudKey;
	const classes = Array.from(element.classList || []);
	const panelClass = classes.find(cls => cls.endsWith('-panel') && cls !== 'hud-panel');
	return panelClass || element.id || classes.find(cls => cls !== 'hud-panel') || 'unknown';
}

function clampOffset(value, limit) {
	const numeric = Number(value) || 0;
	return Math.max(0, Math.min(limit, numeric));
}

function applyHUDElementLayout(element, position) {
	if (!element || !position) return;

	if (position.anchorX || position.anchorY) {
		const widthPx = position.widthPx ? Math.round(position.widthPx) : element.offsetWidth;
		const heightPx = position.heightPx ? Math.round(position.heightPx) : element.offsetHeight;
		element.style.left = 'auto';
		element.style.right = 'auto';
		element.style.top = 'auto';
		element.style.bottom = 'auto';
		element.style.transform = '';

		const anchorX = position.anchorX || 'left';
		const anchorY = position.anchorY || 'top';
		const xPx = position.xPx !== undefined ? position.xPx : Math.round((Number(position.xPct) || 0) * window.innerWidth / 100);
		const yPx = position.yPx !== undefined ? position.yPx : Math.round((Number(position.yPct) || 0) * window.innerHeight / 100);

		if (anchorX === 'center') {
			element.style.left = `calc(50% + ${Math.round(xPx)}px - ${Math.round(widthPx / 2)}px)`;
		} else {
			element.style[anchorX] = `${Math.max(0, Math.round(xPx))}px`;
		}

		if (anchorY === 'center') {
			element.style.top = `calc(50% + ${Math.round(yPx)}px - ${Math.round(heightPx / 2)}px)`;
		} else {
			element.style[anchorY] = `${Math.max(0, Math.round(yPx))}px`;
		}

		if (position.widthPx) element.style.width = `${widthPx}px`;
		if (position.heightPx) element.style.height = `${heightPx}px`;
		if (!element.style.position || element.style.position === 'static') {
			element.style.position = 'absolute';
		}
		return;
	}

	if (position.right !== undefined && position.right !== '') {
		element.style.setProperty('right', position.right, 'important');
		element.style.setProperty('left', 'auto', 'important');
	} else if (position.left !== undefined && position.left !== '') {
		element.style.setProperty('left', position.left, 'important');
		element.style.setProperty('right', 'auto', 'important');
	}
	if (position.bottom !== undefined && position.bottom !== '') {
		element.style.setProperty('bottom', position.bottom, 'important');
		element.style.setProperty('top', 'auto', 'important');
	} else if (position.top !== undefined && position.top !== '') {
		element.style.setProperty('top', position.top, 'important');
	}
	if (position.width !== undefined && position.width !== '') {
		element.style.setProperty('width', position.width, 'important');
	}
	if (position.height !== undefined && position.height !== '') {
		element.style.setProperty('height', position.height, 'important');
	}
	if (!element.style.position || element.style.position === 'static') {
		element.style.setProperty('position', 'absolute', 'important');
	}
}

function loadHUDPositions() {
	const savedPositions = localStorage.getItem('hudElementPositions');
	let positions = {};

	if (savedPositions) {
		try {
			const saved = JSON.parse(savedPositions);
			positions = saved;
		} catch (error) {
			console.warn('❌ Error loading saved HUD positions, using defaults:', error);
		}
	}

	state.hudDragData.positions = positions;

	document.querySelectorAll('.hud-panel').forEach(element => {
		for (const property of ['left', 'right', 'top', 'bottom', 'width', 'height', 'min-width', 'min-height', 'transform']) {
			element.style.removeProperty(property);
		}
		const elementType = getHUDElementKey(element);
		if (positions[elementType]) {
			applyHUDElementLayout(element, positions[elementType]);
		}
	});
	constrainHUDPositions();
	if (!layoutObserver) {
		layoutObserver = new ResizeObserver(() => loadHUDPositions());
		layoutObserver.observe(getHUDLayoutContainer());
	}
}

function constrainHUDPositions() {
	const container = getHUDLayoutContainer().getBoundingClientRect();
	const scale = Number(localStorage.getItem('hudScale') || 100) / 100;
	document.querySelectorAll('.hud-panel').forEach(panel => {
		if (!panel.offsetWidth || !panel.offsetHeight) return;
		let rect = panel.getBoundingClientRect();
		if (rect.width > container.width) {
			panel.style.minWidth = '0';
			panel.style.width = `${container.width / scale}px`;
		}
		if (rect.height > container.height) {
			panel.style.minHeight = '0';
			panel.style.height = `${container.height / scale}px`;
		}
		rect = panel.getBoundingClientRect();
		const dx = rect.left < container.left ? container.left - rect.left
			: rect.right > container.right ? container.right - rect.right : 0;
		const dy = rect.top < container.top ? container.top - rect.top
			: rect.bottom > container.bottom ? container.bottom - rect.bottom : 0;
		if (dx) {
			panel.style.left = `${panel.offsetLeft + dx / scale}px`;
			panel.style.right = 'auto';
		}
		if (dy) {
			panel.style.top = `${panel.offsetTop + dy / scale}px`;
			panel.style.bottom = 'auto';
		}
	});
	// The G-meter stacks above the bottom-anchored speedometer; if a saved layout makes them overlap,
	// lift it above the speedometer when there is room, otherwise drop it below.
	const speedPanel = document.querySelector('.speed-panel').getBoundingClientRect();
	const gforce = document.querySelector('.gforce-panel');
	const gforceRect = gforce.getBoundingClientRect();
	if (speedPanel.right > gforceRect.left && speedPanel.left < gforceRect.right
		&& speedPanel.bottom > gforceRect.top && speedPanel.top < gforceRect.bottom) {
		const above = speedPanel.top - container.top - gforceRect.height - 8;
		const top = above >= 0 ? above
			: Math.min(container.height - gforceRect.height, speedPanel.bottom - container.top + 8);
		gforce.style.top = `${top / scale}px`;
		gforce.style.bottom = 'auto';
	}
}

// Auto-save settings when changed
function setupAutoSave() {
	// Save settings when any control changes
	document.addEventListener('change', function (e) {
		if (e.target.matches('#hudBgOpacity, #hudTextOpacity, #hudBackgroundStyle, #gforceLimit')) {
			saveAllSettings();
		}
	});

	// Save settings when sliders are moved
	document.addEventListener('input', function (e) {
		if (e.target.matches('#hudBgOpacity, #hudTextOpacity, #gforceLimit')) {
			saveAllSettings();
		}
	});
}

function initializeHUDTheme() {
	// Check for saved theme or use default
	const savedTheme = localStorage.getItem('hudTheme') || 'solid';
	changeHUDTheme(savedTheme);
}


// Immediate global assignment for HTML onclick handlers


// HUD Customization Functions
function showHUDCustomizeDialog() {
	console.log('🎮 showHUDCustomizeDialog called');

	// Close theme panel if it's open
	if (state.themePanelOpen) {
		if (typeof window.toggleThemePanel === 'function') {
			window.toggleThemePanel();
		}
	}

	const dialog = document.getElementById('hudCustomizeDialog');
	if (!dialog) {
		console.error('❌ hudCustomizeDialog element not found!');
		return;
	}

	dialog.style.display = 'block';

	// Load current settings
	const primaryColor = localStorage.getItem('hudPrimaryColor') || '#00ff88';
	const secondaryColor = localStorage.getItem('hudSecondaryColor') || '#00ffff';
	const bgOpacity = localStorage.getItem('hudBgOpacity') || '92';
	const textOpacity = localStorage.getItem('hudTextOpacity') || '100';
	const backgroundStyle = localStorage.getItem('hudBackgroundStyle') || 'gradient';
	const backgroundCustomColor = localStorage.getItem('hudBackgroundCustomColor') || '#001122';

	// Update UI elements
	const primaryColorEl = document.getElementById('hudPrimaryColor');
	const secondaryColorEl = document.getElementById('hudSecondaryColor');
	const bgOpacityEl = document.getElementById('hudBgOpacity');
	const textOpacityEl = document.getElementById('hudTextOpacity');
	const backgroundStyleEl = document.getElementById('hudBackgroundStyle');
	const backgroundColorEl = document.getElementById('hudBackgroundColor');

	if (primaryColorEl) {
		primaryColorEl.value = primaryColor;
		document.getElementById('hudPrimaryColorCode').textContent = primaryColor;
	}
	if (secondaryColorEl) {
		secondaryColorEl.value = secondaryColor;
		document.getElementById('hudSecondaryColorCode').textContent = secondaryColor;
	}
	if (bgOpacityEl) {
		bgOpacityEl.value = bgOpacity;
		document.getElementById('hudBgOpacityValue').textContent = bgOpacity + '%';
	}
	if (textOpacityEl) {
		textOpacityEl.value = textOpacity;
		document.getElementById('hudTextOpacityValue').textContent = textOpacity + '%';
	}
	if (backgroundStyleEl) {
		backgroundStyleEl.value = backgroundStyle;
	}
	if (backgroundColorEl) {
		backgroundColorEl.value = backgroundCustomColor;
		document.getElementById('hudBackgroundColorCode').textContent = backgroundCustomColor;
	}

	// Apply the background style to show/hide custom color section
	if (typeof updateHUDBackground === 'function') {
		updateHUDBackground(backgroundStyle);
	}

	// Refresh profile dropdown with saved profiles
	_refreshProfileDropdown();

	// Restore glow slider state
	const savedGlow = localStorage.getItem('hudGlowIntensity');
	if (savedGlow !== null) {
		const g = document.getElementById('hudGlowSlider');
		if (g) g.value = savedGlow;
		const gv = document.getElementById('hudGlowValue');
		if (gv) gv.textContent = savedGlow + '%';
	}
}


function closeHUDCustomizeDialog() {
	document.getElementById('hudCustomizeDialog').style.display = 'none';
}


function updateHUDBgOpacity(opacity) {
	const opacityValue = opacity / 100;
	document.getElementById('hudContainer').style.setProperty('--hud-background-opacity', opacityValue);

	// Apply only to background, not text
	const style = document.createElement('style');
	style.id = 'hudBgOpacityStyle';

	// Remove existing style
	const existing = document.getElementById('hudBgOpacityStyle');
	if (existing) existing.remove();

	style.textContent = `
		.hud-panel {
			background: linear-gradient(135deg, rgba(16, 27, 42, ${opacityValue}), rgba(24, 41, 60, ${opacityValue})) !important;
		}
	`;

	document.head.appendChild(style);
	document.getElementById('hudBgOpacityValue').textContent = opacity + '%';
	localStorage.setItem('hudBgOpacity', opacity);
}

function updateHUDTextOpacity(opacity) {
	const opacityValue = opacity / 100;

	// Apply only to text elements, not backgrounds
	const style = document.createElement('style');
	style.id = 'hudTextOpacityStyle';

	// Remove existing style
	const existing = document.getElementById('hudTextOpacityStyle');
	if (existing) existing.remove();

	style.textContent = `
		.speed-value, .speed-unit, .gforce-value, .gforce-label,
		.waypoint-distance, .waypoint-label, .location-coordinates,
		.location-landmark, .info-value, .info-label, .weather-main,
		.weather-temp, .detail-value, .detail-label, .vehicle-condition,
		.gforce-limit-value, .gforce-limit-desc, .gforce-limit-label {
			opacity: ${opacityValue} !important;
		}
	`;

	document.head.appendChild(style);
	document.getElementById('hudTextOpacityValue').textContent = opacity + '%';
	localStorage.setItem('hudTextOpacity', opacity);
}

// Global variable for station delay time (in seconds)
let stationDelayTime = 24;

// Station Delay Control Function
function updateStationDelay(delay) {
	state.stationDelayTime = parseFloat(delay);
	const valueElement = document.getElementById('stationDelayValue');
	if (valueElement) {
		valueElement.textContent = delay + 's';
	}
	localStorage.setItem('stationDelayTime', delay);
	console.log(`🚉 Station delay updated to ${delay} seconds`);
}

// Update station delay display (for real-time slider feedback)
function updateStationDelayDisplay(delay) {
	const valueElement = document.getElementById('stationDelayValue');
	if (valueElement) {
		valueElement.textContent = delay + 's';
	}
}

// Enhanced HUD Background Color Customization
function updateHUDBackgroundColor(color) {
	// Remove existing styles first
	const existingStyles = document.querySelectorAll('#hudCustomBackgroundColorStyle');
	existingStyles.forEach(style => style.remove());

	const style = document.createElement('style');
	style.id = 'hudCustomBackgroundColorStyle';

	// MAXIMUM CSS SPECIFICITY - Override everything
	style.textContent = `
		/* Primary HUD panels with maximum specificity */
		.hud-panel,
		.hud-panel.waypoint-panel,
		.hud-panel.info-panel,
		.hud-panel.speed-panel,
		.hud-panel.gforce-panel,
		.hud-panel.vehicle-panel,
		.hud-panel.location-panel,
		.hud-panel.fuel-efficiency-panel,
		.hud-panel.weather-panel {
			background: ${color} !important;
			background-color: ${color} !important;
			backdrop-filter: blur(10px) !important;
		}
		
		/* Force application on all possible selectors */
		[class*="hud-panel"] {
			background: ${color} !important;
			background-color: ${color} !important;
		}
		
		/* Specific panel types */
		.waypoint-panel,
		.info-panel,
		.speed-panel,
		.gforce-panel,
		.vehicle-panel,
		.location-panel,
		.fuel-efficiency-panel,
		.weather-panel {
			background: ${color} !important;
			background-color: ${color} !important;
		}
	`;

	document.head.appendChild(style);

	// Force update the color display
	const colorDisplayEl = document.getElementById('hudBackgroundColorCode');
	if (colorDisplayEl) {
		colorDisplayEl.textContent = color;
	}

	// Save to localStorage
	localStorage.setItem('hudBackgroundCustomColor', color);

	// FORCE immediate visual update by directly setting inline styles as backup
	setTimeout(() => {
		const panels = document.querySelectorAll('.hud-panel');
		panels.forEach(panel => {
			panel.style.setProperty('background', color, 'important');
			panel.style.setProperty('background-color', color, 'important');
		});
	}, 100);
}

// Show/Hide background color section based on style selection
function updateHUDBackground(style) {
	console.log(`🎨 updateHUDBackground called with style: ${style}`);
	const bgStyle = document.createElement('style');
	bgStyle.id = 'hudBackgroundStyle';

	// Remove existing style
	const existing = document.getElementById('hudBackgroundStyle');
	if (existing) {
		console.log(`🗑️ Removing existing background style`);
		existing.remove();
	}

	// Show/hide custom color section
	const colorSection = document.getElementById('hudBackgroundColorSection');
	if (colorSection) {
		if (style === 'custom-color') {
			console.log(`🎨 Custom color style detected, showing color section`);
			colorSection.style.display = 'block';
			// Apply custom color if available
			const savedColor = localStorage.getItem('hudBackgroundCustomColor') || '#001122';
			console.log(`🎨 Loading custom color: ${savedColor}`);
			updateHUDBackgroundColor(savedColor);
			const colorInput = document.getElementById('hudBackgroundColor');
			if (colorInput) colorInput.value = savedColor;
			localStorage.setItem('hudBackgroundStyle', style);
			console.log(`✅ Custom color background applied: ${savedColor}`);
			return;
		} else {
			console.log(`🎨 Non-custom style, hiding color section`);
			colorSection.style.display = 'none';
		}
	}

	// Save the style selection
	localStorage.setItem('hudBackgroundStyle', style);

	let cssContent = '';

	switch (style) {
		case 'gradient':
			cssContent = `
				.hud-panel {
					background: linear-gradient(135deg, rgba(16, 27, 42, var(--hud-background-opacity, 0.92)), rgba(24, 41, 60, var(--hud-background-opacity, 0.92))) !important;
					backdrop-filter: blur(10px) !important;
				}
			`;
			break;
		case 'solid':
			cssContent = `
				.hud-panel {
					background: rgba(16, 27, 42, var(--hud-background-opacity, 0.92)) !important;
					backdrop-filter: none !important;
				}
			`;
			break;
		case 'glass':
			cssContent = `
				.hud-panel {
					background: rgba(24, 41, 60, var(--hud-background-opacity, 0.92)) !important;
					backdrop-filter: blur(20px) saturate(180%) !important;
					border: 1px solid rgba(255, 255, 255, 0.2) !important;
				}
			`;
			break;
		case 'neon':
			cssContent = `
				.hud-panel {
					background: rgba(0, 0, 0, 0.8) !important;
					backdrop-filter: none !important;
					box-shadow: 0 0 30px rgba(0, 255, 136, 0.5), inset 0 0 30px rgba(0, 255, 136, 0.1) !important;
				}
			`;
			break;
		case 'minimal':
			cssContent = `
				.hud-panel {
					background: rgba(0, 0, 0, 0.3) !important;
					backdrop-filter: blur(5px) !important;
					border: 1px solid rgba(255, 255, 255, 0.1) !important;
				}
			`;
			break;
		case 'none':
			cssContent = `
				.hud-panel {
					background: transparent !important;
					backdrop-filter: none !important;
					border: none !important;
				}
			`;
			break;
		default:
			cssContent = `
				.hud-panel {
					background: linear-gradient(135deg, rgba(16, 27, 42, var(--hud-background-opacity, 0.92)), rgba(24, 41, 60, var(--hud-background-opacity, 0.92))) !important;
					backdrop-filter: blur(10px) !important;
				}
			`;
	}

	bgStyle.textContent = cssContent;
	document.head.appendChild(bgStyle);

	console.log(`🎨 HUD Background style applied: ${style}`);
}

// New Theme Gallery Functions
function selectHUDTheme(theme) {
	// Update visual selection
	document.querySelectorAll('.theme-card').forEach(card => {
		card.classList.remove('selected');
	});

	const selectedCard = document.querySelector(`[data-theme="${theme}"]`);
	if (selectedCard) {
		selectedCard.classList.add('selected');
	}

	// Update theme info
	const themeInfo = {
		'gradient': { name: 'Gradient Fusion', desc: 'Modern gradient overlay with dynamic blur effects and transparency for enhanced readability.' },
		'glass': { name: 'Glass Morphism', desc: 'Frosted glass effect with enhanced blur, saturation, and subtle borders for a premium feel.' },
		'neon': { name: 'Neon Glow', desc: 'Dark background with vibrant neon glow effects and enhanced contrast for night operation.' },
		'solid': { name: 'Solid Material', desc: 'Clean solid color background with medium opacity for consistent visibility.' },
		'minimal': { name: 'Minimal Clean', desc: 'Ultra-minimal transparent design with subtle borders for distraction-free operation.' },
		'none': { name: 'No Background', desc: 'Completely transparent HUD panels for maximum visibility of the underlying map.' },
		'custom-color': { name: 'Custom Color', desc: 'Personalized solid color background with user-defined color selection.' }
	};

	const info = themeInfo[theme] || themeInfo['gradient'];
	document.getElementById('selectedThemeName').textContent = info.name;
	document.getElementById('selectedThemeDescription').textContent = info.desc;

	// Handle custom color section
	const customSection = document.getElementById('customThemeSection');
	if (theme === 'custom-color') {
		if (customSection) customSection.style.display = 'block';
	} else {
		if (customSection) customSection.style.display = 'none';
		// Apply the theme directly
		updateHUDBackground(theme);
	}
}

function toggleCustomTheme() {
	const customSection = document.getElementById('customThemeSection');
	const toggleText = document.getElementById('customToggleText');

	if (customSection.style.display === 'none' || customSection.style.display === '') {
		customSection.style.display = 'block';
		toggleText.textContent = '🔼 Hide Custom';
	} else {
		customSection.style.display = 'none';
		toggleText.textContent = '🎨 Custom Color';
	}
}

function resetHUDTheme() {
	selectHUDTheme('gradient');
	updateHUDBackground('gradient');
}

// ========================================
// DRAGGABLE AND RESIZABLE HUD SYSTEM
// ========================================

let hudDragData = {
	isDragging: false,
	currentElement: null,
	offsetX: 0,
	offsetY: 0,
	positions: {},
	isEditMode: false
};

// Initialize HUD element dragging
// Initialize HUD element dragging and resizing
function initializeHUDDragging() {
	// Ensure hudDragData is available
	if (typeof state.hudDragData === 'undefined') {
		console.error('hudDragData is not defined during HUD initialization');
		return;
	}

	const hudElements = document.querySelectorAll('.hud-panel');
	// Initialize dragging for all HUD elements

	hudElements.forEach(element => {
		// Set initial position properties if not set
		if (!element.style.position) {
			element.style.position = 'absolute';
		}

		// Create drag handle (if function is available)
		if (typeof addDragHandle === 'function') {
			addDragHandle(element);
		} else {
			console.warn('addDragHandle function not available yet');
		}

		// Create resize handles (if function is available)
		if (typeof addResizeHandles === 'function') {
			addResizeHandles(element);
		} else {
			console.warn('addResizeHandles function not available yet');
		}

		ensureAlignToolbar(element);
	});

	// Global mouse events (if functions are available)
	if (typeof handleMouseMove === 'function' && typeof handleMouseUp === 'function') {
		document.addEventListener('mousemove', handleMouseMove);
		document.addEventListener('mouseup', handleMouseUp);
		// Mouse event handlers attached
	} else {
		console.warn('Mouse handler functions not available yet');
	}
}

function addDragHandle(element) {
	// Check if drag handle already exists
	let dragHandle = element.querySelector('.hud-drag-handle');
	if (!dragHandle) {
		// Create drag handle
		dragHandle = document.createElement('div');
		dragHandle.className = 'hud-drag-handle';
		dragHandle.style.cssText = `
			position: absolute;
			top: 4px;
			right: 4px;
			width: 20px;
			height: 20px;
			background: rgba(148, 163, 184, 0.3);
			border-radius: 4px;
			cursor: move;
			display: none;
			align-items: center;
			justify-content: center;
			font-size: 12px;
			color: #64748b;
			z-state.index: 1000;
		`;
		dragHandle.innerHTML = '⋮⋮';
		dragHandle.addEventListener('mousedown', (e) => startDragging(e, element));
		element.appendChild(dragHandle);
	}
}

function addResizeHandles(element) {
	// Check if resize handle already exists
	let resizeHandle = element.querySelector('.hud-resize-handle');
	if (!resizeHandle) {
		// Add resize handle to bottom-right corner
		resizeHandle = document.createElement('div');
		resizeHandle.className = 'hud-resize-handle';
		resizeHandle.style.cssText = `
			position: absolute;
			bottom: 4px;
			right: 4px;
			width: 16px;
			height: 16px;
			background: rgba(148, 163, 184, 0.5);
			border-radius: 3px;
			cursor: se-resize;
			display: none;
			align-items: center;
			justify-content: center;
			font-size: 10px;
			color: #64748b;
			z-state.index: 1000;
		`;
		resizeHandle.innerHTML = '⟲';
		resizeHandle.addEventListener('mousedown', (e) => startResizing(e, element));
		element.appendChild(resizeHandle);
	}
}

let resizeData = {
	isResizing: false,
	currentElement: null,
	startX: 0,
	startY: 0,
	startWidth: 0,
	startHeight: 0
};

function startResizing(e, element) {
	e.preventDefault();
	e.stopPropagation();

	state.resizeData.isResizing = true;
	state.resizeData.currentElement = element;
	state.resizeData.startX = e.clientX;
	state.resizeData.startY = e.clientY;

	const computedStyle = window.getComputedStyle(element);
	state.resizeData.startWidth = parseInt(computedStyle.width);
	state.resizeData.startHeight = parseInt(computedStyle.height);

	element.style.zIndex = '1000';
	document.body.style.cursor = 'se-resize';
}

function startDragging(e, element) {
	if (!state.hudDragData.isEditMode) return;

	e.preventDefault();
	e.stopPropagation();
	state.hudDragData.isDragging = true;
	state.hudDragData.currentElement = element;

	const rect = state.hudDragData.currentElement.getBoundingClientRect();
	state.hudDragData.offsetX = e.clientX - rect.left;
	state.hudDragData.offsetY = e.clientY - rect.top;

	// Highlight the element being dragged
	state.hudDragData.currentElement.style.outline = '2px solid #10b981';
	state.hudDragData.currentElement.style.zIndex = '1000';
}

function handleMouseMove(e) {
	if (state.hudDragData.isDragging && state.hudDragData.currentElement) {
		e.preventDefault();

		const mapContainer = getHUDLayoutContainer();
		const mapRect = mapContainer.getBoundingClientRect();

		// Calculate new position relative to map container
		let newX = e.clientX - mapRect.left - state.hudDragData.offsetX;
		let newY = e.clientY - mapRect.top - state.hudDragData.offsetY;

		// Constrain to map boundaries
		const elementRect = state.hudDragData.currentElement.getBoundingClientRect();
		newX = Math.max(0, Math.min(newX, mapRect.width - elementRect.width));
		newY = Math.max(0, Math.min(newY, mapRect.height - elementRect.height));

		// Apply position
		state.hudDragData.currentElement.style.right = 'auto';
		state.hudDragData.currentElement.style.bottom = 'auto';
		state.hudDragData.currentElement.style.left = newX + 'px';
		state.hudDragData.currentElement.style.top = newY + 'px';
	}

	if (state.resizeData.isResizing && state.resizeData.currentElement) {
		e.preventDefault();

		const deltaX = e.clientX - state.resizeData.startX;
		const deltaY = e.clientY - state.resizeData.startY;

		// Allow much smaller minimum sizes for better flexibility
		const newWidth = Math.max(50, state.resizeData.startWidth + deltaX);
		const newHeight = Math.max(25, state.resizeData.startHeight + deltaY);

		state.resizeData.currentElement.style.width = newWidth + 'px';
		state.resizeData.currentElement.style.height = newHeight + 'px';
	}
}

function handleMouseUp() {
	if (state.hudDragData.isDragging) {
		const draggedElement = state.hudDragData.currentElement;
		draggedElement.style.outline = 'none';
		draggedElement.style.zIndex = '';

		// Save position
		saveHUDElementPosition(draggedElement);

		// Re-apply anchor-based CSS immediately so fullscreen/layout changes preserve edges.
		const elementKey = getHUDElementKey(draggedElement);
		const savedPosition = state.hudDragData.positions[elementKey];
		if (savedPosition) {
			applyHUDElementLayout(draggedElement, savedPosition);
		}

		state.hudDragData.isDragging = false;
		state.hudDragData.currentElement = null;
	}

	if (state.resizeData.isResizing) {
		state.resizeData.currentElement.style.zIndex = '';
		document.body.style.cursor = '';

		// Save size
		saveHUDElementPosition(state.resizeData.currentElement);

		state.resizeData.isResizing = false;
		state.resizeData.currentElement = null;
	}
}

function saveHUDElementPosition(element) {
	const container = getHUDLayoutContainer();
	if (!container || !element) return;

	const elementType = getHUDElementKey(element);
	const containerRect = container.getBoundingClientRect();
	const rect = element.getBoundingClientRect();
	const leftPx = rect.left - containerRect.left;
	const rightPx = containerRect.right - rect.right;
	const topPx = rect.top - containerRect.top;
	const bottomPx = containerRect.bottom - rect.bottom;
	const centerOffsetX = (rect.left + rect.width / 2) - (containerRect.left + containerRect.width / 2);
	const centerOffsetY = (rect.top + rect.height / 2) - (containerRect.top + containerRect.height / 2);
	const xOptions = [
		{ anchor: 'left', value: leftPx },
		{ anchor: 'center', value: centerOffsetX },
		{ anchor: 'right', value: rightPx }
	];
	const yOptions = [
		{ anchor: 'top', value: topPx },
		{ anchor: 'center', value: centerOffsetY },
		{ anchor: 'bottom', value: bottomPx }
	];
	const anchorX = xOptions.reduce((best, option) => Math.abs(option.value) < Math.abs(best.value) ? option : best, xOptions[0]).anchor;
	const anchorY = yOptions.reduce((best, option) => Math.abs(option.value) < Math.abs(best.value) ? option : best, yOptions[0]).anchor;
	const xBase = anchorX === 'left' ? leftPx : anchorX === 'right' ? rightPx : centerOffsetX;
	const yBase = anchorY === 'top' ? topPx : anchorY === 'bottom' ? bottomPx : centerOffsetY;
	const position = {
		anchorX,
		anchorY,
		xPx: Math.round(xBase),
		yPx: Math.round(yBase),
		widthPx: Math.round(rect.width),
		heightPx: Math.round(rect.height)
	};

	state.hudDragData.positions[elementType] = position;
	localStorage.setItem('hudElementPositions', JSON.stringify(state.hudDragData.positions));
	console.log(`💾 Saved position for ${elementType}:`, position);
}

function loadHUDElementPosition(element) {
	const savedPositions = localStorage.getItem('hudElementPositions');
	if (savedPositions) {
		state.hudDragData.positions = JSON.parse(savedPositions);
		const elementType = getHUDElementKey(element);
		if (state.hudDragData.positions[elementType]) {
			const position = state.hudDragData.positions[elementType];
			applyHUDElementLayout(element, position);
			console.log(`📍 Restored position for ${elementType}:`, position);
		}
	}
}

function updateHUDLayoutStatus(message, isError = false) {
	const statusEl = document.getElementById('hudLayoutStatus');
	if (!statusEl) return;
	statusEl.textContent = message;
	statusEl.style.color = isError ? '#fca5a5' : '#94a3b8';
}

function buildHUDLayoutPayload() {
	const savedPositions = localStorage.getItem('hudElementPositions');
	const positions = savedPositions ? JSON.parse(savedPositions) : state.hudDragData.positions || {};
	return {
		version: 1,
		exportedAt: new Date().toISOString(),
		hudScale: localStorage.getItem('hudScale') || '100',
		positions
	};
}

function exportHUDLayoutToFile() {
	try {
		const payload = buildHUDLayoutPayload();
		const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		const stamp = new Date().toISOString().replace(/[:.]/g, '-');
		link.href = url;
		link.download = `transport-simulator-hud-layout-${stamp}.json`;
		document.body.appendChild(link);
		link.click();
		link.remove();
		URL.revokeObjectURL(url);
		updateHUDLayoutStatus('HUD layout exported to a JSON file.');
	} catch (error) {
		console.error('❌ Failed to export HUD layout:', error);
		updateHUDLayoutStatus('Failed to export HUD layout.', true);
	}
}

function importHUDLayoutFromPicker() {
	const fileInput = document.getElementById('hudLayoutImportInput');
	if (!fileInput) return;
	fileInput.value = '';
	fileInput.click();
}

function handleHUDLayoutImport(event) {
	const file = event && event.target && event.target.files ? event.target.files[0] : null;
	if (!file) return;

	const reader = new FileReader();
	reader.onload = () => {
		try {
			const payload = JSON.parse(reader.result);
			if (!payload || typeof payload !== 'object' || !payload.positions || typeof payload.positions !== 'object') {
				throw new Error('Invalid HUD layout file format');
			}

			localStorage.setItem('hudElementPositions', JSON.stringify(payload.positions));
			state.hudDragData.positions = payload.positions;
			if (payload.hudScale) {
				updateHUDScale(payload.hudScale);
			}
			loadHUDPositions();
			updateHUDLayoutStatus(`Imported HUD layout from ${file.name}.`);
		} catch (error) {
			console.error('❌ Failed to import HUD layout:', error);
			updateHUDLayoutStatus('Failed to import HUD layout file.', true);
		}
	};
	reader.readAsText(file);
}

function ensureAlignToolbar(element) {
	let toolbar = element.querySelector('.hud-align-toolbar');
	if (toolbar) return toolbar;

	toolbar = document.createElement('div');
	toolbar.className = 'hud-align-toolbar';
	toolbar.style.cssText = `
		position: absolute;
		left: 4px;
		top: 4px;
		display: none;
		grid-template-columns: repeat(5, auto);
		gap: 3px;
		padding: 3px;
		background: rgba(15, 23, 42, 0.92);
		border: 1px solid rgba(148, 163, 184, 0.25);
		border-radius: 6px;
		z-index: 1001;
	`;

	const presets = [];
	const rows = 5, cols = 5;
	const anchorMap = ['left', 'left', 'center', 'right', 'right'];
	const vAnchorMap = ['top', 'top', 'center', 'bottom', 'bottom'];
	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < cols; col++) {
			presets.push({
				label: '',
				row, col,
				anchorX: anchorMap[col],
				anchorY: vAnchorMap[row]
			});
		}
	}

	presets.forEach((preset, index) => {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.title = `Row ${preset.row + 1}, Col ${preset.col + 1}`;
		btn.style.cssText = `
			min-width: 22px;
			height: 20px;
			padding: 2px 4px;
			border: 1px solid rgba(96, 165, 250, 0.25);
			background: rgba(59, 130, 246, 0.12);
			color: #bfdbfe;
			border-radius: 3px;
			font-size: 9px;
			cursor: pointer;
			transition: all 0.15s ease;
		`;
		btn.addEventListener('mouseenter', () => {
			btn.style.background = 'rgba(96, 165, 250, 0.35)';
			btn.style.borderColor = 'rgba(96, 165, 250, 0.6)';
		});
		btn.addEventListener('mouseleave', () => {
			btn.style.background = 'rgba(59, 130, 246, 0.12)';
			btn.style.borderColor = 'rgba(96, 165, 250, 0.25)';
		});
		btn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			applyHUDAnchorPreset(element, preset.anchorX, preset.anchorY, preset.row, preset.col);
		});
		toolbar.appendChild(btn);
	});

	element.appendChild(toolbar);
	element.addEventListener('contextmenu', (event) => {
		if (!state.hudDragData.isEditMode) return;
		event.preventDefault();
		event.stopPropagation();
		const rect = element.getBoundingClientRect();
		const toolbarWidth = 110;
		const toolbarHeight = 88;
		const left = Math.max(4, Math.min(event.clientX - rect.left, rect.width - toolbarWidth - 4));
		const top = Math.max(4, Math.min(event.clientY - rect.top, rect.height - toolbarHeight - 4));
		toolbar.style.left = `${left}px`;
		toolbar.style.top = `${top}px`;
		toolbar.style.display = 'grid';
	});
	document.addEventListener('click', () => {
		toolbar.style.display = 'none';
	});
	return toolbar;
}

function applyHUDAnchorPreset(element, anchorX, anchorY, row, col) {
	if (!element) return;
	const container = getHUDLayoutContainer();
	if (!container) return;
	const containerRect = container.getBoundingClientRect();
	const rect = element.getBoundingClientRect();
	const widthPx = Math.round(rect.width);
	const heightPx = Math.round(rect.height);
	const containerWidth = Math.max(1, Math.round(containerRect.width));
	const containerHeight = Math.max(1, Math.round(containerRect.height));
	const edgeOffset = 10;
	const innerOffsetX = Math.max(edgeOffset, Math.round(containerWidth * 0.27));
	const innerOffsetY = Math.max(edgeOffset, Math.round(containerHeight * 0.27));
	element.style.left = 'auto';
	element.style.right = 'auto';
	element.style.top = 'auto';
	element.style.bottom = 'auto';
	element.style.transform = '';

	const xSlot = Math.max(0, Math.min(4, Number(col)));
	if (xSlot === 2) {
		element.style.left = `calc(50% - ${Math.round(widthPx / 2)}px)`;
	} else if (xSlot === 0) {
		element.style.left = `${edgeOffset}px`;
	} else if (xSlot === 1) {
		element.style.left = `${innerOffsetX}px`;
	} else if (xSlot === 3) {
		element.style.right = `${innerOffsetX}px`;
	} else {
		element.style.right = `${edgeOffset}px`;
	}

	const ySlot = Math.max(0, Math.min(4, Number(row)));
	if (ySlot === 2) {
		element.style.top = `calc(50% - ${Math.round(heightPx / 2)}px)`;
	} else if (ySlot === 0) {
		element.style.top = `${edgeOffset}px`;
	} else if (ySlot === 1) {
		element.style.top = `${innerOffsetY}px`;
	} else if (ySlot === 3) {
		element.style.bottom = `${innerOffsetY}px`;
	} else {
		element.style.bottom = `${edgeOffset}px`;
	}

	saveHUDElementPosition(element);
	const toolbar = element.querySelector('.hud-align-toolbar');
	if (toolbar) toolbar.style.display = 'none';
}


function toggleHUDEditMode() {
	if (typeof state.hudDragData === 'undefined') {
		console.error('hudDragData is not defined!');
		return;
	}

	console.log('🎯 Toggling HUD edit mode...');
	state.hudDragData.isEditMode = !state.hudDragData.isEditMode;
	const hudElements = document.querySelectorAll('.hud-panel');
	const toggleBtn = document.getElementById('toggleEditModeBtn');
	const hudDialog = document.getElementById('hudCustomizeDialog');

	if (state.hudDragData.isEditMode) {
		// Store current dialog state before hiding it
		state.hudDialogStateBeforeDrag = hudDialog && hudDialog.style.display === 'block';

		// Hide HUD customization dialog during drag mode
		if (hudDialog && state.hudDialogStateBeforeDrag) {
			hudDialog.style.display = 'none';
		}

		// Enable edit mode
		hudElements.forEach(element => {
			element.style.border = '2px dashed rgba(16, 185, 129, 0.5)';
			element.title = 'Drag to move • Resize from corner • Right-click to align';

			// Show drag and resize handles
			const dragHandle = element.querySelector('.hud-drag-handle');
			const resizeHandle = element.querySelector('.hud-resize-handle');
			if (dragHandle) dragHandle.style.display = 'flex';
			if (resizeHandle) resizeHandle.style.display = 'flex';
		});

		if (toggleBtn) {
			toggleBtn.textContent = '🔒 Lock HUD';
			toggleBtn.style.background = 'linear-gradient(135deg, #ef4444, #dc2626)';
		}

		console.log('✅ HUD edit mode ENABLED - Dialog temporarily hidden');
	} else {
		// Restore HUD customization dialog if it was open before drag mode
		if (hudDialog && state.hudDialogStateBeforeDrag) {
			hudDialog.style.display = 'block';
			state.hudDialogStateBeforeDrag = false; // Reset the state
		}

		// Disable edit mode
		hudElements.forEach(element => {
			element.style.border = 'none';
			element.title = '';

			// Hide drag and resize handles
			const dragHandle = element.querySelector('.hud-drag-handle');
			const resizeHandle = element.querySelector('.hud-resize-handle');
			const alignToolbar = element.querySelector('.hud-align-toolbar');
			if (dragHandle) dragHandle.style.display = 'none';
			if (resizeHandle) resizeHandle.style.display = 'none';
			if (alignToolbar) alignToolbar.style.display = 'none';
		});

		if (toggleBtn) {
			toggleBtn.textContent = '✏️ Edit HUD';
			toggleBtn.style.background = 'linear-gradient(135deg, #10b981, #059669)';
		}

		console.log('✅ HUD edit mode DISABLED - Dialog restored if needed');
	}
}

function resetHUDPositions() {
	localStorage.removeItem('hudElementPositions');
	state.hudDragData.positions = {};

	const hudPanels = document.querySelectorAll('.hud-panel');
	hudPanels.forEach(panel => {
		panel.style.left = '';
		panel.style.right = '';
		panel.style.top = '';
		panel.style.bottom = '';
		panel.style.width = '';
		panel.style.height = '';
	});

	loadHUDPositions();
	updateHUDLayoutStatus('HUD positions reset to defaults.');

	console.log('🔄 HUD positions reset to default');
}

function applyCustomHUDColors() {
	const primaryColor = localStorage.getItem('hudPrimaryColor') || '#00ff88';
	const secondaryColor = localStorage.getItem('hudSecondaryColor') || '#00ffff';

	const style = document.createElement('style');
	style.id = 'hudCustomColors';

	// Remove existing custom colors
	const existing = document.getElementById('hudCustomColors');
	if (existing) existing.remove();

	style.textContent = `
		.hud-panel {
			border-color: ${primaryColor} !important;
			color: ${primaryColor} !important;
			text-shadow: 0 0 10px ${primaryColor} !important;
			box-shadow: 0 0 20px ${primaryColor}40, inset 0 0 20px ${primaryColor}20 !important;
		}
		
		.speed-value, .gforce-value, .waypoint-distance {
			color: ${primaryColor} !important;
		}
		
		.line {
			background: linear-gradient(90deg, transparent 0%, ${secondaryColor}50 50%, transparent 100%) !important;
		}
		
		.vehicle-svg * {
			stroke: ${primaryColor} !important;
		}
		
		.compass-ring {
			border-color: ${primaryColor} !important;
		}
	`;

	document.head.appendChild(style);
}

function applyHUDPreset(preset) {
	let primaryColor, secondaryColor;

	switch (preset) {
		case 'cyber':
			primaryColor = '#00ff88';
			secondaryColor = '#00ffff';
			break;
		case 'matrix':
			primaryColor = '#22c55e';
			secondaryColor = '#10b981';
			break;
		case 'danger':
			primaryColor = '#ef4444';
			secondaryColor = '#f97316';
			break;
		case 'gold':
			primaryColor = '#f59e0b';
			secondaryColor = '#eab308';
			break;
	}

	// Update color pickers
	document.getElementById('hudPrimaryColor').value = primaryColor;
	document.getElementById('hudSecondaryColor').value = secondaryColor;

	// Apply colors
	updateHUDColor('primary', primaryColor);
	updateHUDColor('secondary', secondaryColor);
}

function resetHUDCustomization() {
	// Reset to defaults
	document.getElementById('hudPrimaryColor').value = '#00ff88';
	document.getElementById('hudSecondaryColor').value = '#00ffff';
	document.getElementById('hudBgOpacity').value = '92';
	document.getElementById('hudTextOpacity').value = '100';

	// Reset new color controls
	if (document.getElementById('hudAccentColor')) document.getElementById('hudAccentColor').value = '#ff4499';
	if (document.getElementById('hudWarningColor')) document.getElementById('hudWarningColor').value = '#ffaa00';
	if (document.getElementById('hudDangerColor')) document.getElementById('hudDangerColor').value = '#ff3333';
	if (document.getElementById('hudInfoColor')) document.getElementById('hudInfoColor').value = '#3399ff';
	if (document.getElementById('hudScale')) document.getElementById('hudScale').value = '100';

	// Apply defaults
	updateHUDColor('primary', '#00ff88');
	updateHUDColor('secondary', '#00ffff');
	updateHUDColor('accent', '#ff4499');
	updateHUDColor('warning', '#ffaa00');
	updateHUDColor('danger', '#ff3333');
	updateHUDColor('info', '#3399ff');
	updateHUDBgOpacity(92);
	updateHUDTextOpacity(100);
	updateHUDScale(100);

	// Clear localStorage
	localStorage.removeItem('hudPrimaryColor');
	localStorage.removeItem('hudSecondaryColor');
	localStorage.removeItem('hudAccentColor');
	localStorage.removeItem('hudWarningColor');
	localStorage.removeItem('hudDangerColor');
	localStorage.removeItem('hudInfoColor');
	localStorage.removeItem('hudBgOpacity');
	localStorage.removeItem('hudTextOpacity');
	localStorage.removeItem('hudScale');
}

// Comprehensive HUD Color System
function updateHUDColor(type, color) {
	const hudContainer = document.getElementById('hudContainer');
	if (!hudContainer) return;

	// Update the specific color and its display
	switch (type) {
		case 'primary':
			hudContainer.style.setProperty('--hud-primary-color', color);
			if (document.getElementById('hudPrimaryColorCode')) {
				document.getElementById('hudPrimaryColorCode').textContent = color;
			}
			localStorage.setItem('hudPrimaryColor', color);
			break;
		case 'secondary':
			hudContainer.style.setProperty('--hud-secondary-color', color);
			if (document.getElementById('hudSecondaryColorCode')) {
				document.getElementById('hudSecondaryColorCode').textContent = color;
			}
			localStorage.setItem('hudSecondaryColor', color);
			break;
		case 'accent':
			hudContainer.style.setProperty('--hud-accent-color', color);
			if (document.getElementById('hudAccentColorCode')) {
				document.getElementById('hudAccentColorCode').textContent = color;
			}
			localStorage.setItem('hudAccentColor', color);
			break;
		case 'warning':
			hudContainer.style.setProperty('--hud-warning-color', color);
			if (document.getElementById('hudWarningColorCode')) {
				document.getElementById('hudWarningColorCode').textContent = color;
			}
			localStorage.setItem('hudWarningColor', color);
			break;
		case 'danger':
			hudContainer.style.setProperty('--hud-danger-color', color);
			if (document.getElementById('hudDangerColorCode')) {
				document.getElementById('hudDangerColorCode').textContent = color;
			}
			localStorage.setItem('hudDangerColor', color);
			break;
		case 'info':
			hudContainer.style.setProperty('--hud-info-color', color);
			if (document.getElementById('hudInfoColorCode')) {
				document.getElementById('hudInfoColorCode').textContent = color;
			}
			localStorage.setItem('hudInfoColor', color);
			break;
	}

	// Apply comprehensive color styling
	applyComprehensiveHUDColors();
}

// Apply all HUD colors to elements
function applyComprehensiveHUDColors() {
	const style = document.createElement('style');
	style.id = 'comprehensiveHUDColors';

	// Remove existing style
	const existing = document.getElementById('comprehensiveHUDColors');
	if (existing) existing.remove();

	// Get colors from localStorage or defaults
	const primary = localStorage.getItem('hudPrimaryColor') || '#00ff88';
	const secondary = localStorage.getItem('hudSecondaryColor') || '#00ffff';
	const accent = localStorage.getItem('hudAccentColor') || '#ff4499';
	const warning = localStorage.getItem('hudWarningColor') || '#ffaa00';
	const danger = localStorage.getItem('hudDangerColor') || '#ff3333';
	const info = localStorage.getItem('hudInfoColor') || '#3399ff';

	style.textContent = `
		/* Primary color elements */
		.speed-value, .hud-panel .speed-value {
			color: ${primary} !important;
		}
		
		/* Secondary color elements */
		.gforce-value, .waypoint-distance {
			color: ${secondary} !important;
		}
		
		/* Accent color elements */
		.location-landmark, .info-value {
			color: ${accent} !important;
		}
		
		/* Warning color elements */
		.vehicle-condition[data-warning="true"] {
			color: ${warning} !important;
		}
		
		/* Danger color elements */
		.vehicle-condition[data-danger="true"], .emergency-alert {
			color: ${danger} !important;
		}
		
		/* Info color elements */
		.location-coordinates, .detail-value {
			color: ${info} !important;
		}
		
		/* Border and accent colors */
		.hud-panel {
			border-color: ${primary}40 !important;
		}
		
		.speed-panel::before {
			border-color: ${primary} !important;
		}
		
		.compass-ring {
			border-color: ${secondary}60 !important;
		}
		
		.gforce-bar-fill {
			background: linear-gradient(90deg, ${primary}, ${secondary}) !important;
		}
	`;

	document.head.appendChild(style);
}

// Color Preset Functions
function applyColorPreset(preset) {
	let colors = {};

	switch (preset) {
		case 'cyberpunk':
			colors = {
				primary: '#00ff88',
				secondary: '#00ffff',
				accent: '#ff0080',
				warning: '#ffff00',
				danger: '#ff3333',
				info: '#8888ff'
			};
			break;
		case 'neon':
			colors = {
				primary: '#ff0080',
				secondary: '#8000ff',
				accent: '#00ff80',
				warning: '#ff8000',
				danger: '#ff0040',
				info: '#0080ff'
			};
			break;
		case 'matrix':
			colors = {
				primary: '#00ff00',
				secondary: '#008800',
				accent: '#44ff44',
				warning: '#ffff00',
				danger: '#ff4444',
				info: '#88ff88'
			};
			break;
		case 'sunset':
			colors = {
				primary: '#ff6b35',
				secondary: '#f7931e',
				accent: '#ff8c42',
				warning: '#ffaa00',
				danger: '#ff4757',
				info: '#ffa726'
			};
			break;
	}

	// Apply all colors
	Object.keys(colors).forEach(type => {
		updateHUDColor(type, colors[type]);
		const colorInput = document.getElementById(`hud${type.charAt(0).toUpperCase() + type.slice(1)}Color`);
		if (colorInput) colorInput.value = colors[type];
	});

	console.log(`🎨 Applied ${preset} color preset`);
}

// HUD Scale Control
function updateHUDScale(scale) {
	const scaleValue = scale / 100;
	const hudContainer = document.getElementById('hudContainer');

	if (hudContainer) {
		hudContainer.style.transform = `scale(${scaleValue})`;
		hudContainer.style.transformOrigin = 'top left';
		hudContainer.style.width = `${100 / scaleValue}%`;
		hudContainer.style.height = `${100 / scaleValue}%`;
	}

	// Update display
	if (document.getElementById('hudScaleValue')) {
		document.getElementById('hudScaleValue').textContent = scale + '%';
	}

	// Save to localStorage
	localStorage.setItem('hudScale', scale);
	loadHUDPositions();

	console.log(`📏 HUD scale updated to ${scale}%`);
}

function loadHUDCustomizationSettings() {
	// Load saved settings
	const primaryColor = localStorage.getItem('hudPrimaryColor') || '#00ff88';
	const secondaryColor = localStorage.getItem('hudSecondaryColor') || '#00ffff';
	const accentColor = localStorage.getItem('hudAccentColor') || '#ff4499';
	const warningColor = localStorage.getItem('hudWarningColor') || '#ffaa00';
	const dangerColor = localStorage.getItem('hudDangerColor') || '#ff3333';
	const infoColor = localStorage.getItem('hudInfoColor') || '#3399ff';
	const bgOpacity = localStorage.getItem('hudBgOpacity') || '92';
	const textOpacity = localStorage.getItem('hudTextOpacity') || '100';
	const scale = localStorage.getItem('hudScale') || '100';
	const backgroundStyle = localStorage.getItem('hudBackgroundStyle') || 'gradient';
	const backgroundCustomColor = localStorage.getItem('hudBackgroundCustomColor') || '#001122';

	// Update color UI elements
	const colorElements = {
		'hudPrimaryColor': primaryColor,
		'hudSecondaryColor': secondaryColor,
		'hudAccentColor': accentColor,
		'hudWarningColor': warningColor,
		'hudDangerColor': dangerColor,
		'hudInfoColor': infoColor,
		'hudBgOpacity': bgOpacity,
		'hudTextOpacity': textOpacity,
		'hudScale': scale
	};

	Object.keys(colorElements).forEach(id => {
		const element = document.getElementById(id);
		if (element) element.value = colorElements[id];
	});

	// Update color code displays
	const colorCodeElements = {
		'hudPrimaryColorCode': primaryColor,
		'hudSecondaryColorCode': secondaryColor,
		'hudAccentColorCode': accentColor,
		'hudWarningColorCode': warningColor,
		'hudDangerColorCode': dangerColor,
		'hudInfoColorCode': infoColor,
		'hudScaleValue': scale + '%'
	};

	Object.keys(colorCodeElements).forEach(id => {
		const element = document.getElementById(id);
		if (element) element.textContent = colorCodeElements[id];
	});

	// Update background style dropdown
	const hudBackgroundStyleEl = document.getElementById('hudBackgroundStyle');
	if (hudBackgroundStyleEl) {
		hudBackgroundStyleEl.value = backgroundStyle;
	}

	// Update background color
	const hudBackgroundColorEl = document.getElementById('hudBackgroundColor');
	const hudBackgroundColorCodeEl = document.getElementById('hudBackgroundColorCode');
	if (hudBackgroundColorEl) {
		hudBackgroundColorEl.value = backgroundCustomColor;
	}
	if (hudBackgroundColorCodeEl) {
		hudBackgroundColorCodeEl.textContent = backgroundCustomColor;
	}

	// Apply all saved settings
	updateHUDColor('primary', primaryColor);
	updateHUDColor('secondary', secondaryColor);
	updateHUDColor('accent', accentColor);
	updateHUDColor('warning', warningColor);
	updateHUDColor('danger', dangerColor);
	updateHUDColor('info', infoColor);
	updateHUDBgOpacity(bgOpacity);
	updateHUDTextOpacity(textOpacity);
	updateHUDScale(scale);
	updateHUDBackground(backgroundStyle); // Apply the saved background style

	// CRITICAL: Apply custom background color if it's the selected style
	if (backgroundStyle === 'custom') {
		// Delay to ensure DOM is ready
		setTimeout(() => {
			updateHUDBackgroundColor(backgroundCustomColor);
		}, 200);
	}

	const sliderEl = document.getElementById('hudGlowSlider');
	const savedGlow = localStorage.getItem('hudGlowIntensity');
	const glowValue = savedGlow !== null
		? parseFloat(savedGlow)
		: parseFloat(sliderEl?.value || '30');
	if (sliderEl) sliderEl.value = glowValue;
	applyHUDGlow(glowValue);
	const glowDisplay = document.getElementById('hudGlowValue');
	if (glowDisplay) glowDisplay.textContent = glowValue + '%';
}

// ====================================
// HUD GLOW / BLOOM
// ====================================
function applyHUDGlow(intensity) {
	// intensity: 0-100
	const px = (intensity / 100) * 18; // max ~18px glow radius
	const alpha = intensity / 100;
	document.documentElement.style.setProperty('--hud-glow-px', `${px.toFixed(1)}px`);
	document.documentElement.style.setProperty('--hud-glow-alpha', alpha.toFixed(2));
}

function updateHUDGlow(value) {
	const v = parseFloat(value);
	const display = document.getElementById('hudGlowValue');
	if (display) display.textContent = v + '%';
	applyHUDGlow(v);
	localStorage.setItem('hudGlowIntensity', v);
}

// ====================================
// HUD PROFILES
// ====================================
function _getHUDProfileList() {
	try {
		return JSON.parse(localStorage.getItem('hudProfiles') || '[]');
	} catch (_) { return []; }
}

function _saveHUDProfileList(list) {
	localStorage.setItem('hudProfiles', JSON.stringify(list));
}

function _refreshProfileDropdown() {
	const select = document.getElementById('hudProfileSelect');
	if (!select) return;
	const list = _getHUDProfileList();
	select.innerHTML = '<option value="">— select profile —</option>';
	list.forEach((p, i) => {
		const opt = document.createElement('option');
		opt.value = i;
		opt.textContent = p.name;
		select.appendChild(opt);
	});
}

function _currentHUDSnapshot(name) {
	return {
		name,
		createdAt: new Date().toISOString(),
		colors: {
			primary: document.getElementById('hudPrimaryColor')?.value || '#00ff88',
			secondary: document.getElementById('hudSecondaryColor')?.value || '#00ffff',
			accent: document.getElementById('hudAccentColor')?.value || '#ff4499',
			warning: document.getElementById('hudWarningColor')?.value || '#ffaa00',
			danger: document.getElementById('hudDangerColor')?.value || '#ff3333',
			info: document.getElementById('hudInfoColor')?.value || '#3399ff',
		},
		glow: parseFloat(document.getElementById('hudGlowSlider')?.value || '30'),
		bgOpacity: parseFloat(document.getElementById('hudBgOpacity')?.value || '50'),
		textOpacity: parseFloat(document.getElementById('hudTextOpacity')?.value || '100'),
		scale: parseFloat(document.getElementById('hudScale')?.value || '100'),
	};
}

function saveHUDProfile() {
	const input = document.getElementById('hudProfileNameInput');
	const status = document.getElementById('hudProfileStatus');
	const name = (input?.value || '').trim();
	if (!name) {
		if (status) { status.textContent = '⚠ Enter a profile name first.'; status.style.color = '#fbbf24'; }
		return;
	}
	const list = _getHUDProfileList();
	const existingIdx = list.findIndex(p => p.name === name);
	const profile = _currentHUDSnapshot(name);
	if (existingIdx >= 0) {
		list[existingIdx] = profile;
	} else {
		list.push(profile);
	}
	_saveHUDProfileList(list);
	_refreshProfileDropdown();
	if (input) input.value = '';
	if (status) { status.textContent = `✓ Saved "${name}"`.slice(0, 55); status.style.color = '#34d399'; }
	setTimeout(() => { const s = document.getElementById('hudProfileStatus'); if (s) s.textContent = ''; }, 3000);
}

function loadHUDProfile() {
	const select = document.getElementById('hudProfileSelect');
	const status = document.getElementById('hudProfileStatus');
	if (!select || select.value === '') {
		if (status) { status.textContent = '⚠ Select a profile to load.'; status.style.color = '#fbbf24'; }
		return;
	}
	const list = _getHUDProfileList();
	const profile = list[parseInt(select.value, 10)];
	if (!profile) return;

	const c = profile.colors || {};
	if (c.primary) updateHUDColor('primary', c.primary);
	if (c.secondary) updateHUDColor('secondary', c.secondary);
	if (c.accent) updateHUDColor('accent', c.accent);
	if (c.warning) updateHUDColor('warning', c.warning);
	if (c.danger) updateHUDColor('danger', c.danger);
	if (c.info) updateHUDColor('info', c.info);
	if (profile.glow != null) {
		const g = document.getElementById('hudGlowSlider');
		if (g) g.value = profile.glow;
		updateHUDGlow(profile.glow);
	}
	if (profile.bgOpacity != null) {
		const b = document.getElementById('hudBgOpacity');
		if (b) b.value = profile.bgOpacity;
		updateHUDBgOpacity(profile.bgOpacity);
	}
	if (profile.textOpacity != null) {
		const t = document.getElementById('hudTextOpacity');
		if (t) t.value = profile.textOpacity;
		updateHUDTextOpacity(profile.textOpacity);
	}
	if (profile.scale != null) {
		const s = document.getElementById('hudScale');
		if (s) s.value = profile.scale;
		updateHUDScale(profile.scale);
	}
	if (status) { status.textContent = `✓ Loaded "${profile.name}"`.slice(0, 55); status.style.color = '#60a5fa'; }
	setTimeout(() => { const s = document.getElementById('hudProfileStatus'); if (s) s.textContent = ''; }, 3000);
}

function deleteHUDProfile() {
	const select = document.getElementById('hudProfileSelect');
	const status = document.getElementById('hudProfileStatus');
	if (!select || select.value === '') {
		if (status) { status.textContent = '⚠ Select a profile to delete.'; status.style.color = '#fbbf24'; }
		return;
	}
	const list = _getHUDProfileList();
	const idx = parseInt(select.value, 10);
	const removed = list.splice(idx, 1)[0];
	_saveHUDProfileList(list);
	_refreshProfileDropdown();
	if (status) { status.textContent = removed ? `🗑 Deleted "${removed.name}"` : '🗑 Profile removed.'; status.style.color = '#f87171'; }
	setTimeout(() => { const s = document.getElementById('hudProfileStatus'); if (s) s.textContent = ''; }, 3000);
}

export { changeHUDTheme, selectHUDTheme, toggleCustomTheme, resetHUDTheme, initializeHUDTheme };
export { updateHUDOpacity, initializeHUDOpacity, updateHUDBgOpacity, updateHUDTextOpacity };
export { updateHUDColor, updateHUDBackgroundColor, updateHUDBackground, applyCustomHUDColors, applyComprehensiveHUDColors, applyColorPreset, applyHUDPreset };
export { updateHUDScale };
export { updateHUDGlow, saveHUDProfile, loadHUDProfile, deleteHUDProfile, _refreshProfileDropdown as refreshHUDProfileDropdown };
export { initializeHUDDragging, addDragHandle, addResizeHandles };
export { saveHUDElementPosition, loadHUDElementPosition, resetHUDPositions };
export { toggleHUDEditMode, showHUDCustomizeDialog, closeHUDCustomizeDialog };
export { saveAllSettings, loadAllSettings, loadHUDPositions, setupAutoSave, loadHUDCustomizationSettings };
export { updateStationDelay, updateStationDelayDisplay };
export { exportHUDLayoutToFile, importHUDLayoutFromPicker, handleHUDLayoutImport };
export { resetHUDCustomization };