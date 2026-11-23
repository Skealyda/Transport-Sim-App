// ====================================
// AUDIO & VOLUME CONTROLS
// ====================================
import state from './state.js';
import { setEffectsVolume, getEffectsVolume } from './soundEngine.js';

// Reflect the effective volumes (effects default 60%, persisted) in the popup sliders.
export function initVolumeControls() {
    const effects = document.getElementById('effectsVolume');
    if (effects) effects.value = String(getEffectsVolume());
    const voice = document.getElementById('voiceVolume');
    if (voice) voice.value = String(state.voiceVolume);
}

// Toggle the visibility of the volume pop-up
export function toggleVolumePopup() {
    const volumePopup = document.getElementById("volumePopup");
    if (!volumePopup) {
        console.error("Volume popup element not found!");
        return;
    }

    // Toggle the display property
    if (volumePopup.style.display === "none" || volumePopup.style.display === "") {
        volumePopup.style.display = "block";
    } else {
        volumePopup.style.display = "none";
    }

    console.log("Volume popup toggled:", volumePopup.style.display);
}

export function updateVoiceVolume(value) {
    state.voiceVolume = parseFloat(value);
    console.log(`Voice volume set to: ${state.voiceVolume}`);
}

// Master volume for sound effects; per-sound fades (e.g. the running sound) stay independent.
export function updateEffectsVolume(value) {
    setEffectsVolume(value);
    console.log(`Sound effects volume set to: ${value}`);
}
