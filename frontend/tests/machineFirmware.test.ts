// Firmware generated from an AI machine's own wiring, signals and rules.
import { describe, expect, it } from "vitest";
import { sanitizeAssembly, type AssemblyInput } from "@/lib/lab/assembly";
import { machineFirmware } from "@/lib/lab/machineFirmware";

type Raw = AssemblyInput["parts"][number];
const raw = (p: Partial<Raw> & Pick<Raw, "id" | "ref">): Raw => ({ name: p.id, parent: "", size: [0, 0, 0], material: "", color: "", position: [0, 0, 0], rotation: [0, 0, 0], repeat: 1, repeatMode: "radial", repeatAxis: "y", repeatStep: 0, ...p });

describe("machine firmware", () => {
  it("uses the design's pins, reads the sensor and switches the relay with hysteresis", () => {
    const a = sanitizeAssembly({
      title: "Plant waterer",
      parts: [raw({ id: "uno", ref: "arduino-uno" }), raw({ id: "relay", ref: "relay-1ch" }), raw({ id: "probe", ref: "soil-cap-v12" }), raw({ id: "lcd", ref: "lcd1602-i2c" })],
      connections: [
        { from: "probe", fromPin: "AOUT", to: "uno", toPin: "A0", kind: "signal" },
        { from: "uno", fromPin: "D7", to: "relay", toPin: "IN", kind: "signal" },
        { from: "uno", fromPin: "SDA", to: "lcd", toPin: "SDA", kind: "data" },
      ],
      joints: [],
      program: [],
      signals: [{ id: "moisture", sensor: "probe", name: "Soil moisture", unit: "%", min: 0, max: 100, start: 40, drift: -0.02, effects: [], shows: "" }],
      rules: [{ signal: "moisture", op: "<", value: 30, hysteresis: 15, outputs: [{ part: "relay", action: "on", text: "" }, { part: "lcd", action: "display", text: "Watering..." }] }],
    });
    const fw = machineFirmware(a);
    expect(fw.text).toContain("const int PIN_MOISTURE = A0;");
    expect(fw.text).toContain("const int PIN_RELAY = 7;");
    expect(fw.text).toContain("active[0] = active[0] ? (v < 45) : (v < 30);");
    expect(fw.text).toContain("LiquidCrystal_I2C");
    expect(fw.text).toContain("Every pin below comes from a connection in the design.");
    expect(fw.filename).toBe("plant_waterer.ino");
  });
});
