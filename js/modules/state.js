// ====================================
// CENTRAL MUTABLE STATE STORE
// ====================================
// All global `let` variables from scripts.js are consolidated here.
// Every module imports this object and reads/writes the same references.

const state = {
    // ====================================
    // ROUTE STATE
    // ====================================
    route: [],
    routeMode: false,
    totalDistance: 0,

    // ====================================
    // MAP REFERENCES
    // ====================================
    map: undefined,
    vectorSource: null, // Initialized in mapInit after ol is available
    vectorLayer: undefined,
    baseMapLayer: undefined,
    mapQuality: null,
    graphicsQuality: 'balanced',
    graphicsQualityConfig: null,
    coachType: 'opaque',
    targetFPS: 60,
    speedometerMode: 'combined',
    renderFPS: null,

    // ====================================
    // VEHICLE STATE
    // ====================================
    movingFeature: undefined, // Primary vehicle feature (locomotive)
    activeVehicleMode: null, // Mode used to create the current vehicle features
    trainCoaches: [], // Array to hold all train coaches (including locomotive)
    trainCouplings: [], // Array to hold coupling lines between coaches
    trainMovementHistory: [], // Track locomotive movement for smooth coach following
    coachPositionHistory: [], // History of positions for coach following
    totalCoachCount: 1, // Total number of coaches (locomotive + passengers + caboose)
    visibleCoachCount: 1, // Number of coaches currently visible on map (progressive loading)
    vehicleSizeMultiplier: 1.0, // User-adjustable vehicle icon scale (localStorage persisted)

    // ====================================
    // ANIMATION STATE
    // ====================================
    index: 0, // Current route segment index
    progress: 0, // Progress along current segment
    totalDistanceCovered: 0, // Total distance traveled
    totalRouteDistance: 0,   // Full route length (km), set once at simulation start
    animationInterval: null, // Global interval variable
    animationFrameId: null, // For requestAnimationFrame
    currentTunnelDepth: 0,
    currentTrackGrade: 0,
    currentTrackSection: 'Surface',
    worldSatelliteMosaic: null,
    isTracking: false, // Flag to check if tracking is enabled
    lockNorth: false, // North-Up camera mode (keep map North-up while following, like Google Maps)
    lastAnnouncedWaypoint: null, // To avoid repeating announcements
    cameraTargetCoords: null,
    subframeCounter: 0,
    cameraVelocity: 1,

    // ====================================
    // COORDINATE STATE
    // ====================================
    newLng: 0,
    newLat: 0,
    newCoords: null,
    fractionalLng: 0,
    fractionalLat: 0,
    fractionalCoords: null,

    // ====================================
    // G-FORCE STATE
    // ====================================
    previousSpeed: 0, // km/h
    previousTimestamp: 0, // milliseconds
    previousPosition: null, // [x, y] coordinates
    previousAngle: 0, // degrees
    accelGForceLimit: 0.10, // Acceleration G-Force (default 0.10G)
    decelGForceLimit: 0.05, // Deceleration G-Force (default 0.05G)
    maxGForceLimit: 0.10,   // Legacy alias for accel (safety.js, gforce.js etc. still read this)
    defaultMaxSpeed: 120,   // User-preferred default max speed (km/h)
    defaultAccelGForce: 0.10,
    defaultDecelGForce: 0.05,
    currentGForce: 0.0, // Current G-Force being experienced
    smoothAcceleration: true, // Enable smooth acceleration/deceleration

    // Smooth speed transition variables
    smoothTargetSpeed: 0,
    currentSmoothedSpeed: 0,
    lastSpeedUpdateTime: 0,

    // Performance tracking
    lastUpdateTime: 0,

    // ====================================
    // MANUAL CONTROL STATE
    // ====================================
    manualControlState: {
        isManualMode: false,
        autopilotActive: false,
        currentAcceleration: 0,
        acceleration: 0, // For display purposes
        currentSpeed: 0,
        targetSpeed: 0,
        isBraking: false,
        brakeLevel: 0, // Brake slider value (0-100)
        doorsOpen: false,
        isPaused: false,
        maxSpeed: 60, // Default, will be updated from user input
        userDefinedMaxSpeed: null // Store user's actual choice
    },
    manualUsesSmoothRoute: false,

    // ====================================
    // WEATHER STATE
    // ====================================
    weatherState: {
        isRaining: false,
        isSnowing: false,
        isDayMode: true,
        rainIntensity: 5,
        snowIntensity: 5,
        speed: 1.0,
        rainInterval: null,
        snowInterval: null,
        rainDrops: [],
        snowFlakes: [],
        maxParticles: 50 // Performance limit
    },
    world3dEnvironment: {
        timeMode: 'live',
        customTime: '12:00',
        weather: 'live',
        hudVisible: true
    },

    // ====================================
    // WEATHER CARD STATE
    // ====================================
    weatherCardState: {
        isFlipped: false,
        flipInterval: null,
        currentWeatherData: null,
        nextWeatherData: null,
        lastLocationUpdate: '',
        lastNextStopUpdate: '',
        weatherEmojis: {
            'Sunny': '☀️',
            'Partly Cloudy': '⛅',
            'Cloudy': '☁️',
            'Light Rain': '🌦️',
            'Clear': '🌞',
            'Overcast': '☁️',
            'Drizzle': '🌧️',
            'Heavy Rain': '⛈️',
            'Thunderstorm': '⛈️',
            'Snow': '❄️',
            'Fog': '🌫️',
            'Windy': '💨'
        }
    },

    // ====================================
    // BRAKING STATE
    // ====================================
    brakingState: {
        isEmergencyBraking: false,
        targetSpeed: 0,
        emergencyBrakeDistance: 0.1,
        lastGForceUpdate: 0,
        plannedStopDistance: 0,
        isAdvancedBraking: false,
        brakingLatch: false  // Once true for a stop, stays true until moveToNextPoint resets it
    },

    // ====================================
    // SAFETY STATE
    // ====================================
    safetyState: {
        emergencyMode: false,
        emergencyBrakeApplied: false,
        emergencyReason: '',
        lastEmergencyTime: 0,
        lastEmergencyAnnouncement: 0,
        stopDistance: 0,
        brakeFailureDetected: false,
        passengerAlertLevel: 0, // 0=normal, 1=caution, 2=warning, 3=emergency
        lastSafetyCheck: 0,
        maxAllowedGForce: 0.5,
        emergencyProtocolsActive: false,
        lastPassengerUpdate: 0
    },

    // ====================================
    // HUD DRAG STATE
    // ====================================
    hudDragData: {
        isDragging: false,
        currentElement: null,
        offsetX: 0,
        offsetY: 0,
        positions: {},
        isEditMode: false
    },

    resizeData: {
        isResizing: false,
        currentElement: null,
        startX: 0,
        startY: 0,
        startWidth: 0,
        startHeight: 0
    },

    // ====================================
    // THEME STATE
    // ====================================
    currentMapTheme: 'osm',
    currentHtmlTheme: 'dark',
    currentHUDTheme: 'default',
    mapContainerWidthPercent: 100,
    mapContainerHeightPx: 620,
    themePanelOpen: false,
    hudDialogStateBeforeDrag: false,

    // ====================================
    // INTELLIGENT CONTROL STATE
    // ====================================
    fuelEfficiencyMode: false,
    performanceModeEnabled: false, // Cap frame rate to ~30fps to save battery
    intelligentControlState: {
        stopAccelerationDistance: 0,
        coastingDistance: 0,
        lastCalculationTime: 0,
        canAccelerate: true,
        shouldBrake: false,
        targetAccelG: 0.1,       // Updated each tick from userGForceLimit
        targetGForce: 0,
        effectiveGForceLimit: 0.1,
        targetDeceleration: 0,
        brakingDistance: 0,
        maxSafeSpeed: Infinity,
        isInTransitionZone: false,
        previouslyBraking: false,
        mode: 'STANDARD'
    },

    // ====================================
    // FULLSCREEN STATE
    // ====================================
    isFullscreenMode: false,
    originalMapParent: null,
    originalMapStyles: {},

    // ====================================
    // MISC STATE
    // ====================================
    voiceVolume: 0.6, // Default voice volume (max)
    routeColor: '#454545', // Default route color
    stationDelayTime: 24, // Station delay time (in seconds)
    // Internally store the actual visual multiplier. The UI maps 1.0 -> 1.5.
    stationSizeMultiplier: 1.5, // Internal visual baseline (150%)
    comfortableAcceleration: 30,

    // Drag and Drop state
    isDragging: false,
    dragOffset: { x: 0, y: 0 },

    // Route type
    currentRouteType: 'rail', // Global route type storage (rail, road, hyperloop, air)
    roadRouteGeometry: null,  // OSRM full geometry for road route drawing

    // Road simulation state
    drivingStyle: 'normal',         // 'smooth' | 'normal' | 'rushed'
    roadAlternatives: [],           // OSRM alternative routes [{coords, distance, duration}]
    roadSelectedAlternative: 0,     // Index of selected alternative
    roadSmoothRoute: null,          // Densified smoothRoute built from OSRM coords
    roadSmoothDistances: null,      // Per-sub-segment distances for roadSmoothRoute
    roadSegmentSpeedLimits: [],     // OSRM modelled travel speeds (km/h), not posted limits

    segmentDistances: [],     // Cached per-segment distances (avoid recalculation)
    smoothRoute: [],           // Densified curve points [{lat, lng, originalIndex, originalProgress}]
    smoothRouteDistances: [],  // Cached per-sub-segment distances
    smoothRouteIndex: 0,       // Current position in smoothRoute during animation

    // Reverse geocoding cache and throttling
    lastReverseGeocodeTime: 0,
    reverseGeocodeThrottleMs: 300000, // 5 minutes (300 seconds)
    reverseGeocodeDistanceKm: 10, // 10 kilometers
    currentLocationCache: "",
    lastGeocodedPosition: null,

    // G-Force display throttling
    lastGForceUpdate: 0,
    lastGForceValue: null,

    // HUD display elements (set after DOM loads)
    liveSpeedDisplay: null,
    distanceToNextDisplay: null,
    timeToNextDisplay: null,
    timeToEndDisplay: null,
    startTime: null,
    currentNextStopName: "None",

    // TTS
    utterance: null, // Will be initialized after DOM

    // ====================================
    // CESIUMJS 3D MODE
    // ====================================
    is3DMode: false,
    world3D: null,
    currentDisplaySpeed: 0,
    semiAutoMode: false, // Semi-auto mode: user controls doors at stops

    // ====================================
    // CAREER / SURVIVAL MODE
    // ====================================
    careerMode: false, // true when Career simulation mode is active

    // ====================================
    // UNIT PREFERENCES
    // ====================================
    useImperialUnits: false // true = mph/miles, false = km/h/km (auto-detected or user-overridden)
};

export default state;
