"use client";

// Light / dark / system theme. The choice is stored in localStorage and applied as
// <html data-theme>; THEME_SCRIPT runs before first paint so pages never flash the wrong theme.
import { useSyncExternalStore } from "react";
import { THEME_KEY as KEY } from "./themeScript";

export type ThemeMode = "light" | "dark" | "system";
export type Theme = "light" | "dark";

const listeners = new Set<() => void>();

function readMode(): ThemeMode {
  if (typeof document === "undefined") return "system";
  return (document.documentElement.dataset.themeMode as ThemeMode) || "system";
}

function resolve(mode: ThemeMode): Theme {
  if (mode !== "system") return mode;
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function setThemeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // Not persisted (private mode); still applies now.
  }
  document.documentElement.dataset.themeMode = mode;
  document.documentElement.dataset.theme = resolve(mode);
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  const mq = typeof matchMedia !== "undefined" ? matchMedia("(prefers-color-scheme: light)") : null;
  const onSystem = () => {
    if (readMode() === "system") setThemeMode("system");
  };
  mq?.addEventListener("change", onSystem);
  return () => {
    listeners.delete(l);
    mq?.removeEventListener("change", onSystem);
  };
}

/** The resolved theme ("light" | "dark"); dark on the server. */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, () => (document.documentElement.dataset.theme as Theme) || "dark", () => "dark");
}

export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(subscribe, readMode, () => "system");
}
