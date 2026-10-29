// Behaviour simulation for sensing / automation machines: sensor signals change over time, the
// controller's rules switch outputs, outputs change the signals back, and real part ratings set
// the rates (a 1.2 L/min pump drains a 1 L reservoir in 50 s of pumping). Slow processes are
// time-compressed for playback (timeScale simulated seconds per real second).
import type { CatalogPart } from "./catalog/parts";
import { catalogOf, type Assembly, type PartSpec } from "./assembly";
import type { MachineCheck } from "./actuation";

export interface BehaviourSim {
  /** simulated seconds per sample */
  dtSim: number;
  timeScale: number;
  /** real playback seconds this behaviour lasts */
  duration: number;
  samples: number;
  signals: { id: string; name: string; unit: string; min: number; max: number; shows: string; value: Float32Array }[];
  /** which outputs are on, per sample */
  on: Map<string, Uint8Array>;
  /** display text changes: [sample index, text] in order */
  text: Map<string, [number, string][]>;
  /** reservoirs' fill 0..1 */
  fill: Map<string, Float32Array>;
  /** tubes (connection index) carrying water, per sample */
  flowing: Map<number, Uint8Array>;
  current: Float32Array;
  triggers: { rule: number; t: number }[];
  /** real playback time at each sample: fast through quiet stretches, slow while outputs are on */
  realT: Float32Array;
  /** playback speed (simulated s per real s) at each sample */
  speed: Float32Array;
}

const RELAY_LIKE = new Set(["relay-1ch", "relay-2ch", "mosfet-module", "l298n", "tb6612", "drv8833", "motor-shield-v2"]);

function ratedA(c: CatalogPart | undefined): number {
  if (!c) return 0.02;
  if (c.actuator) return (c.actuator.idleA + c.actuator.stallA) / 2;
  if (c.model === "relay_module") return 0.07 * (c.electrical?.channels ?? 1);
  if (c.model === "solenoid_valve") return 0.5;
  if (c.model === "buzzer") return 0.03;
  if (c.model === "led") return 0.02;
  if (c.model === "lcd") return 0.03;
  return 0.02;
}

const fmt = (v: number) => (Math.abs(v) >= 100 ? Math.round(v).toString() : (Math.round(v * 10) / 10).toString());

export function simulateBehaviour(a: Assembly): BehaviourSim | null {
  if (!a.signals.length && !a.rules.length) return null;
  const partById = new Map(a.parts.map((p) => [p.id, p]));
  const T = a.simSeconds > 0 ? a.simSeconds : 600;
  const n = Math.min(3000, Math.max(200, Math.round(T / 0.5)));
  const dt = T / (n - 1);
  const timeScale = Math.max(1, a.timeScale || 1);

  const values = a.signals.map((s) => s.start);
  const sigOut = a.signals.map((s) => ({ id: s.id, name: s.name, unit: s.unit, min: s.min, max: s.max, shows: s.shows, value: new Float32Array(n) }));
  const outputs = new Set<string>();
  for (const r of a.rules) for (const o of r.outputs) outputs.add(o.part);
  // Parts powered *through* a relay / MOSFET switch on with it.
  const downstream = new Map<string, string[]>();
  for (const c of a.connections) {
    const fromCat = catalogOf(partById.get(c.from) ?? ({} as PartSpec));
    if ((c.kind === "motor" || c.kind === "power") && fromCat && RELAY_LIKE.has(fromCat.id)) {
      downstream.set(c.from, [...(downstream.get(c.from) ?? []), c.to]);
      outputs.add(c.to);
    }
  }
  for (const s of a.signals) for (const e of s.effects) outputs.add(e.part);
  const on = new Map<string, Uint8Array>([...outputs].map((id) => [id, new Uint8Array(n)]));
  const text = new Map<string, [number, string][]>();
  const lastText = new Map<string, string>();

  // Water: each reservoir holds ~1 L unless the catalogue says otherwise; pumps draw at their rated flow.
  const reservoirs = a.parts.filter((p) => p.model === "reservoir");
  const volume = new Map(reservoirs.map((r) => [r.id, 1]));
  const fill = new Map(reservoirs.map((r) => [r.id, new Float32Array(n)]));
  const pumps = a.parts.filter((p) => catalogOf(p)?.fluid && catalogOf(p)?.actuator);
  const tubes = a.connections.map((c, i) => [c, i] as const).filter(([c]) => c.kind === "tube");
  const flowing = new Map<number, Uint8Array>(tubes.map(([, i]) => [i, new Uint8Array(n)]));
  const current = new Float32Array(n);

  const active = a.rules.map(() => false);
  const triggers: BehaviourSim["triggers"] = [];

  for (let k = 0; k < n; k++) {
    // 1. Controller: evaluate every rule with hysteresis.
    a.rules.forEach((r, ri) => {
      const si = a.signals.findIndex((s) => s.id === r.signal);
      const v = values[si];
      const enter = r.op === "<" ? v < r.value : v > r.value;
      const stay = r.op === "<" ? v < r.value + r.hysteresis : v > r.value - r.hysteresis;
      const was = active[ri];
      active[ri] = was ? stay : enter;
      if (!was && active[ri]) triggers.push({ rule: ri, t: k * dt });
    });
    const nowOn = new Set<string>();
    a.rules.forEach((r, ri) => {
      if (!active[ri]) return;
      for (const o of r.outputs) {
        if (o.action === "display") continue;
        // Beeps pulse: 0.2 s on, 0.8 s off (in real playback time).
        if (o.action === "beep" && Math.floor((k * dt) / timeScale / 0.5) % 2 === 1) continue;
        nowOn.add(o.part);
      }
    });
    // Power flows through switched relays / MOSFETs to what they drive.
    for (const id of [...nowOn]) for (const d of downstream.get(id) ?? []) nowOn.add(d);
    // A pump with an empty reservoir runs dry.
    for (const [id, arr] of on) arr[k] = nowOn.has(id) ? 1 : 0;

    // 2. Displays: the active rule's text, else a live readout of the signals.
    for (const p of a.parts.filter((x) => x.model === "lcd" || x.model === "oled")) {
      const ruleText = a.rules.find((r, ri) => active[ri] && r.outputs.some((o) => o.part === p.id && o.action === "display"))?.outputs.find((o) => o.part === p.id && o.action === "display")?.text;
      const idle = a.signals
        .slice(0, 2)
        .map((s, i) => `${s.name.slice(0, 10)} ${fmt(values[i])}${s.unit}`)
        .join("\n");
      const t = (ruleText || idle).replace(/\{(\w+)\}/g, (_, id) => {
        const i = a.signals.findIndex((s) => s.id === id);
        return i >= 0 ? fmt(values[i]) : `{${id}}`;
      });
      if (lastText.get(p.id) !== t) {
        lastText.set(p.id, t);
        text.set(p.id, [...(text.get(p.id) ?? []), [k, t]]);
      }
    }

    // 3. Water: running pumps draw from reservoirs and fill their tubes.
    let drawn = 0;
    for (const p of pumps) {
      if (!nowOn.has(p.id)) continue;
      drawn += (catalogOf(p)!.fluid!.flowLpm / 60) * dt;
    }
    for (const r of reservoirs) {
      const v = Math.max(0, (volume.get(r.id) ?? 1) - drawn / Math.max(1, reservoirs.length));
      volume.set(r.id, v);
      fill.get(r.id)![k] = v;
    }
    const dry = reservoirs.length > 0 && reservoirs.every((r) => (volume.get(r.id) ?? 0) <= 0);
    for (const [c, i] of tubes) {
      const pumpOn = pumps.some((p) => nowOn.has(p.id) && (c.from === p.id || c.to === p.id));
      flowing.get(i)![k] = pumpOn && !dry ? 1 : 0;
    }

    // 4. Signals change: natural drift plus the effect of outputs that are on (none if the pump runs dry).
    a.signals.forEach((s, i) => {
      let rate = s.drift;
      for (const e of s.effects) if (nowOn.has(e.part) && !(dry && pumps.some((p) => p.id === e.part))) rate += e.rate;
      values[i] = Math.max(s.min, Math.min(s.max, values[i] + rate * dt));
      sigOut[i].value[k] = values[i];
    });

    // 5. Current draw of everything switched on.
    let amps = 0;
    for (const id of nowOn) amps += ratedA(catalogOf(partById.get(id) ?? ({} as PartSpec)));
    current[k] = amps;
  }

  // Event-aware time: race through quiet stretches at timeScale, slow right down while anything is
  // switched on, so a 7 s watering burst is watchable instead of a 0.04 s flash.
  const slow = Math.max(1, Math.min(4, timeScale / 50));
  const realT = new Float32Array(n);
  const speed = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    let busy = false;
    for (const arr of on.values()) if (arr[Math.max(0, k - 1)] || arr[k] || arr[Math.min(n - 1, k + 1)]) busy = true;
    speed[k] = busy ? slow : timeScale;
    if (k > 0) realT[k] = realT[k - 1] + dt / speed[k];
  }
  // Very long runs are scaled to fit 90 s of playback, keeping the slow-motion ratio.
  const raw = realT[n - 1];
  if (raw > 90) for (let k = 0; k < n; k++) {
    realT[k] *= 90 / raw;
    speed[k] *= raw / 90;
  }
  const duration = Math.max(4, realT[n - 1]);
  return { dtSim: dt, timeScale, duration, samples: n, signals: sigOut, on, text, fill, flowing, current, triggers, realT, speed };
}

/** Sample index at real playback time t (binary search over the event-aware time map). */
export function behaviourIndex(b: BehaviourSim, t: number): number {
  const r = b.realT;
  if (t <= 0) return 0;
  if (t >= r[b.samples - 1]) return b.samples - 1;
  let lo = 0;
  let hi = b.samples - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (r[mid] <= t) lo = mid;
    else hi = mid;
  }
  return lo;
}

export function textAt(b: BehaviourSim, part: string, k: number): string | undefined {
  const list = b.text.get(part);
  if (!list) return undefined;
  let t: string | undefined;
  for (const [i, s] of list) {
    if (i > k) break;
    t = s;
  }
  return t;
}

/** Engineering checks on the behaviour and the wiring. */
export function behaviourChecks(a: Assembly, b: BehaviourSim | null): MachineCheck[] {
  const out: MachineCheck[] = [];
  const name = (id: string) => a.parts.find((p) => p.id === id)?.name ?? id;

  // Wiring: every electrical part needs at least one connection; outputs need power to switch.
  const wired = new Set(a.connections.flatMap((c) => [c.from, c.to]));
  const needsWire = a.parts.filter((p) => {
    const c = catalogOf(p);
    return !!c && ["sensor", "driver", "motor", "servo", "stepper", "controller"].includes(c.category) || ["buzzer", "led", "lcd", "oled", "fan"].includes(p.model ?? "");
  });
  const loose = needsWire.filter((p) => !wired.has(p.id));
  if (needsWire.length && !a.connections.length) out.push({ id: "wiring", level: "error", title: "Nothing is wired", detail: "The design lists no connections, so no part gets power or signals." });
  else if (loose.length) out.push({ id: "wiring", level: "warn", part: loose[0].id, title: `${loose.length} part${loose.length > 1 ? "s aren't" : " isn't"} wired`, detail: loose.map((p) => p.name).join(", ") });
  else if (a.connections.length) out.push({ id: "wiring", level: "pass", title: `Wiring complete: ${a.connections.length} connections`, detail: `${a.connections.filter((c) => c.kind === "tube").length} tube(s), ${a.connections.filter((c) => c.kind !== "tube").length} wire(s).` });

  const pumps = a.parts.filter((p) => catalogOf(p)?.fluid);
  for (const p of pumps) {
    if (!a.connections.some((c) => c.kind === "tube" && (c.from === p.id || c.to === p.id))) out.push({ id: `tube-${p.id}`, level: "warn", part: p.id, title: `${p.name} has no tube`, detail: "Connect its outlet to where the water should go (kind: tube)." });
  }

  if (!b) return out;
  a.rules.forEach((r, i) => {
    const fired = b.triggers.some((t) => t.rule === i);
    if (!fired) out.push({ id: `rule-${i}`, level: "info", title: `Rule never triggered: ${r.signal} ${r.op} ${r.value}`, detail: `Over ${Math.round(b.dtSim * b.samples)} simulated seconds the signal never crossed the threshold. Change its start, drift or threshold.` });
    else out.push({ id: `rule-${i}`, level: "pass", title: `Logic works: ${r.signal} ${r.op} ${r.value} → ${r.outputs.map((o) => name(o.part)).join(", ")}`, detail: `Triggered ${b.triggers.filter((t) => t.rule === i).length}× in ${Math.round(b.dtSim * b.samples)} simulated seconds.` });
  });
  for (const [id, f] of b.fill) {
    if (f[b.samples - 1] <= 0) out.push({ id: `dry-${id}`, level: "warn", part: id, title: `${name(id)} runs dry`, detail: "The pump empties the reservoir during the run: add a level sensor rule or a bigger tank." });
  }
  b.signals.forEach((s, i) => {
    const r = a.rules.find((x) => x.signal === s.id);
    if (!r) return;
    const end = s.value[b.samples - 1];
    const stuck = r.op === "<" ? end < r.value : end > r.value;
    if (stuck && b.triggers.some((t) => a.rules[t.rule] === r)) out.push({ id: `recover-${i}`, level: "warn", title: `${s.name} doesn't recover`, detail: `It ends at ${fmt(end)}${s.unit}, still past the ${r.value}${s.unit} threshold: the outputs aren't strong enough.` });
  });
  return out;
}
