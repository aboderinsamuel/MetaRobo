"use client";

// Create → Control Lab. The design itself travels: the lab turns it into a machine with the body
// exactly as designed and real hardware inside (lib/lab/fromDesign.ts), instantly and for free,
// so the robot you take there is the robot you made.
import type { Design } from "./design";
import type { Project } from "./projects";

const KEY = "rc-handoff";

export interface Handoff {
  projectId: string;
  title: string;
  design: Design;
  /** every prompt in the project up to this version, oldest first */
  prompts: string[];
  at: number;
}

export function sendToLab(project: Project): void {
  const v = project.versions[project.cursor];
  const h: Handoff = { projectId: project.id, title: v.design.title, design: v.design, prompts: project.versions.slice(0, project.cursor + 1).map((x) => x.prompt), at: Date.now() };
  try {
    localStorage.setItem(KEY, JSON.stringify(h));
  } catch {
    // Storage is full or blocked: the lab opens empty.
  }
}

/** The pending hand-off, if one was sent in the last 10 minutes; reading it clears it. */
export function takeHandoff(): Handoff | null {
  try {
    const raw = localStorage.getItem(KEY);
    localStorage.removeItem(KEY);
    if (!raw) return null;
    const h = JSON.parse(raw) as Handoff;
    return h.design && Date.now() - h.at < 10 * 60_000 ? h : null;
  } catch {
    return null;
  }
}
