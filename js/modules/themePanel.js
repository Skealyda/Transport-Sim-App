// ====================================
// THEME PANEL CONTROLS
// ====================================
import state from './state.js';
import { changeMapTheme } from './mapInit.js';

export function toggleThemePanel() {
    const panel = document.getElementById('themeControlPanel');
    const toggleIcon = document.getElementById('themeToggleIcon');

    if (state.themePanelOpen) {
        panel.style.right = '-320px';
        toggleIcon.style.transform = 'rotate(0deg)';
        toggleIcon.textContent = '🎨';
        state.themePanelOpen = false;
    } else {
        panel.style.right = '15px';
        toggleIcon.style.transform = 'rotate(180deg)';
        toggleIcon.textContent = '✖️';
        state.themePanelOpen = true;
    }
    panel.inert = !state.themePanelOpen;
    panel.setAttribute('aria-hidden', String(!state.themePanelOpen));
    document.getElementById('themeControlToggle').setAttribute('aria-expanded', String(state.themePanelOpen));
}

export function switchMainTheme(theme) {
    if (state.currentHtmlTheme) document.body.classList.remove(state.currentHtmlTheme);
    if (theme) document.body.classList.add(theme);
    state.currentHtmlTheme = theme;
    localStorage.setItem('htmlTheme', theme);
}

// Aliases for backward compatibility
export function setHtmlTheme(theme) {
    switchMainTheme(theme);
}

export function setMapTheme(theme) {
    changeMapTheme(theme);
}

// Function to update existing route color
export function updateExistingRouteColor() {
    if (state.vectorLayer) {
        const features = state.vectorLayer.getSource().getFeatures();
        features.forEach(feature => {
            const style = feature.getStyle();
            if (style) {
                const stroke = style.getStroke ? style.getStroke() : null;
                if (stroke) {
                    stroke.setColor(state.routeColor);
                    feature.changed();
                }
            }
        });
    }
}
