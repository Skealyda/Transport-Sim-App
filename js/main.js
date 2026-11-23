
// ====================================
// MAIN ENTRY POINT — Bootstrap & Global Re-exports
// ====================================
// === Foundation Layer ===
import './modules/browserDependencies.js';
import { WEATHER_CONFIG, CACHE_CONFIG, TARGET_FPS, FRAME_INTERVAL, GFORCE_UPDATE_INTERVAL } from './modules/constants.js';
import state from './modules/state.js';
import { setSpeedometerMode } from './modules/speedometer.js';
import { debounce, throttle, calculateDistance, calculateRotationAngle, formatDuration, formatTime, formatTimeHHMMSS, playAudio, getCachedVoice, formatDistance, formatDistanceShort, convertSpeed, getSpeedUnit } from './modules/utils.js';
// === Infrastructure Layer ===
import { PersistentCache, APIMonitor, initCaches } from './modules/cache.js';
import { domCache } from './modules/domCache.js';
// === Feature Modules ===
import { showWeatherDialog, closeWeatherDialog, applyWeatherSettings, resetWeather, applyDayNightMode, startRain, stopRain, startSnow, stopSnow, initializeWeatherControls } from './modules/weatherEffects.js';
import { initMap, changeMapTheme, setMapQuality, setTargetFPS } from './modules/mapInit.js';
import { toggleVolumePopup, updateVoiceVolume, updateEffectsVolume, initVolumeControls } from './modules/audio.js';
import { installMixingAudio } from './modules/soundEngine.js';
import { initAnnouncements, setVoiceAnnouncements, setTtsVoice, previewTtsVoice } from './modules/announcer.js';
import { initTrainSoundSettings, setTrainSoundProfile, previewTrainHorn } from './modules/trainSound.js';
import { initRouteStore, syncRoutes, connectRoutesFolder, exportRoutesFile, importRoutesFile } from './modules/routeStore.js';
import { toggleThemePanel, switchMainTheme, setHtmlTheme, setMapTheme, updateExistingRouteColor } from './modules/themePanel.js';
import { drawRoute, updateDistance, saveRouteToJson, undoLastPoint, toggleRouteMode, showRouteDialog, closeRouteDialog, loadSelectedRoute, populateMainRouteDropdown, showEditRouteDialog, closeEditRouteDialog, loadRouteForEditing, saveEditedRoute, deleteSelectedRoute, toggleModifyOnMap, setModifyOnMapMode, updateEditingPointField, populateRouteDropdown, getCoordinateDisplay, convertToArrayFormat, createHyperloopStationStyle, showHelpBulb, hideHelpBulb, toggleWaypointInstructions, showWaypointInstructions, hideWaypointInstructions, calculateMaxAchievableSpeed, calculateTotalRemainingDistance } from './modules/routeManager.js';
import { addMarker, resetMap, showSimulateDialog, closeSimulateDialog, getTransportIcon, initializeTrainCoaches, updateTrainCoaches, findPositionInTrail, updateTrainCouplings, toggleCoachSelection, updateCoachCount, updateTrainColors, refreshTrainCoachColors, appendCoachVisual, removeLastCoachVisual, refreshActiveVehicleStyles } from './modules/vehicle.js';
import { startSimulation, startManualSimulation, adjustSpeed, setTargetSpeed, setTargetSpeedDirect, setAccelerationMin, updateAccelerationFromSlider, updateBrakeFromSlider, updateManualSpeedRealistic, emergencyBrake, applyBrakes, soundManualHorn, openDoors, closeDoors, toggleDoors, showDoorControls, hideDoorControls, pauseSimulation, resumeSimulation, stopSimulation, showManualControlPanel, hideManualControlPanel, minimizeControlPanel, closeControlPanel, animateManualMovement, updateManualDisplays, updateSpeedDisplay, updateDeceleration, updateGForceIndicator, updateGForceLimit } from './modules/manualControls.js';
import { animateMovement } from './modules/autoAnimation.js';
import { updateStats, updateHUD, updateLocationDisplay, reverseGeocode, updateVehicleCondition, getNextStopName, applyMarqueeToElement, updateRouteInfo, calculateAndUpdateTimeEstimates, startFlightMonitor, stopFlightMonitor, setDepartureTime, initTimeChart, recordArrival, recordDeparture, liveUpdateTimeChart, showTimeChart, hideTimeChart, updateRoadHUD } from './modules/hud.js';
import { initializeWeatherCard } from './modules/weatherAPI.js';
import { calculateGForces, updateGForceDisplay, calculateStoppingDistance, calculateTargetSpeedForStop, calculateSafeSpeedEnhanced, updateDynamicBraking, calculateWaypointAndStopTimes, calculateRealisticTravelTime, calculateRealTimeDistanceFromCurrent, calculateDistanceFromCurrent, preCalculateJourney, reCalculateFromIndex } from './modules/gforce.js';
import { activateEmergencyBraking, announceEmergency, activateEmergencyVisuals, playEmergencyAudio, updateEmergencyStopDistance, monitorSafetyStatus, updatePassengerAlertLevel, isDecelerating, calculateExpectedDeceleration, clearEmergencyState, testEmergencyBraking, initializeSafetySystem } from './modules/safety.js';
import { toggleFullscreenMode, enterFullscreenMode, exitFullscreenMode, showFullscreenExitHint, handleEscapeKey } from './modules/fullscreen.js';
import { updateVehicleSize, resetVehicleSize, updateStationSize, setUnitSystem, updateUnitUI, setDefaultMaxSpeed, setDefaultAccelGForce, setDefaultDecelGForce, setMapContainerWidth, setMapContainerHeight, setCareerCurrency, clearCareerHighScores, setCareerFareRate, setCareerBaseCost, setCareerCoachCost, setCareerPassengerTraffic, setCareerAutoDoors, setCareerAutoCoaches, setCareerAutoStartCoaches, toggleCareerSettingsSection, refreshCareerSettingsVisibility, loadSettingsFromStorage, showSettingsDialog, closeSettingsDialog, saveApiConnectionSettings, clearApiConnectionSettings, setPerformanceMode, set3DGraphicsQuality, setCoachType } from './modules/settings.js';
import { toggleFuelEfficiency, calculateCoastingDistance, calculateIntelligentAcceleration } from './modules/intelligentControl.js';
import { toggle3DMode, initWorld3DControls } from './modules/world3d.js';
import { loadClientConfig } from './modules/net/config.js';
import { changeHUDTheme, selectHUDTheme, toggleCustomTheme, resetHUDTheme, initializeHUDTheme, updateHUDOpacity, initializeHUDOpacity, updateHUDBgOpacity, updateHUDTextOpacity, updateHUDColor, updateHUDBackgroundColor, updateHUDBackground, applyCustomHUDColors, applyComprehensiveHUDColors, applyColorPreset, applyHUDPreset, updateHUDScale, updateHUDGlow, saveHUDProfile, loadHUDProfile, deleteHUDProfile, refreshHUDProfileDropdown, initializeHUDDragging, addDragHandle, addResizeHandles, saveHUDElementPosition, loadHUDElementPosition, resetHUDPositions, toggleHUDEditMode, showHUDCustomizeDialog, closeHUDCustomizeDialog, saveAllSettings, loadAllSettings, loadHUDPositions, setupAutoSave, loadHUDCustomizationSettings, updateStationDelay, updateStationDelayDisplay, resetHUDCustomization, exportHUDLayoutToFile, importHUDLayoutFromPicker, handleHUDLayoutImport } from './modules/hudCustomization.js';
import { toggleCurrency, addCoach, removeCoach, resetCareerMode, initCareerMode, isAtStop, updateEconomyHUD, toggleEconomyPanelCollapsed, getCareerState } from './modules/careerMode.js';

const APP_DEBUG = localStorage.getItem('appDebug') === 'true' || new URLSearchParams(window.location.search).get('debug') === '1';
let memoryMonitorInterval = null;

function debugLog(...args) {
    if (APP_DEBUG) {
        console.log(...args);
    }
}

function debugWarn(...args) {
    if (APP_DEBUG) {
        console.warn(...args);
    }
}
// ====================================
// window.* GLOBAL RE-EXPORTS
// ====================================
// Required for HTML inline onclick/onchange/oninput handlers
// Weather
window.showWeatherDialog = showWeatherDialog;
window.closeWeatherDialog = closeWeatherDialog;
window.applyWeatherSettings = applyWeatherSettings;
window.resetWeather = resetWeather;
// Map
window.changeMapTheme = changeMapTheme;
window.initMap = initMap;
// Audio
window.toggleVolumePopup = toggleVolumePopup;
window.updateVoiceVolume = updateVoiceVolume;
window.updateEffectsVolume = updateEffectsVolume;
// Theme
window.toggleThemePanel = toggleThemePanel;
window.switchMainTheme = switchMainTheme;
// Route Management
window.drawRoute = drawRoute;
window.updateDistance = updateDistance;
window.saveRouteToJson = saveRouteToJson;
window.undoLastPoint = undoLastPoint;
window.toggleRouteMode = toggleRouteMode;
window.showRouteDialog = showRouteDialog;
window.closeRouteDialog = closeRouteDialog;
window.loadSelectedRoute = loadSelectedRoute;
window.showEditRouteDialog = showEditRouteDialog;
window.closeEditRouteDialog = closeEditRouteDialog;
window.saveEditedRoute = saveEditedRoute;
window.deleteSelectedRoute = deleteSelectedRoute;
window.toggleModifyOnMap = toggleModifyOnMap;
window.setModifyOnMapMode = setModifyOnMapMode;
window.updateEditingPointField = updateEditingPointField;
window.showHelpBulb = showHelpBulb;
window.hideHelpBulb = hideHelpBulb;
window.hideWaypointInstructions = hideWaypointInstructions;
// Vehicle
window.addMarker = addMarker;
window.resetMap = resetMap;
window.showSimulateDialog = showSimulateDialog;
window.closeSimulateDialog = closeSimulateDialog;
window.refreshActiveVehicleStyles = refreshActiveVehicleStyles;
window.toggleCoachSelection = toggleCoachSelection;
window.updateCoachCount = updateCoachCount;
window.updateTrainColors = updateTrainColors;
window.toggleDrivingStyleRow = function() {
    const mode = document.getElementById('transportMode')?.value;
    const routeType = window.currentRouteType || 'rail';
    const show = mode === 'car' || routeType === 'road';
    const row = document.getElementById('drivingStyleRow');
    if (row) row.style.display = show ? '' : 'none';
};
// Manual Controls
window.startSimulation = startSimulation;
window.adjustSpeed = adjustSpeed;
window.setTargetSpeed = setTargetSpeed;
window.setTargetSpeedDirect = setTargetSpeedDirect;
window.setAccelerationMin = setAccelerationMin;
window.soundManualHorn = soundManualHorn;
window.updateAccelerationFromSlider = updateAccelerationFromSlider;
window.updateBrakeFromSlider = updateBrakeFromSlider;
window.emergencyBrake = emergencyBrake;
window.openDoors = openDoors;
window.closeDoors = closeDoors;
window.toggleDoors = toggleDoors;
window.pauseSimulation = pauseSimulation;
window.resumeSimulation = resumeSimulation;
window.stopSimulation = stopSimulation;
window.minimizeControlPanel = minimizeControlPanel;
window.closeControlPanel = closeControlPanel;
// Fullscreen
window.toggleFullscreenMode = toggleFullscreenMode;
// 3D Mode
window.toggle3DMode = toggle3DMode;
// HUD Customization
window.changeHUDTheme = changeHUDTheme;
window.selectHUDTheme = selectHUDTheme;
window.toggleCustomTheme = toggleCustomTheme;
window.resetHUDTheme = resetHUDTheme;
window.updateHUDOpacity = updateHUDOpacity;
window.updateHUDBgOpacity = updateHUDBgOpacity;
window.updateHUDTextOpacity = updateHUDTextOpacity;
window.updateHUDColor = updateHUDColor;
window.updateHUDBackgroundColor = updateHUDBackgroundColor;
window.updateHUDScale = updateHUDScale;
window.updateHUDGlow = updateHUDGlow;
window.saveHUDProfile = saveHUDProfile;
window.loadHUDProfile = loadHUDProfile;
window.deleteHUDProfile = deleteHUDProfile;
window.refreshHUDProfileDropdown = refreshHUDProfileDropdown;
window.applyColorPreset = applyColorPreset;
window.showHUDCustomizeDialog = showHUDCustomizeDialog;
window.closeHUDCustomizeDialog = closeHUDCustomizeDialog;
window.toggleHUDEditMode = toggleHUDEditMode;
window.resetHUDPositions = resetHUDPositions;
window.loadHUDPositions = loadHUDPositions;
window.exportHUDLayoutToFile = exportHUDLayoutToFile;
window.importHUDLayoutFromPicker = importHUDLayoutFromPicker;
window.handleHUDLayoutImport = handleHUDLayoutImport;
window.updateStationDelay = updateStationDelay;
window.updateStationDelayDisplay = updateStationDelayDisplay;
window.resetHUDCustomization = resetHUDCustomization;
window.updateEconomyHUD = updateEconomyHUD;
// G-Force
window.updateGForceLimit = updateGForceLimit;
// Safety
window.testEmergencyBraking = testEmergencyBraking;
// Intelligent Control
window.toggleFuelEfficiency = toggleFuelEfficiency;
// Settings
window.showSettingsDialog = showSettingsDialog;
window.closeSettingsDialog = closeSettingsDialog;
window.updateVehicleSize = updateVehicleSize;
window.resetVehicleSize = resetVehicleSize;
window.updateStationSize = updateStationSize;
window.setUnitSystem = setUnitSystem;
window.setDefaultMaxSpeed = setDefaultMaxSpeed;
window.setDefaultAccelGForce = setDefaultAccelGForce;
window.setDefaultDecelGForce = setDefaultDecelGForce;
window.setMapContainerWidth = setMapContainerWidth;
window.setMapContainerHeight = setMapContainerHeight;
window.setPerformanceMode = setPerformanceMode;
window.set3DGraphicsQuality = set3DGraphicsQuality;
window.setCoachType = setCoachType;
window.saveApiConnectionSettings = saveApiConnectionSettings;
window.clearApiConnectionSettings = clearApiConnectionSettings;
window.setCareerCurrency = setCareerCurrency;
window.setCareerFareRate = setCareerFareRate;
window.setCareerBaseCost = setCareerBaseCost;
window.setCareerCoachCost = setCareerCoachCost;
window.setCareerPassengerTraffic = setCareerPassengerTraffic;
window.setCareerAutoDoors = setCareerAutoDoors;
window.setCareerAutoCoaches = setCareerAutoCoaches;
window.setCareerAutoStartCoaches = setCareerAutoStartCoaches;
window.toggleCareerSettingsSection = toggleCareerSettingsSection;
window.refreshCareerSettingsVisibility = refreshCareerSettingsVisibility;
window.clearCareerHighScores = clearCareerHighScores;
// Career Mode
window.toggleCareerCurrency = toggleCurrency;
window.toggleEconomyPanelCollapsed = toggleEconomyPanelCollapsed;
window.addCareerCoach = function() {
    if (addCoach()) {
        appendCoachVisual();
        updateEconomyHUD();
        if (window.updateCoachBtnState) window.updateCoachBtnState();
    }
};
window.removeCareerCoach = function() {
    if (removeCoach()) {
        removeLastCoachVisual();
        updateEconomyHUD();
        if (window.updateCoachBtnState) window.updateCoachBtnState();
    }
};
function updateCoachBtnState() {
    const atStop = isAtStop();
    const addBtn = document.getElementById('addCoachBtn');
    const rmBtn = document.getElementById('removeCoachBtn');
    if (addBtn) addBtn.disabled = !atStop;
    if (rmBtn) rmBtn.disabled = !atStop;
}
window.updateCoachBtnState = updateCoachBtnState;
window.restartCareer = function() {
    // Reset career state and hide overlays
    resetCareerMode();
    const goOverlay = document.getElementById('careerGameOverOverlay');
    if (goOverlay) goOverlay.style.display = 'none';
    const econPanel = document.getElementById('economyPanel');
    if (econPanel) econPanel.style.display = 'none';
    // Re-show simulation dialog for new run
    window.showSimulateDialog && window.showSimulateDialog();
};
// Time Chart
window.showTimeChart = showTimeChart;
window.hideTimeChart = hideTimeChart;
// State — expose shared state for any direct references from inline scripts
window.state = state;
window.route = state.route;
window.map = state.map;
window.vectorSource = state.vectorSource;
window.vectorLayer = state.vectorLayer;
window.manualControlState = state.manualControlState;
window.weatherState = state.weatherState;
window.routeMode = state.routeMode;
window.routeColor = state.routeColor;
window.trainCoaches = state.trainCoaches;
window.trainCouplings = state.trainCouplings;
// Utils — expose for any inline <script> sections in index.html
window.calculateDistance = calculateDistance;
window.PersistentCache = PersistentCache;
window.APIMonitor = APIMonitor;
window.domCache = domCache;
// Auto animation
window.animateMovement = animateMovement;
window.setMapQuality = setMapQuality;
window.setTargetFPS = setTargetFPS;
window.setSpeedometerMode = mode => {
    setSpeedometerMode(mode);
    loadHUDPositions();
};
window.setVoiceAnnouncements = setVoiceAnnouncements;
window.setTtsVoice = setTtsVoice;
window.previewTtsVoice = previewTtsVoice;
window.setTrainSoundProfile = setTrainSoundProfile;
window.previewTrainHorn = previewTrainHorn;
window.connectRoutesFolder = connectRoutesFolder;
window.exportRoutesFile = exportRoutesFile;
window.importRoutesFile = importRoutesFile;
window.syncRoutesNow = syncRoutes;
// ====================================
// DOMContentLoaded — BOOTSTRAP
// ====================================
document.addEventListener('DOMContentLoaded', function () {
    debugLog('🚀 Transport Simulator — Modular Architecture Loading...');

    // 1. Initialize caches
    initCaches();
    installMixingAudio();
    initAnnouncements();
    initTrainSoundSettings();
    initVolumeControls();

    // 2. Cache DOM elements
    domCache.init();

    // Render Lucide icons
    if (typeof lucide !== 'undefined') lucide.createIcons();

    // 3. Initialize map
    initMap();
    initWorld3DControls();

    // 4. Load all settings (Map, HTML, HUD, Vehicle Sizing)
    loadAllSettings();

    // Keyed map themes render a keyless fallback until the client config arrives.
    loadClientConfig().then(config => {
        if (config.thunderforestApiKey && ['cyclemap', 'transportmap'].includes(state.currentMapTheme)) {
            changeMapTheme(state.currentMapTheme);
        }
    });
    loadSettingsFromStorage();

    // Merge server + device route copies into one routes.json (non-blocking).
    initRouteStore();

    // 5. Initialize weather controls
    setTimeout(initializeWeatherControls, 100);

    // 6. Initialize weather card system
    setTimeout(initializeWeatherCard, 1000);

    // 7. Initialize safety system
    initializeSafetySystem();

    // 8. Load saved HUD customization settings
    loadHUDCustomizationSettings();
    initializeHUDTheme();
    initializeHUDOpacity();
    initializeHUDDragging();
    loadHUDPositions();

    // 9. Setup auto-save for settings
    setupAutoSave();

    // 10. Initialize G-Force limit control
    const gforceLimitSlider = document.getElementById('gforceLimitSlider');
    if (gforceLimitSlider) {

        updateGForceLimit(gforceLimitSlider.value);
    }

    // 11. Initialize time calculations global cache

    window.timeCalculations = {

        timeToNextStop: 0,

        timeToNextWaypoint: 0,

        timeToFinalDestination: 0,

        distanceToNextStop: 0,

        distanceToNextWaypoint: 0
    };

    window.lastTimeCalculation = 0;

    // 12. Load fuel efficiency mode
    const savedFuelMode = localStorage.getItem('fuelEfficiencyMode');
    if (savedFuelMode === 'true') {

        state.fuelEfficiencyMode = true;

        const fuelToggle = document.getElementById('fuelEfficiencyToggle');

        if (fuelToggle) fuelToggle.checked = true;
    }

    // 15. Performance mode — restore saved preference, then auto-detect via Battery Status API
    const savedPerfMode = localStorage.getItem('performanceMode');
    if (savedPerfMode !== null) {
        setPerformanceMode(savedPerfMode === 'true');
    } else if (state.isMobileDevice) {
        // Blur/shadow compositing is a major GPU (heat/battery) cost on phones.
        setPerformanceMode(true);
    }
    if ('getBattery' in navigator) {
        navigator.getBattery().then(battery => {
            function checkBattery() {
                // Auto-enable when discharging below 20 % (won't override a manual enable)
                if (!battery.charging && battery.level < 0.20 && !state.performanceModeEnabled) {
                    setPerformanceMode(true);
                }
            }
            checkBattery();
            battery.addEventListener('levelchange', checkBattery);
            battery.addEventListener('chargingchange', checkBattery);
        }).catch(() => {});
    }

    debugLog('✅ Transport Simulator Web App — All modules initialized');
});


// Performance optimization monitoring
if (typeof performance !== 'undefined' && performance.mark) {
    performance.mark('transport-sim-start');
    window.addEventListener('load', function () {
        performance.mark('transport-sim-loaded');
        performance.measure('transport-sim-load-time', 'transport-sim-start', 'transport-sim-loaded');
        const measure = performance.getEntriesByName('transport-sim-load-time')[0];
        if (measure) {
            debugLog('✅ Transport Simulator loaded in ' + Math.round(measure.duration) + 'ms');
            if (measure.duration > 3000) {
                debugWarn('⚠️ Slow load detected');
            }
        }
    });
}

// Memory usage monitoring
if (typeof window !== 'undefined' && window.performance && window.performance.memory) {
    memoryMonitorInterval = setInterval(() => {
        const memory = window.performance.memory;
        if (memory.usedJSHeapSize > 80 * 1024 * 1024) {
            debugWarn('⚠️ High memory usage:', Math.round(memory.usedJSHeapSize / 1024 / 1024) + 'MB');
        }
    }, 30000);

    window.addEventListener('beforeunload', () => {
        if (memoryMonitorInterval) {
            clearInterval(memoryMonitorInterval);
            memoryMonitorInterval = null;
        }
    }, { once: true });
}
