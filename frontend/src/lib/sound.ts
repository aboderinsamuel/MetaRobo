"use client";

// Subtle UI sounds for the landing page, synthesised with WebAudio (no audio files): a soft tick on
// hover, a two-note chime on selection. On by default once the visitor has interacted (browsers
// block audio before that); the toggle is remembered in localStorage.
import { useSyncExternalStore } from "react";

const KEY = "rc-sound";
const listeners = new Set<() => void>();
let enabled: boolean | null = null;
let ctx: AudioContext | null = null;

function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function soundOn(): boolean {
  if (enabled === null) enabled = typeof window !== "undefined" && read();
  return enabled;
}

export function setSound(on: boolean) {
  enabled = on;
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // Not persisted; still applies now.
  }
  if (!on) window.speechSynthesis?.cancel();
  listeners.forEach((l) => l());
}

export function useSound(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    soundOn,
    () => false,
  );
}

function audio(): AudioContext | null {
  if (!soundOn() || typeof window === "undefined") return null;
  // Only after a real user gesture, so we never trip the autoplay policy.
  if (!navigator.userActivation?.hasBeenActive) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function blip(c: AudioContext, freq: number, at: number, dur: number, gain: number, type: OscillatorType = "sine") {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(c.destination);
  o.start(at);
  o.stop(at + dur + 0.02);
}

let lastTick = 0;
/** A short, quiet tick for hovers. Rate-limited so sweeping across a grid doesn't buzz. */
export function tick() {
  const c = audio();
  if (!c || c.currentTime - lastTick < 0.05) return;
  lastTick = c.currentTime;
  blip(c, 1800, c.currentTime, 0.035, 0.025, "triangle");
}

/** A rising two-note chime for selections. */
export function chime() {
  const c = audio();
  if (!c) return;
  const t = c.currentTime;
  blip(c, 880, t, 0.18, 0.045);
  blip(c, 1320, t + 0.07, 0.24, 0.04);
}
