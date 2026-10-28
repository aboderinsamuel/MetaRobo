// Playback clock shared by the 3D view, its HUD and the chart cursors. It lives outside React
// state: the render loop advances it every frame and only the few small widgets that display the
// time subscribe, so playback never re-renders the lab or the 3D scene tree.
import { useSyncExternalStore } from "react";

export interface PlaybackState {
  t: number;
  playing: boolean;
  rate: number;
  tEnd: number;
}

export interface Playback extends PlaybackState {
  /** Bumped on every notify; the snapshot for subscribers. */
  version: number;
  subscribe: (fn: () => void) => () => void;
  notify: () => void;
  set: (patch: Partial<PlaybackState>, notify?: boolean) => void;
  /** Advances by a frame's delta; publishes to subscribers about 30 times a second. */
  tick: (delta: number) => void;
  /** Simulate / pause / resume; restarts from the beginning once the run has finished. */
  toggle: () => void;
}

export function createPlayback(): Playback {
  const listeners = new Set<() => void>();
  let lastPublish = 0;
  const p: Playback = {
    t: 0,
    playing: false,
    rate: 1,
    tEnd: 1,
    version: 0,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    notify: () => {
      p.version++;
      listeners.forEach((fn) => fn());
    },
    set: (patch, notify = true) => {
      Object.assign(p, patch);
      if (notify) p.notify();
    },
    tick: (delta) => {
      if (!p.playing) return;
      p.t = Math.min(p.tEnd, p.t + Math.min(delta, 0.05) * p.rate);
      if (p.t >= p.tEnd) p.playing = false;
      const now = performance.now();
      if (now - lastPublish > 33 || !p.playing) {
        lastPublish = now;
        p.notify();
      }
    },
    toggle: () => {
      if (p.playing) p.playing = false;
      else {
        if (p.t >= p.tEnd - 1e-9) p.t = 0;
        p.playing = true;
      }
      p.notify();
    },
  };
  return p;
}

/** Re-renders the caller whenever the clock is published. */
export function usePlayback(p: Playback): { t: number; playing: boolean } {
  useSyncExternalStore(
    p.subscribe,
    () => p.version,
    () => 0,
  );
  return { t: p.t, playing: p.playing };
}
