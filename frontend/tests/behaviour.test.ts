// Behaviour simulation: sensors, controller rules, outputs, water, wiring checks.
import { describe, expect, it } from "vitest";
import { simulateMachine } from "@/lib/lab/actuation";
import { sanitizeAssembly, type AssemblyInput } from "@/lib/lab/assembly";
import { behaviourIndex, textAt } from "@/lib/lab/behaviour";

type Raw = AssemblyInput["parts"][number];
const raw = (p: Partial<Raw> & Pick<Raw, "id" | "ref">): Raw => ({
  name: p.id,
  parent: "",
  size: [0, 0, 0],
  material: "",
  color: "",
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  repeat: 1,
  repeatMode: "radial",
  repeatAxis: "y",
  repeatStep: 0,
  ...p,
});

/** The plant waterer from the user's prompt, wired like a real build. */
function waterer({ wired = true, tube = true, pumpRate = 2 } = {}) {
  return sanitizeAssembly({
    title: "Plant waterer",
    parts: [
      raw({ id: "base", ref: "fab:plate", size: [0.16, 0.003, 0.12] }),
      raw({ id: "uno", ref: "arduino-uno", parent: "base" }),
      raw({ id: "relay", ref: "relay-1ch", parent: "base" }),
      raw({ id: "buzzer", ref: "buzzer-active", parent: "base" }),
      raw({ id: "lcd", ref: "lcd1602-i2c", parent: "base" }),
      raw({ id: "power", ref: "usb-5v-2a", parent: "base" }),
      raw({ id: "pot", ref: "pot-12cm" }),
      raw({ id: "probe", ref: "soil-cap-v12", parent: "pot" }),
      raw({ id: "tank", ref: "reservoir-1l" }),
      raw({ id: "pump", ref: "pump-mini-5v", parent: "tank" }),
    ],
    connections: wired
      ? [
          { from: "power", fromPin: "5V", to: "uno", toPin: "5V", kind: "power" },
          { from: "uno", fromPin: "5V", to: "probe", toPin: "VCC", kind: "power" },
          { from: "uno", fromPin: "GND", to: "probe", toPin: "GND", kind: "ground" },
          { from: "probe", fromPin: "AOUT", to: "uno", toPin: "A0", kind: "signal" },
          { from: "uno", fromPin: "D7", to: "relay", toPin: "IN", kind: "signal" },
          { from: "relay", fromPin: "NO", to: "pump", toPin: "+", kind: "motor" },
          { from: "uno", fromPin: "D8", to: "buzzer", toPin: "+", kind: "signal" },
          { from: "uno", fromPin: "SDA", to: "lcd", toPin: "SDA", kind: "data" },
          ...(tube ? [{ from: "pump", fromPin: "OUTLET", to: "pot", toPin: "IN", kind: "tube" as const }] : []),
        ]
      : [],
    joints: [],
    program: [],
    signals: [
      { id: "moisture", sensor: "probe", name: "Soil moisture", unit: "%", min: 0, max: 100, start: 40, drift: -0.02, effects: [{ part: "pump", rate: pumpRate }], shows: "pot" },
    ],
    rules: [
      {
        signal: "moisture",
        op: "<",
        value: 30,
        hysteresis: 15,
        outputs: [
          { part: "relay", action: "on", text: "" },
          { part: "buzzer", action: "beep", text: "" },
          { part: "lcd", action: "display", text: "Watering...\nSoil {moisture}%" },
        ],
      },
    ],
    timeScale: 180,
    simSeconds: 3600,
  });
}

describe("behaviour simulation", () => {
  it("dries the soil, waters when dry, stops once wet again (hysteresis)", () => {
    const sim = simulateMachine(waterer());
    const b = sim.behaviour!;
    // 3600 s at ×180 is 20 s, plus the waterings played in slow motion so they're watchable.
    expect(b.duration).toBeGreaterThan(20);
    expect(b.duration).toBeLessThan(60);
    const watering = b.on.get("pump")!.findIndex((v) => v > 0);
    expect(b.speed[watering]).toBeLessThan(5);
    expect(b.speed[0]).toBe(180);
    const m = b.signals[0].value;
    // Starts at 40 %, dries below 30 %, is watered back up past 45 %.
    expect(m[0]).toBeCloseTo(40, 0);
    expect(Math.min(...m)).toBeGreaterThan(28);
    expect(Math.min(...m)).toBeLessThan(30.1);
    expect(Math.max(...m.slice(Math.floor(b.samples / 2)))).toBeGreaterThan(40);
    // The relay switches the pump through the motor lead.
    expect(b.on.get("relay")!.some((v) => v > 0)).toBe(true);
    expect(b.on.get("pump")!.some((v) => v > 0)).toBe(true);
    // Water flows only while the pump runs, and the reservoir drains.
    const flow = b.flowing.get(8)!;
    expect(flow.some((v) => v > 0)).toBe(true);
    expect(b.fill.get("tank")![b.samples - 1]).toBeLessThan(1);
  });

  it("shows live text on the LCD", () => {
    const b = simulateMachine(waterer()).behaviour!;
    const k = b.on.get("pump")!.findIndex((v) => v > 0);
    expect(textAt(b, "lcd", k)).toMatch(/^Watering\.\.\.\nSoil \d+(\.\d)?%$/);
    expect(textAt(b, "lcd", 0)).toMatch(/Soil moist 40%/);
  });

  it("beeps in pulses, not a continuous tone", () => {
    const b = simulateMachine(waterer()).behaviour!;
    const on = b.on.get("buzzer")!;
    const first = on.findIndex((v) => v > 0);
    const gap = on.indexOf(0, first);
    expect(first).toBeGreaterThan(0);
    expect(gap).toBeGreaterThan(first);
    expect(on.indexOf(1, gap)).toBeGreaterThan(gap);
  });

  it("counts the pump in the current draw", () => {
    const sim = simulateMachine(waterer());
    expect(sim.peakA).toBeGreaterThan(0.15);
    expect(behaviourIndex(sim.behaviour!, sim.tEnd)).toBe(sim.behaviour!.samples - 1);
  });

  it("checks wiring, tubes, logic and recovery", () => {
    const good = simulateMachine(waterer()).checks;
    expect(good.find((c) => c.id === "wiring")).toMatchObject({ level: "pass" });
    expect(good.find((c) => c.id === "rule-0")).toMatchObject({ level: "pass" });

    expect(simulateMachine(waterer({ wired: false })).checks.find((c) => c.id === "wiring")).toMatchObject({ level: "error" });
    expect(simulateMachine(waterer({ tube: false })).checks.some((c) => c.id === "tube-pump")).toBe(true);
    // A pump too weak to beat the drying never recovers the soil.
    expect(simulateMachine(waterer({ pumpRate: 0.01 })).checks.some((c) => c.id === "recover-0")).toBe(true);
  });

  it("drops connections and rules that point at nothing", () => {
    const a = sanitizeAssembly({
      title: "Bad",
      parts: [raw({ id: "uno", ref: "arduino-uno" })],
      connections: [{ from: "uno", fromPin: "5V", to: "ghost", toPin: "VCC", kind: "power" }],
      joints: [],
      program: [],
      signals: [{ id: "x", sensor: "ghost", name: "X", unit: "", min: 0, max: 1, start: 0, drift: 0, effects: [], shows: "" }],
      rules: [{ signal: "x", op: "<", value: 1, hysteresis: 0, outputs: [{ part: "uno", action: "on", text: "" }] }],
      timeScale: 1e9,
      simSeconds: -5,
    });
    expect(a.connections).toEqual([]);
    expect(a.signals).toEqual([]);
    expect(a.rules).toEqual([]);
    expect(a.timeScale).toBe(3600);
    expect(a.simSeconds).toBe(0);
  });
});
