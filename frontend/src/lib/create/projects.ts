"use client";

// Saved projects: every version of every design, kept in this browser (localStorage), so work
// survives reloads and you can step back and forward through versions.
import { sanitizeDesign, type Design } from "./design";

export interface Version {
  design: Design;
  /** what produced it: the prompt or the change request, or "Edited parts" */
  prompt: string;
  at: number;
}

export interface Project {
  id: string;
  title: string;
  updated: number;
  versions: Version[];
  /** which version is open */
  cursor: number;
}

const KEY = "rc-projects";

export function loadProjects(): Project[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as Project[];
    if (!Array.isArray(raw)) return [];
    // Stored designs are re-validated, so older saves pick up later repairs and nothing malformed loads.
    return raw
      .filter((p) => p && Array.isArray(p.versions) && p.versions.length)
      .map((p) => ({ ...p, cursor: Math.max(0, Math.min(p.versions.length - 1, p.cursor | 0)), versions: p.versions.map((v) => ({ ...v, design: sanitizeDesign(v.design, v.design?.version ?? 1) })) }));
  } catch {
    return [];
  }
}

/** Saves (or updates) a project; drops the oldest projects if storage is full. Returns false if it couldn't save. */
export function saveProject(p: Project): boolean {
  let all = [p, ...loadProjects().filter((x) => x.id !== p.id)];
  for (let tries = 0; tries < 8; tries++) {
    try {
      localStorage.setItem(KEY, JSON.stringify(all));
      return true;
    } catch {
      if (all.length <= 1) {
        // A single huge project: keep only its recent versions.
        if (p.versions.length <= 2) return false;
        p = { ...p, versions: p.versions.slice(-Math.ceil(p.versions.length / 2)), cursor: Math.min(p.cursor, Math.ceil(p.versions.length / 2) - 1) };
        all = [p];
      } else all = all.slice(0, -1);
    }
  }
  return false;
}

export function deleteProject(id: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(loadProjects().filter((p) => p.id !== id)));
  } catch {
    // Nothing to do.
  }
}

export const newProjectId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
