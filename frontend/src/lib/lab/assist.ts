// The Control Lab's assistant (Muse Spark or Muse Wonder): it sees the machine as it is right now
// (parts and their real alternatives, sizes, failing checks and their fixes, the controller and how
// it performs) and answers in plain words. When it's asked to change something it returns actions,
// and only actions this file can check against the real catalogue and limits are ever applied: it
// can't invent a part, a size outside the slider, or a fix that doesn't exist.
import { z } from "zod";
import type { MachineCheck } from "./actuation";
import { catalogOf, setPartRef, type Assembly } from "./assembly";
import { CATALOG, CATALOG_BY_ID } from "./catalog/parts";
import { GEOMETRY, SLOTS, type DesignCheck, type HardwareBuild } from "./hardware/build";
import type { SlotId } from "./hardware/parts";
import type { ControllerSpec } from "./types";

export const ASSIST_ACTIONS = ["swap_part", "set_size", "apply_fix", "set_gains", "swap_machine_part"] as const;

export const AssistOut = z.object({
  reply: z.string().describe("Your answer in plain words, 1-4 short sentences. Say what you changed or suggest and why, with the numbers that matter."),
  mode: z
    .enum(["applied", "suggested", "answer"])
    .describe("applied: the user asked you to change something, and `actions` does it now. suggested: the user asked what to do, and `actions` are options for them to apply. answer: a question, no actions."),
  actions: z
    .array(
      z.object({
        kind: z.enum(ASSIST_ACTIONS),
        target: z.string().describe("swap_part: the slot id. set_size: the size key. apply_fix: the check id. swap_machine_part: the current part's id. set_gains: ''"),
        value: z.string().describe("swap_part / swap_machine_part: the new part's id, from that slot's options. set_size: the new value, in the unit shown. Otherwise ''"),
        kp: z.number().describe("set_gains only, else 0"),
        ki: z.number().describe("set_gains only, else 0"),
        kd: z.number().describe("set_gains only, else 0"),
        why: z.string().describe("One short reason, e.g. 'Driver peaks at 3.0 A, rated 2 A'"),
      }),
    )
    .describe("At most 4. Only ids, keys and options that appear in the machine state."),
});
export type AssistResult = z.infer<typeof AssistOut>;
export type AssistAction = AssistResult["actions"][number];

export const ASSIST_SYSTEM = `You are the engineering assistant in RoboCraft's Control Lab. The user is building a real robot from real, buyable parts; the lab simulates it and checks it against each part's datasheet.

You get the machine's current state as JSON: its part slots with the real alternatives for each, its sizes (with limits), the design checks (failing ones may carry a ready-made fix), the controller and its simulated performance.

Answer like a calm, precise engineer, in plain words and short sentences, quoting the numbers that matter (amps, volts, N·m, %).

When the user asks you to change something ("use a stronger motor", "fix the driver", "make the arm longer", "make it faster"), return actions that do it and mode "applied". When they ask what they should do, return the best options as actions with mode "suggested". For a question, mode "answer" and no actions.

Rules for actions:
- swap_part: target = a slot id, value = an option id from that slot's options. Pick by the numbers (rated current, voltage, torque, price, mass), never by name alone.
- set_size: target = a size key, value = a number in the unit shown, inside its min..max.
- apply_fix: target = the id of a failing check that has a fix.
- swap_machine_part: target = a part id from machineParts, value = an option id from that part's options.
- set_gains: PID only; give kp, ki, kd.
Never invent ids, parts or keys. If nothing listed can do what's asked, say so plainly and return no actions.`;

/** What the assistant is told about the machine: compact, and only what it can act on or explain. */
export function assistContext(opts: {
  title: string;
  build: HardwareBuild | null;
  /** Slots and sizes are editable (a demo, or a designed machine with a drivetrain). */
  slots: boolean;
  checks: DesignCheck[];
  machine: Assembly | null;
  machineChecks: MachineCheck[];
  ctrl: ControllerSpec | null;
  metrics: { stable: boolean; overshootPct: number; settlingTime: number; riseTime: number } | null;
  specs: { label: string; pass: boolean }[];
}): string {
  const { build } = opts;
  const out: Record<string, unknown> = { machine: opts.title };
  if (build && opts.slots) {
    out.kind = build.kind;
    out.slots = SLOTS[build.kind].map((s) => {
      const cur = s.options.find((o) => o.id === build.parts[s.slot]) ?? s.options[0];
      return {
        slot: s.slot,
        label: s.label,
        qty: s.qty,
        current: { id: cur.id, name: cur.name, spec: cur.spec, price: cur.price },
        options: s.options.map((o) => ({ id: o.id, name: o.name, spec: o.spec, price: o.price, massG: o.mass })),
      };
    });
    out.sizes = GEOMETRY[build.kind].map((g) => ({
      key: g.key,
      label: g.label,
      unit: g.unit,
      value: round((build.geom[g.key] ?? 0) * g.scale),
      min: round(g.min * g.scale),
      max: round(g.max * g.scale),
    }));
    out.checks = opts.checks
      .filter((c) => c.level !== "pass")
      .slice(0, 14)
      .map((c) => ({ id: c.id, level: c.level, title: c.title, detail: c.detail, fix: c.fix?.label ?? "" }));
  }
  if (opts.machine) {
    const seen = new Map<string, { id: string; name: string; category: string; qty: number; spec: string; options: { id: string; name: string; spec: string; price: number }[] }>();
    for (const p of opts.machine.parts) {
      const c = catalogOf(p);
      if (!c || p.kind !== "catalog") continue;
      const row = seen.get(c.id);
      if (row) row.qty += p.repeat;
      else
        seen.set(c.id, {
          id: p.id,
          name: c.name,
          category: c.category,
          qty: p.repeat,
          spec: c.spec,
          options: CATALOG.filter((o) => o.category === c.category && o.id !== c.id)
            .slice(0, 18)
            .map((o) => ({ id: o.id, name: o.name, spec: o.spec, price: o.priceUsd })),
        });
    }
    out.machineParts = [...seen.values()];
    out.machineChecks = opts.machineChecks
      .filter((c) => c.level !== "pass")
      .slice(0, 14)
      .map((c) => ({ level: c.level, title: c.title, detail: c.detail }));
  }
  if (opts.ctrl) out.controller = opts.ctrl;
  if (opts.metrics) out.performance = { ...opts.metrics, overshootPct: round(opts.metrics.overshootPct), settlingTime: round(opts.metrics.settlingTime), riseTime: round(opts.metrics.riseTime) };
  if (opts.specs.length) out.specs = opts.specs;
  return JSON.stringify(out);
}

const round = (v: number) => Math.round(v * 1000) / 1000;

export interface Applied {
  build: HardwareBuild | null;
  machine: Assembly | null;
  ctrl: ControllerSpec | null;
  /** What was done, in plain words. */
  done: string[];
  /** What couldn't be done, and why. */
  skipped: string[];
}

/** Applies actions to a copy of the state, checking each against the real catalogue and limits. */
export function applyActions(actions: AssistAction[], state: { build: HardwareBuild | null; slots: boolean; checks: DesignCheck[]; machine: Assembly | null; ctrl: ControllerSpec | null }): Applied {
  let build = state.build ? { ...state.build, parts: { ...state.build.parts }, geom: { ...state.build.geom } } : null;
  let machine = state.machine;
  let ctrl = state.ctrl;
  const done: string[] = [];
  const skipped: string[] = [];
  for (const a of actions.slice(0, 4)) {
    if (a.kind === "swap_part") {
      const spec = build && state.slots ? SLOTS[build.kind].find((s) => s.slot === a.target) : undefined;
      const part = spec?.options.find((o) => o.id === a.value);
      if (!build || !spec || !part) {
        skipped.push(`Couldn't swap "${a.target}": not a part option here.`);
        continue;
      }
      const was = spec.options.find((o) => o.id === build!.parts[spec.slot as SlotId]);
      build.parts[spec.slot as SlotId] = part.id;
      done.push(`${spec.label}: ${was?.name ?? "?"} → ${part.name}`);
    } else if (a.kind === "set_size") {
      const g = build && state.slots ? GEOMETRY[build.kind].find((x) => x.key === a.target) : undefined;
      const v = Number(a.value);
      if (!build || !g || !Number.isFinite(v)) {
        skipped.push(`Couldn't set "${a.target}".`);
        continue;
      }
      const si = Math.min(g.max, Math.max(g.min, v / g.scale));
      const was = (build.geom[g.key] ?? 0) * g.scale;
      build.geom[g.key] = si;
      done.push(`${g.label}: ${fmt(was)} → ${fmt(si * g.scale)} ${g.unit}${Math.abs(si * g.scale - v) > 1e-6 ? " (its limit)" : ""}`);
    } else if (a.kind === "apply_fix") {
      const c = state.checks.find((x) => x.id === a.target);
      if (!build || !c?.fix) {
        skipped.push(`No ready-made fix for "${a.target}".`);
        continue;
      }
      build = { ...build, parts: { ...build.parts, ...(c.fix.parts ?? {}) }, geom: { ...build.geom, ...(c.fix.geom ?? {}) } };
      done.push(`Fixed: ${c.title} (${c.fix.label})`);
    } else if (a.kind === "swap_machine_part") {
      const p = machine?.parts.find((x) => x.id === a.target);
      const cur = p && catalogOf(p);
      const next = CATALOG_BY_ID.get(a.value);
      if (!machine || !p || !cur || !next || next.category !== cur.category) {
        skipped.push(`Couldn't swap "${a.target}" for "${a.value}".`);
        continue;
      }
      for (const q of machine.parts) if (catalogOf(q)?.id === cur.id) machine = setPartRef(machine, q.id, next.id);
      done.push(`${cur.name} → ${next.name}`);
    } else if (a.kind === "set_gains") {
      if (ctrl?.type !== "pid" || ![a.kp, a.ki, a.kd].every((v) => Number.isFinite(v) && v >= 0) || a.kp <= 0) {
        skipped.push("Couldn't change the gains (it isn't a PID controller, or the gains weren't valid).");
        continue;
      }
      ctrl = { ...ctrl, kp: a.kp, ki: a.ki, kd: a.kd };
      done.push(`Gains: Kp ${fmt(a.kp)} · Ki ${fmt(a.ki)} · Kd ${fmt(a.kd)}`);
    }
  }
  return { build, machine, ctrl, done, skipped };
}

const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));
