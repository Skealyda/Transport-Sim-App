// ====================================
// MAP INITIALIZATION & THEME MANAGEMENT
// ====================================
import state from './state.js';
import { reverseGeocodeAddress } from './net/geo.js';
import { getClientConfig } from './net/config.js';
import { createGoogleSatelliteLayer, ensureGoogleSatelliteSession, getGoogleSatelliteStatus } from './net/googleTiles.js';
import { MAP_QUALITY_OPTIONS } from './constants.js';
import { createEsriSatelliteLayer } from './net/esriTiles.js';

let satelliteStatusControl = null;

function updateSatelliteStatus(message) {
    if (!satelliteStatusControl) {
        const element = document.createElement('div');
        element.className = 'satellite-status ol-unselectable';
        element.setAttribute('role', 'status');
        satelliteStatusControl = new ol.control.Control({ element });
        state.map.addControl(satelliteStatusControl);
    }
    satelliteStatusControl.element.textContent = message;
    satelliteStatusControl.element.hidden = !message;
}

export function initMap() {
    const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    state.isMobileDevice = mobile;
    const savedQuality = localStorage.getItem('mapQuality');
    state.mapQuality = Object.hasOwn(MAP_QUALITY_OPTIONS, savedQuality)
        ? savedQuality : (mobile ? 'low' : 'high');
    if (savedQuality && savedQuality !== state.mapQuality) console.warn('Invalid saved map quality; using the device default');
    const qualitySelect = document.getElementById('mapQualitySelect');
    if (qualitySelect) qualitySelect.value = state.mapQuality;
    const savedFPS = Number(localStorage.getItem('targetFPS'));
    state.targetFPS = [30, 60, 120].includes(savedFPS) ? savedFPS : (mobile ? 30 : 60);
    const fpsSelect = document.getElementById('targetFPSSelect');
    if (fpsSelect) fpsSelect.value = String(state.targetFPS);
    // Define base map sources
    const osmSource = new ol.source.OSM({ maxZoom: Math.min(19, MAP_QUALITY_OPTIONS[state.mapQuality].maxZoom) });

    // Initialize vectorSource now that ol is available
    state.vectorSource = new ol.source.Vector();

    //default source
    state.baseMapLayer = new ol.layer.Tile({
        source: osmSource,
    });
    state.map = new ol.Map({
        target: 'map',
        // 3x phone screens would otherwise render ~2.25x the pixels of a 2x canvas for little visible gain.
        ...(mobile ? { pixelRatio: Math.min(window.devicePixelRatio || 1, 2) } : {}),
        layers: [
            state.baseMapLayer
        ],
        view: new ol.View({
            center: ol.proj.fromLonLat([78.6569, 11.1271]),
            zoom: 7,
            enableRotation: true,
            constrainRotation: false
        })
    });
    const fpsDisplay = document.getElementById('renderFps');
    let renderFrames = 0;
    let lastRenderSample = performance.now();
    state.map.on('postrender', () => {
        const now = performance.now();
        if (state.is3DMode) {
            renderFrames = 0;
            lastRenderSample = now;
            return;
        }
        if (!state.animationInterval && !state.manualControlState.isManualMode) {
            state.renderFPS = null;
            fpsDisplay.textContent = '—';
            renderFrames = 0;
            lastRenderSample = now;
            return;
        }
        renderFrames++;
        if (now - lastRenderSample >= 1000) {
            state.renderFPS = Math.round(renderFrames * 1000 / (now - lastRenderSample));
            fpsDisplay.textContent = String(state.renderFPS);
            renderFrames = 0;
            lastRenderSample = now;
        }
    });

    // Prevent middle-click auto-scroll.
    // Right-click is suppressed for non-road modes.
    // In road/car mode, right-click opens the driving style context menu.
    const mapElement = document.getElementById('map');
    if (mapElement) {
        mapElement.addEventListener('mousedown', function(e) {
            if (e.button === 1) e.preventDefault(); // Middle click
        });
        mapElement.addEventListener('contextmenu', function(e) {
            e.preventDefault();

            const isRoadSim = state.currentRouteType === 'road';
            const menu = document.getElementById('drivingStyleContextMenu');
            if (!isRoadSim || !menu) return;

            // Position and show the menu
            menu.style.display = 'block';
            const mx = e.clientX;
            const my = e.clientY;
            const menuW = 200;
            const menuH = 120;
            menu.style.left = Math.min(mx, window.innerWidth  - menuW - 8) + 'px';
            menu.style.top  = Math.min(my, window.innerHeight - menuH - 8) + 'px';

            // Mark the active style
            menu.querySelectorAll('.driving-ctx-item').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.style === state.drivingStyle);
            });

            // One-shot click-to-select handler
            function handleSelect(ev) {
                const btn = ev.target.closest('.driving-ctx-item');
                if (btn) {
                    state.drivingStyle = btn.dataset.style;
                    // Sync dialog radio if open
                    const radio = document.querySelector(`input[name="drivingStyle"][value="${state.drivingStyle}"]`);
                    if (radio) radio.checked = true;
                }
                menu.style.display = 'none';
                document.removeEventListener('click', handleSelect);
            }
            // Defer so the current event doesn't immediately close the menu
            setTimeout(() => document.addEventListener('click', handleSelect), 0);
        });
    }

    // Direct DOM-based rotation and tilt: Bypasses strict OpenLayers pointer interaction rules
    // which fail on Left+Right combo clicks (since they fire as pointermove, not pointerdown).
    let isRotating = false;
    let rotateLastX = 0;
    let rotateLastY = 0;

    window.addEventListener('pointermove', function(e) {
        // buttons: 4 is Middle Click, 3 is Left+Right Click
        if (e.buttons === 4 || e.buttons === 3) {
            if (!isRotating) {
                isRotating = true;
                rotateLastX = e.clientX;
                rotateLastY = e.clientY;
            } else {
                const deltaX = e.clientX - rotateLastX;
                const deltaY = e.clientY - rotateLastY;
                rotateLastX = e.clientX;
                rotateLastY = e.clientY;
                
                const view = state.map.getView();
                
                // Rotate 0.015 radians per pixel moved horizontally (similar to Google Earth)
                if (Math.abs(deltaX) > 0) {
                    view.setRotation(view.getRotation() + (deltaX * 0.015));
                }
            }
        } else {
            isRotating = false;
        }
    });

    window.addEventListener('pointerup', function(e) {
        if (e.buttons !== 4 && e.buttons !== 3) {
            isRotating = false;
        }
    });

    state.vectorLayer = new ol.layer.Vector({
        source: state.vectorSource
    });
    state.map.addLayer(state.vectorLayer);

    // Click handler variables for double-click detection
    let clickTimeout = null;
    let clickCount = 0;

    state.map.on('click', function (event) {
        if (!state.routeMode) return;

        // Check if user clicked on an existing route point
        const clickedFeature = state.map.forEachFeatureAtPixel(event.pixel, function (feature) {
            return feature;
        });

        if (clickedFeature) {
            const clickedCoord = ol.proj.toLonLat(clickedFeature.getGeometry().getCoordinates());
            const clickedPointIndex = findRoutePointIndex(clickedCoord);

            if (clickedPointIndex !== -1) {
                togglePointType(clickedPointIndex);
                return;
            }
        }

        clickCount++;

        if (clickCount === 1) {
            clickTimeout = setTimeout(() => {
                addRoutePoint(event, 'stop');
                clickCount = 0;
            }, 350);
        } else if (clickCount === 2) {
            clearTimeout(clickTimeout);
            clickTimeout = setTimeout(() => {
                addRoutePoint(event, 'waypoint');
                clickCount = 0;
            }, 350);
        } else if (clickCount >= 3) {
            clearTimeout(clickTimeout);
            addRoutePoint(event, 'dummy');
            clickCount = 0;
        }
    });

    function findRoutePointIndex(clickedCoord) {
        const tolerance = 0.001;
        for (let i = 0; i < state.route.length; i++) {
            const point = state.route[i];
            const latDiff = Math.abs(point.latlng.lat - clickedCoord[1]);
            const lngDiff = Math.abs(point.latlng.lng - clickedCoord[0]);
            if (latDiff < tolerance && lngDiff < tolerance) {
                return i;
            }
        }
        return -1;
    }

    function togglePointType(pointIndex) {
        const point = state.route[pointIndex];
        const currentType = point.type || 'stop';

        if (currentType === 'stop') {
            point.type = 'waypoint';
            if (point.placeName && point.placeName.startsWith('[Waypoint] ')) {
                point.placeName = point.placeName.substring('[Waypoint] '.length);
            }
            console.log(`🔄 Point ${pointIndex + 1} converted to waypoint`);
        } else if (currentType === 'waypoint') {
            point.type = 'dummy';
            console.log(`🔄 Point ${pointIndex + 1} converted to dummy`);
        } else if (currentType === 'dummy') {
            console.log(`🗑️ Removing dummy point ${pointIndex + 1}`);
            state.route.splice(pointIndex, 1);
            if (typeof window.updateDistance === 'function') window.updateDistance();
        } else {
            // Fallback: remove any unknown type
            state.route.splice(pointIndex, 1);
            if (typeof window.updateDistance === 'function') window.updateDistance();
        }

        if (typeof window.drawRoute === 'function') window.drawRoute();
    }

    async function addRoutePoint(event, pointType) {
        let coords = ol.proj.toLonLat(event.coordinate);
        const lat = coords[1];
        const lng = coords[0];

        // Dummy points need no geocode — add instantly with an empty name
        if (pointType === 'dummy') {
            state.route.push({ latlng: { lat, lng }, placeName: '', type: 'dummy' });
            if (typeof window.drawRoute === 'function') window.drawRoute();
            return;
        }

        const data = await reverseGeocodeAddress(lat, lng, 18);
        let placeName;
        if (data) {
            const a = data.address;
            placeName = a.town || a.village || a.city || a.suburb || a.neighbourhood || 'Unknown Location';
            if (a.city && a.suburb) placeName = a.suburb;
            else if (a.city && a.neighbourhood) placeName = a.neighbourhood;
            placeName = placeName.replace(/Zone \d+/g, '').replace(/\d+/g, '').trim();
        } else {
            placeName = `Point ${state.route.length + 1}`;
        }
        if (pointType === 'waypoint') placeName = `[Waypoint] ${placeName}`;

        state.route.push({ latlng: { lat, lng }, placeName, type: pointType });
        if (typeof window.drawRoute === 'function') window.drawRoute();
    }
    // Initialize train colors with default values
    window.trainColors = {
        locomotive: '#A0FF61',
        coach: '#FFDB57'
    };
}

const ESRI_ATTRIBUTION = 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, Maxar, &copy; OpenStreetMap contributors, and the GIS User Community';

function xyzLayer(url, maxZoom, attributions, className) {
    maxZoom = Math.min(maxZoom, MAP_QUALITY_OPTIONS[state.mapQuality].maxZoom);
    return new ol.layer.Tile({ source: new ol.source.XYZ({ url, maxZoom, attributions }), ...(className && { className }) });
}

// Esri basemaps are keyless; CARTO now watermarks tiles without an API key.
const esri = (service, maxZoom = 19, className) => xyzLayer(
    `https://server.arcgisonline.com/ArcGIS/rest/services/${service}/MapServer/tile/{z}/{y}/{x}`, maxZoom, ESRI_ATTRIBUTION, className);
const withLabels = (base, labels) => new ol.layer.Group({ layers: [base, labels] });

// Returns [baseLayer, suggestedHUDTheme]. Theme ids are persisted in localStorage, so legacy
// ids (apple_*) are kept and mapped to providers whose terms allow direct tile access.
function createBaseLayer(theme) {
    switch (theme) {
        case 'osm': return [new ol.layer.Tile({ source: new ol.source.OSM({ maxZoom: Math.min(19, MAP_QUALITY_OPTIONS[state.mapQuality].maxZoom) }) }), 'default'];
        case 'satellite': {
            const quality = state.mapQuality;
            const google = createGoogleSatelliteLayer(() => {
                if (state.currentMapTheme === 'satellite' && state.mapQuality === quality) changeMapTheme('satellite');
            }, state.mapQuality);
            if (!google) {
                updateSatelliteStatus('Loading Google satellite');
                ensureGoogleSatelliteSession(quality).then(session => {
                    if (state.currentMapTheme !== 'satellite' || state.mapQuality !== quality) return;
                    if (session) changeMapTheme('satellite');
                    else if (state.currentMapTheme === 'satellite') {
                        updateSatelliteStatus(`${getGoogleSatelliteStatus()}. Select Esri Satellite to use a different provider.`);
                    }
                });
            } else {
                updateSatelliteStatus('Google satellite');
            }
            return [google || new ol.layer.Tile({ source: new ol.source.XYZ() }), 'gold'];
        }
        case 'esri_satellite': {
            const quality = state.mapQuality;
            updateSatelliteStatus('Esri Satellite - loading available detail');
            return [createEsriSatelliteLayer(quality, ESRI_ATTRIBUTION, message => {
                if (state.currentMapTheme === 'esri_satellite' && state.mapQuality === quality) updateSatelliteStatus(message);
            }), 'gold'];
        }
        case 'darkmatter':
            return [withLabels(esri('Canvas/World_Dark_Gray_Base', 16), esri('Canvas/World_Dark_Gray_Reference', 16)), 'green'];
        case 'positron':
            return [withLabels(esri('Canvas/World_Light_Gray_Base', 16), esri('Canvas/World_Light_Gray_Reference', 16)), 'purple'];
        case 'midnight':
            return [withLabels(esri('Canvas/World_Dark_Gray_Base', 16, 'midnight-tiles'), esri('Canvas/World_Dark_Gray_Reference', 16)), 'red'];
        case 'apple_standard': return [esri('World_Street_Map'), 'default'];
        case 'apple_muted': return [esri('World_Topo_Map'), 'orange'];
        case 'apple_hybrid':
            return [withLabels(esri('World_Imagery'), esri('Reference/World_Boundaries_and_Places')), 'orange'];
        case 'humanitarian':
            return [xyzLayer('https://{a-c}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', 19,
                '&copy; OpenStreetMap contributors, Tiles style by Humanitarian OpenStreetMap Team'), 'default'];
        case 'cyclosm': return [xyzLayer('https://{a-c}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png', 20,
            '&copy; OpenStreetMap contributors, CyclOSM'), 'green'];
        case 'cyclemap':
        case 'transportmap': {
            const key = getClientConfig().thunderforestApiKey;
            if (!key) return createBaseLayer(theme === 'cyclemap' ? 'cyclosm' : 'opnvkarte');
            const style = theme === 'cyclemap' ? 'cycle' : 'transport';
            return [xyzLayer(`https://tile.thunderforest.com/${style}/{z}/{x}/{y}.png?apikey=${encodeURIComponent(key)}`, 20,
                'Maps &copy; Thunderforest, Data &copy; OpenStreetMap contributors'), theme === 'cyclemap' ? 'purple' : 'default'];
        }
        case 'opnvkarte': return [xyzLayer('https://tile.memomaps.de/tilegen/{z}/{x}/{y}.png', 19,
            '&copy; OpenStreetMap contributors, &copy; memomaps.de'), 'purple'];
        default:
            console.warn("Invalid theme, using default OSM theme");
            return [new ol.layer.Tile({ source: new ol.source.OSM() }), 'default'];
    }
}

export function setMapQuality(quality) {
    if (!Object.hasOwn(MAP_QUALITY_OPTIONS, quality)) {
        console.error('Invalid map quality:', quality);
        return;
    }
    state.mapQuality = quality;
    localStorage.setItem('mapQuality', quality);
    const select = document.getElementById('mapQualitySelect');
    if (select) select.value = quality;
    changeMapTheme(state.currentMapTheme);
}

export function setTargetFPS(value) {
    const fps = Number(value);
    if (![30, 60, 120].includes(fps)) {
        console.error('Invalid simulation FPS limit:', value);
        return;
    }
    state.targetFPS = fps;
    localStorage.setItem('targetFPS', String(fps));
    const select = document.getElementById('targetFPSSelect');
    if (select) select.value = String(fps);
}

export function changeMapTheme(theme) {
    state.map.removeLayer(state.baseMapLayer);
    if (theme === 'apple_satellite') theme = 'satellite';
    if (!['satellite', 'esri_satellite'].includes(theme) && satelliteStatusControl) updateSatelliteStatus('');
    const [layer, suggestedHUDTheme] = createBaseLayer(theme);
    state.baseMapLayer = layer;
    // Add the new base map layer to the map
    state.map.getLayers().insertAt(0, state.baseMapLayer);

    // Save the current map theme
    state.currentMapTheme = theme;
    localStorage.setItem('mapTheme', theme);

    // Auto-suggest complementary HUD theme if user hasn't manually selected one
    if (!localStorage.getItem('hudThemeManuallySet')) {
        if (typeof window.changeHUDTheme === 'function') {
            window.changeHUDTheme(suggestedHUDTheme);
        }
        console.log(`🎨 Auto-suggested HUD theme "${suggestedHUDTheme}" for map theme "${theme}"`);
    }
}