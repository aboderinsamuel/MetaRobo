// Per-actuator simulation of an AI-designed machine: every joint is driven by a real catalogue
// actuator, so it moves with that part's real limits.
//
// - Positional servos slew towards each target; their speed falls with load torque
//   (ω = ω₀ · (1 − τ/τ_stall)) and they stall when the load exceeds the stall torque.
// - DC motors and continuous servos follow the speed–torque line with a mechanical time constant.
// - Steppers follow a speed limit and miss steps when the load nears holding torque.
// - Arm kits move as a whole (stroke 0–1) at their servos' speed.
// Current is estimated from the torque each actuator delivers; the checks compare torque, current,
// voltage, drivers and runtime against the parts in the design.
import type { Actuator, CatalogPart } from "./catalog/parts";
import { catalogOf, type Assembly, type JointSpec, type PartSpec } from "./assembly";

export const SIM_DT = 0.01;

export interface JointTrace {
  joint: JointSpec;
  actuator: CatalogPart | undefined;
  /** deg (rotate), rpm (spin), mm (slide/lift) or stroke (articulate), per sample */
  value: Float32Array;
  /** integrated angle for spin joints, deg */
  angle: Float32Array;
  current: Float32Array;
  /** load torque / stall torque */
  torqueRatio: number;
  torqueKgcm: number;
  stalled: boolean;
  /** first time a target couldn't be reached in its step, if any */
  late: { step: number; label: string } | null;
}

export interface MachineCheck {
  id: string;
  level: "pass" | "warn" | "error" | "info";
  title: string;
  detail: string;
  part?: string;
}

export interface MachineSim {
  dt: number;
  tEnd: number;
  steps: { t0: number; t1: number; label: string }[];
  traces: JointTrace[];
  totalCurrent: Float32Array;
  peakA: number;
  avgA: number;
  checks: MachineCheck[];
}

function actuatorOf(a: Assembly, j: JointSpec, extra: Map<string, CatalogPart>): { part?: PartSpec; cat?: CatalogPart } {
  const part = a.parts.find((p) => p.id === j.actuator);
  const cat = part ? ((part.catalogId ? extra.get(part.catalogId) : undefined) ?? catalogOf(part)) : undefined;
  return { part, cat };
}

/** Load torque in kg·cm from grams at a lever arm in mm (worst case: arm horizontal). */
export const loadKgcm = (loadG: number, leverMm: number) => (loadG * leverMm) / 10000;

/** Kit / claw / pan-tilt joints don't list their own servo: use typical figures. */
const KIT_ACTUATOR: Actuator = { kind: "servo", ratedV: 7.4, stallKgcm: 17, speed: 300, rangeDeg: 240, stallA: 1.8, idleA: 0.1 };

export function simulateMachine(a: Assembly, extraParts: CatalogPart[] = []): MachineSim {
  const extra = new Map(extraParts.map((p) => [p.id, p]));
  // Timeline: a short settle, the program's steps, then a hold so the end is visible.
  const steps: MachineSim["steps"] = [];
  let t = 0.3;
  for (const s of a.program) {
    steps.push({ t0: t, t1: t + s.duration, label: s.label });
    t += s.duration;
  }
  const tEnd = Math.min(90, t + 0.6);
  const n = Math.max(2, Math.round(tEnd / SIM_DT) + 1);
  const traces: JointTrace[] = [];
  const total = new Float32Array(n);

  for (const j of a.joints) {
    const { cat } = actuatorOf(a, j, extra);
    const act: Actuator = cat?.actuator ?? KIT_ACTUATOR;
    const isKit = !cat?.actuator;
    const value = new Float32Array(n);
    const angle = new Float32Array(n);
    const current = new Float32Array(n);
    const tauLoad = j.kind === "spin" || j.kind === "slide" ? loadKgcm(j.loadG, j.leverMm) * 0.3 : loadKgcm(j.loadG, j.leverMm);
    const ratio = act.stallKgcm > 0 ? tauLoad / act.stallKgcm : 0;
    const stalled = ratio >= 1;
    const derate = Math.max(0, 1 - Math.min(1, ratio));

    // Rest value: the middle of the range for rotate, the minimum otherwise.
    const rest = j.kind === "rotate" ? Math.max(j.min, Math.min(j.max, 0 >= j.min && 0 <= j.max ? 0 : (j.min + j.max) / 2)) : j.kind === "articulate" ? 0 : Math.max(0, j.min);
    let x = rest;
    let target = rest;
    let late: JointTrace["late"] = null;
    let ang = 0;
    let stepIdx = -1;

    // Slew rate in the joint's own units per second.
    const rate = (() => {
      switch (j.kind) {
        case "rotate":
          return act.kind === "stepper" ? (act.speed * 6) * (ratio > 0.7 ? 0.3 : 1) : act.speed * derate;
        case "articulate":
          return isKit ? (act.speed * derate) / 180 : (act.speed * derate) / 180;
        case "slide":
        case "lift":
          // Lead screw 8 mm/rev for steppers / motors; a servo horn of `leverMm` otherwise.
          return act.kind === "servo" ? ((act.speed * Math.PI) / 180) * Math.max(10, j.leverMm) * derate : ((act.speed * 8) / 60) * derate;
        default:
          return Infinity;
      }
    })();
    const maxRpm = act.speed * derate;
    const tauM = 0.12;

    const tol = Math.max(1e-3, Math.abs(j.max - j.min) * 0.03);
    let judged = -1;
    for (let i = 0; i < n; i++) {
      const ti = i * SIM_DT;
      // When a step's time runs out, has this joint reached its target?
      if (stepIdx > judged && ti >= steps[stepIdx].t1) {
        judged = stepIdx;
        if (!late && !stalled && j.kind !== "spin" && Math.abs(x - target) > tol) late = { step: stepIdx, label: steps[stepIdx].label };
      }
      // Pick up the target for the step we're in.
      const si = steps.findIndex((s) => ti >= s.t0 && ti < s.t1);
      if (si !== stepIdx && si >= 0) {
        stepIdx = si;
        const tg = a.program[si].targets.find((q) => q.joint === j.id);
        if (tg) target = Math.max(j.min, Math.min(j.max, tg.value));
      }
      let moving = 0;
      if (j.kind === "spin") {
        const goal = Math.sign(target) * Math.min(Math.abs(target), maxRpm);
        x += ((goal - x) * SIM_DT) / tauM;
        moving = Math.abs(goal - x) / Math.max(1, maxRpm);
        ang += x * 6 * SIM_DT; // rpm → deg/s
      } else if (stalled && (j.kind === "rotate" || j.kind === "lift" || j.kind === "articulate")) {
        // Can't lift the load: it sags back towards rest.
        x += (rest - x) * Math.min(1, SIM_DT * 2);
      } else {
        const d = target - x;
        const step = rate * SIM_DT;
        x += Math.abs(d) <= step ? d : Math.sign(d) * step;
        moving = Math.abs(d) > 1e-6 ? 1 : 0;
      }
      value[i] = x;
      angle[i] = j.kind === "spin" ? ang : x;
      // Current: holding the load plus a share for accelerating / slewing.
      const hold = j.kind === "spin" ? Math.abs(x) / Math.max(1, act.speed) * 0.4 + Math.min(1, ratio) * 0.6 : Math.min(1, ratio);
      current[i] = act.idleA + (act.stallA - act.idleA) * Math.min(1, hold * 0.85 + moving * 0.25) * (isKit ? 3 : 1);
      total[i] += current[i];
    }
    traces.push({ joint: j, actuator: cat, value, angle, current, torqueRatio: ratio, torqueKgcm: tauLoad, stalled, late });
  }

  // Controllers and sensors draw a little too.
  const base = a.parts.reduce((s, p) => {
    const c = catalogOf(p);
    if (!c) return s;
    if (c.category === "controller") return s + (c.model === "board_pi" ? 0.8 : 0.08) * p.repeat;
    if (c.category === "sensor") return s + 0.02 * p.repeat;
    return s;
  }, 0);
  let peakA = 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    total[i] += base;
    peakA = Math.max(peakA, total[i]);
    sum += total[i];
  }
  const avgA = sum / n;
  return { dt: SIM_DT, tEnd, steps, traces, totalCurrent: total, peakA, avgA, checks: machineChecks(a, traces, peakA, avgA, extra) };
}

function machineChecks(a: Assembly, traces: JointTrace[], peakA: number, avgA: number, extra: Map<string, CatalogPart>): MachineCheck[] {
  const out: MachineCheck[] = [];
  const cat = (p: PartSpec) => (p.catalogId ? extra.get(p.catalogId) : undefined) ?? catalogOf(p);
  const name = (id: string) => a.parts.find((p) => p.id === id)?.name ?? id;

  for (const tr of traces) {
    const j = tr.joint;
    const pct = Math.round(tr.torqueRatio * 100);
    const actName = tr.actuator?.name ?? name(j.actuator);
    if (j.kind === "rotate" || j.kind === "lift" || j.kind === "articulate") {
      if (tr.stalled) {
        out.push({ id: `torque-${j.id}`, level: "error", part: j.actuator, title: `${name(j.part)}: ${actName} can't lift it`, detail: `Needs ${tr.torqueKgcm.toFixed(1)} kg·cm, the actuator stalls at ${tr.actuator?.actuator?.stallKgcm ?? "?"} kg·cm. Use a stronger servo, shorten the lever or lighten the load.` });
      } else if (tr.torqueRatio > 0.6) {
        out.push({ id: `torque-${j.id}`, level: "warn", part: j.actuator, title: `${name(j.part)}: ${pct}% of stall torque`, detail: `${tr.torqueKgcm.toFixed(1)} kg·cm of load on ${actName}. Above ~60 % servos run hot, slow down and wear their gears.` });
      } else if (j.loadG > 0) {
        out.push({ id: `torque-${j.id}`, level: "pass", part: j.actuator, title: `${name(j.part)}: torque OK (${pct}% of stall)`, detail: `${tr.torqueKgcm.toFixed(2)} kg·cm on ${actName}.` });
      }
    }
    const range = tr.actuator?.actuator?.rangeDeg;
    if (j.kind === "rotate" && range && j.max - j.min > range + 1) {
      out.push({ id: `range-${j.id}`, level: "warn", part: j.actuator, title: `${name(j.part)}: asks for ${Math.round(j.max - j.min)}° of travel`, detail: `${actName} only turns ${range}°.` });
    }
    if (tr.late) out.push({ id: `late-${j.id}`, level: "warn", part: j.actuator, title: `${name(j.part)} is too slow for "${tr.late.label}"`, detail: `${actName} can't reach its target in the step's time at its real speed. Give the step more time.` });
  }

  // Limbs: a moving printed or laser-cut bar is not how real robots are built.
  for (const tr of traces) {
    const moving = a.parts.filter((p) => p.id === tr.joint.part || p.parent === tr.joint.part);
    const bar = moving.find((p) => p.kind === "fab" && (p.fab === "printed" || p.fab === "plate") && Math.max(...p.size) > 0.06);
    if (bar) {
      out.push({
        id: `limb-${tr.joint.id}`,
        level: "warn",
        part: bar.id,
        title: `${bar.name} is a ${bar.fab === "printed" ? "3D-printed" : "laser-cut"} bar used as a moving limb`,
        detail: `Real builds use aluminium servo brackets between servos (bracket-multi-servo / bracket-u-servo), which are stiffer and bolt straight onto the horns. Swap it in the Parts panel.`,
      });
    }
  }

  // Power: does a supply exist, does its voltage suit the actuators, can it deliver the peak?
  const supplies = a.parts.filter((p) => cat(p)?.category === "power");
  const batteries = supplies.filter((p) => cat(p)?.electrical?.mAh);
  const regulators = supplies.filter((p) => cat(p)?.model === "buck");
  if (!supplies.length) {
    out.push({ id: "power", level: "error", title: "No power source", detail: "Add a battery pack or power adapter that suits the actuators." });
  } else {
    const src = cat(batteries[0] ?? supplies[0])!;
    const maxA = Math.max(...supplies.map((p) => cat(p)?.electrical?.maxA ?? 0));
    out.push(
      peakA > maxA
        ? { id: "current", level: "error", title: `Peak current ${peakA.toFixed(1)} A exceeds the supply`, detail: `${src.name} and regulators deliver about ${maxA} A. Add a UBEC / bigger supply, or move fewer joints at once.` }
        : peakA > maxA * 0.8
          ? { id: "current", level: "warn", title: `Peak current ${peakA.toFixed(1)} A is near the supply limit (${maxA} A)`, detail: "Expect brown-outs when every joint moves at once." }
          : { id: "current", level: "pass", title: `Current OK: peak ${peakA.toFixed(1)} A of ${maxA} A`, detail: `${src.name}.` },
    );
    const vSrc = src.electrical?.vMax ?? 0;
    const lowV = traces.filter((t) => t.actuator?.actuator && vSrc > t.actuator.actuator.ratedV * 1.25);
    if (lowV.length && !regulators.length) {
      const names = [...new Set(lowV.map((t) => t.actuator!.name))].join(", ");
      out.push({ id: "voltage", level: "error", title: "Actuators would be over-volted", detail: `${src.name} gives up to ${vSrc} V, but ${names} ${lowV.length > 1 ? "are" : "is"} rated about ${lowV[0].actuator!.actuator!.ratedV} V. Add a buck converter or UBEC.` });
    }
    const mAh = batteries.length ? cat(batteries[0])?.electrical?.mAh : undefined;
    if (mAh && avgA > 0) out.push({ id: "runtime", level: "info", title: `Runtime ≈ ${Math.round((mAh / 1000 / avgA) * 60 * 0.8)} min`, detail: `At the program's average draw of ${avgA.toFixed(2)} A from ${mAh} mAh (80 % usable).` });
  }

  // Drivers: servos need PWM channels; motors need H-bridges; steppers need step drivers.
  const count = (pred: (c: CatalogPart) => boolean) => a.parts.reduce((s, p) => s + (cat(p) && pred(cat(p)!) ? p.repeat : 0), 0);
  const servos = count((c) => c.category === "servo");
  const dcs = count((c) => c.category === "motor");
  const steppers = count((c) => c.category === "stepper");
  const has = (id: string) => a.parts.some((p) => p.catalogId === id);
  if (!a.parts.some((p) => cat(p)?.category === "controller")) out.push({ id: "controller", level: "error", title: "No controller", detail: "Add an Arduino, ESP32, Pico or Raspberry Pi to run the program." });
  if (servos > 6 && !has("pca9685")) out.push({ id: "servo-driver", level: "warn", title: `${servos} servos without a servo driver`, detail: "Add a PCA9685 16-channel driver so the controller isn't out of PWM pins, and power servos from it." });
  if (dcs > 0 && !a.parts.some((p) => ["l298n", "tb6612", "drv8833", "motor-shield-v2"].includes(p.catalogId ?? ""))) out.push({ id: "motor-driver", level: "error", title: `${dcs} DC motor${dcs > 1 ? "s" : ""} without a motor driver`, detail: "Add an L298N, TB6612 or DRV8833; a microcontroller pin can't drive a motor." });
  if (steppers > 0 && !a.parts.some((p) => ["a4988", "uln2003"].includes(p.catalogId ?? ""))) out.push({ id: "stepper-driver", level: "error", title: "Stepper without a driver", detail: "Add an A4988 (NEMA 17) or ULN2003 (28BYJ-48)." });
  if (a.unresolved?.length) out.push({ id: "unresolved", level: "warn", title: `${a.unresolved.length} part${a.unresolved.length > 1 ? "s" : ""} not in the catalogue`, detail: a.unresolved.join(", ") });
  if (!a.joints.length) out.push({ id: "joints", level: "info", title: "Nothing moves yet", detail: "Select a part and give it a joint driven by one of the servos or motors." });

  const rank = { error: 0, warn: 1, info: 2, pass: 3 };
  return out.sort((x, y) => rank[x.level] - rank[y.level]);
}

/** Sample a trace at time t (linear interpolation). */
export function at(arr: Float32Array, t: number, dt = SIM_DT): number {
  if (!arr.length) return 0;
  const f = Math.max(0, t / dt);
  const i = Math.min(arr.length - 1, Math.floor(f));
  const k = Math.min(arr.length - 1, i + 1);
  return arr[i] + (arr[k] - arr[i]) * Math.min(1, f - i);
}
