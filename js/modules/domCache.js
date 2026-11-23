// ====================================
// PERFORMANCE OPTIMIZATION: DOM CACHE
// ====================================

export const domCache = {
    // Audio elements
    audioPlayer: null,
    trainRunningSound: null,
    stopAmbience: null,
    doorAction: null,
    departAudio: null,

    // UI elements
    weatherDialog: null,
    volumePopup: null,
    routeDialog: null,
    simulateDialog: null,
    manualControlPanel: null,
    map: null,
    mapThemeSelect: null,
    mainThemeSelect: null,

    // Input elements
    rainToggle: null,
    snowToggle: null,
    dayNightModeInputs: null,
    rainIntensity: null,
    snowIntensity: null,
    weatherSpeed: null,

    // Stats elements
    duration: null,
    nextstop: null,
    currentSpeedElement: null,
    nextStopDistance: null,
    nextStopTime: null,
    finalDestinationTime: null,
    distanceCovered: null,
    liveSpeed: null,
    distanceToNext: null,
    timeToNext: null,
    timeToEnd: null,

    // Cache initialization
    init() {
        this.audioPlayer = document.getElementById('audioPlayer');
        this.trainRunningSound = document.getElementById('TrainRunningSound');
        this.stopAmbience = document.getElementById('StopAmbience');
        this.doorAction = document.getElementById('DoorAction');
        this.departAudio = document.getElementById('Departaudio');

        this.weatherDialog = document.getElementById('weatherDialog');
        this.volumePopup = document.getElementById('volumePopup');
        this.routeDialog = document.getElementById('routeDialog');
        this.simulateDialog = document.getElementById('simulateDialog');
        this.manualControlPanel = document.getElementById('manualControlPanel');
        this.map = document.getElementById('map');
        this.mapThemeSelect = document.getElementById('mapThemeSelect');
        this.mainThemeSelect = document.getElementById('mainThemeSelect');

        this.rainToggle = document.getElementById('rainToggle');
        this.snowToggle = document.getElementById('snowToggle');
        this.dayNightModeInputs = document.querySelectorAll('input[name="dayNightMode"]');
        this.rainIntensity = document.getElementById('rainIntensity');
        this.snowIntensity = document.getElementById('snowIntensity');
        this.weatherSpeed = document.getElementById('weatherSpeed');

        this.duration = document.getElementById('duration');
        this.nextstop = document.getElementById('nextstop');
        this.currentSpeedElement = document.getElementById('currentSpeed');
        this.nextStopDistance = document.getElementById('nextStopDistance');
        this.nextStopTime = document.getElementById('nextStopTime');
        this.finalDestinationTime = document.getElementById('finalDestinationTime');
        this.distanceCovered = document.getElementById('distanceCovered');
        this.liveSpeed = document.getElementById('liveSpeed');
        this.distanceToNext = document.getElementById('distanceToNext');
        this.timeToNext = document.getElementById('timeToNext');
        this.timeToEnd = document.getElementById('timeToEnd');
    }
};