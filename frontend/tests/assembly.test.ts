// AI-designed machines built from real parts: resolving, validating and editing designs.
import { describe, expect, it } from "vitest";
import {
  AssemblyOut,
  addPart,
  assemblyGuide,
  billOfMaterials,
  childrenOf,
  deletePart,
  describeAssembly,
  duplicatePart,
  MAX_PARTS,
  sanitizeAssembly,
  setFab,
  setJoint,
  setPartRef,
  totalMassG,
  updatePart,
  type AiAssembly,
  type AssemblyInput,
} from "@/lib/lab/assembly";
import { CATALOG, CATALOG_BY_ID } from "@/lib/lab/catalog/parts";
import { armPose } from "@/components/lab/hw3d/robotArm";
import { jsonSchemaFor } from "@/lib/meta/client";

type Raw = AiAssembly["parts"][number];
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
const asm = (parts: Raw[], joints: AiAssembly["joints"] = [], program: AiAssembly["program"] = []): AssemblyInput => ({ title: "Test", parts, joints, program });

/** A small waving robot: base, servo, horn, arm. */
const waver = () =>
  sanitizeAssembly(
    asm(
      [
        raw({ id: "base", ref: "fab:plate", size: [0.2, 0.003, 0.15], material: "acrylic" }),
        raw({ id: "servo", ref: "mg996r", parent: "base" }),
        raw({ id: "horn", ref: "horn-metal-25t", parent: "servo" }),
        raw({ id: "arm", ref: "fab:printed", parent: "horn", size: [0.1, 0.008, 0.02], material: "pla" }),
        raw({ id: "uno", ref: "arduino-uno", parent: "base" }),
      ],
      [{ id: "wave", part: "horn", actuator: "servo", kind: "rotate", axis: "y", min: -60, max: 60, loadG: 40, leverMm: 60 }],
      [{ label: "Wave", duration: 1, targets: [{ joint: "wave", value: 45 }] }],
    ),
  );

describe("catalogue", () => {
  it("has real, complete entries", () => {
    expect(CATALOG.length).toBeGreaterThan(80);
    const ids = new Set<string>();
    for (const p of CATALOG) {
      expect(ids.has(p.id)).toBe(false);
      ids.add(p.id);
      expect(p.dims.every((d) => d > 0)).toBe(true);
      expect(p.massG).toBeGreaterThan(0);
      expect(p.suppliers.length).toBeGreaterThan(0);
      if (p.category === "servo" || p.category === "motor" || p.category === "stepper") expect(p.actuator).toBeDefined();
    }
  });

  it("uses conservative datasheet values", () => {
    const mg = CATALOG_BY_ID.get("mg996r")!;
    expect(mg.actuator!.stallKgcm).toBe(11);
    expect(mg.dims).toEqual([40.7, 42.9, 19.7]);
  });
});

describe("design format", () => {
  it("is valid for Meta's strict structured output", () => {
    const s = jsonSchemaFor(AssemblyOut) as { additionalProperties: boolean; required: string[] };
    expect(s.additionalProperties).toBe(false);
    expect(s.required).toEqual(["title", "parts", "connections", "joints", "program", "signals", "rules", "timeScale", "simSeconds"]);
  });

  it("teaches Muse Spark to build only from real parts", () => {
    const g = assemblyGuide();
    expect(g).toMatch(/every part MUST be one of/);
    expect(g).toMatch(/mg996r \| MG996R/);
    expect(g).toMatch(/fab:plate: laser-cut sheet/);
    expect(g).toMatch(/Never use solid blocks/);
  });
});

describe("sanitizeAssembly", () => {
  it("takes catalogue parts' real size, mass and price, ignoring what the model said", () => {
    const a = sanitizeAssembly(asm([raw({ id: "s", ref: "MG996R", size: [9, 9, 9] })]));
    expect(a.parts[0]).toMatchObject({ kind: "catalog", catalogId: "mg996r", massG: 55, priceUsd: 8 });
    expect(a.parts[0].size.map((v) => Math.round(v * 1000 * 10) / 10)).toEqual([40.7, 42.9, 19.7]);
  });

  it("clamps fabricated parts to what the process makes: stock sheet thickness, print volume", () => {
    const a = sanitizeAssembly(
      asm([raw({ id: "plate", ref: "fab:plate", size: [0.3, 0.0037, 0.2], material: "unobtainium" }), raw({ id: "print", ref: "fab:printed", size: [1, 0.05, 0.05], material: "pla" })]),
    );
    expect(a.parts[0].size[1]).toBe(0.004);
    expect(a.parts[0].material).toBe("acrylic");
    expect(a.parts[0].massG).toBeGreaterThan(0);
    expect(a.parts[1].size[0]).toBe(0.25);
  });

  it("flags anything that isn't a real part instead of drawing it", () => {
    const a = sanitizeAssembly(asm([raw({ id: "x", ref: "mystery_block" }), raw({ id: "y", ref: "need:Hiwonder Raspberry Pi expansion board" })]));
    expect(a.parts.map((p) => p.kind)).toEqual(["need", "need"]);
    expect(a.unresolved).toEqual(["mystery_block", "Hiwonder Raspberry Pi expansion board"]);
  });

  it("only keeps joints driven by a real actuator in the design", () => {
    const a = sanitizeAssembly(
      asm(
        [raw({ id: "plate", ref: "fab:plate", size: [0.1, 0.003, 0.1] }), raw({ id: "servo", ref: "sg90", parent: "plate" }), raw({ id: "arm", ref: "fab:printed", parent: "servo", size: [0.05, 0.005, 0.01] })],
        [
          { id: "ok", part: "arm", actuator: "servo", kind: "rotate", axis: "z", min: 0, max: 90, loadG: 10, leverMm: 30 },
          { id: "bad", part: "arm", actuator: "plate", kind: "rotate", axis: "z", min: 0, max: 90, loadG: 10, leverMm: 30 },
        ],
        [{ label: "Go", duration: 1, targets: [{ joint: "ok", value: 90 }, { joint: "bad", value: 10 }, { joint: "ghost", value: 1 }] }],
      ),
    );
    expect(a.joints.map((j) => j.id)).toEqual(["ok"]);
    expect(a.program[0].targets).toEqual([{ joint: "ok", value: 90 }]);
  });

  it("repairs the tree and caps size", () => {
    const loop = sanitizeAssembly(asm([raw({ id: "a", ref: "sg90", parent: "b" }), raw({ id: "b", ref: "sg90", parent: "a" })]));
    expect((childrenOf(loop).get("") ?? []).length).toBeGreaterThan(0);
    const many = Array.from({ length: MAX_PARTS + 10 }, (_, i) => raw({ id: `p${i}`, ref: "sg90" }));
    expect(sanitizeAssembly(asm(many)).parts.length).toBe(MAX_PARTS);
    expect(() => sanitizeAssembly(asm([]))).toThrow(/no parts/);
  });
});

describe("editing", () => {
  it("swaps a part for another real part and refills its data", () => {
    const a = setPartRef(waver(), "servo", "ds3218");
    expect(a.parts.find((p) => p.id === "servo")).toMatchObject({ catalogId: "ds3218", massG: 60, parent: "base" });
  });

  it("resizes a fabricated part and recomputes its mass", () => {
    const before = waver().parts.find((p) => p.id === "arm")!.massG;
    const a = setFab(waver(), "arm", [0.2, 0.008, 0.02], "pla");
    expect(a.parts.find((p) => p.id === "arm")!.massG).toBeGreaterThan(before);
  });

  it("adds, updates, duplicates and deletes with joints kept consistent", () => {
    let a = waver();
    const added = addPart(a, "base", "hc-sr04");
    expect(added.assembly.parts.find((p) => p.id === added.id)).toMatchObject({ catalogId: "hc-sr04", parent: "base" });
    a = updatePart(a, "arm", { name: "Waving arm", id: "hacked" });
    expect(a.parts.find((p) => p.id === "arm")!.name).toBe("Waving arm");
    const dup = duplicatePart(a, "servo");
    expect(dup.assembly.joints).toHaveLength(2);
    expect(totalMassG(dup.assembly)).toBeGreaterThan(totalMassG(a));
    const del = deletePart(a, "servo");
    expect(del.joints).toEqual([]);
    expect(del.program[0].targets).toEqual([]);
  });

  it("sets and clears joints", () => {
    let a = setJoint(waver(), "arm", { actuator: "servo", kind: "rotate", axis: "z", min: 0, max: 30, loadG: 5, leverMm: 20 });
    expect(a.joints).toHaveLength(2);
    a = setJoint(a, "horn", null);
    expect(a.joints.map((j) => j.part)).toEqual(["arm"]);
  });
});

describe("bill of materials", () => {
  it("groups parts, prices them and knows where to buy or make each", () => {
    const bom = billOfMaterials(waver());
    const servo = bom.find((r) => r.key === "mg996r")!;
    expect(servo).toMatchObject({ qty: 1, unitUsd: 8, kind: "catalog" });
    expect(servo.suppliers.length).toBeGreaterThan(0);
    expect(bom.find((r) => r.kind === "fab")!.suppliers).toEqual(["pcbway"]);
    expect(describeAssembly(waver())).toMatch(/JOINT wave \(rotate, load 40 g at 60 mm\)/);
  });
});

describe("arm kits", () => {
  it("pose the joints smoothly, mirrored for negative strokes", () => {
    const rest = armPose(0);
    expect(rest.shoulder + rest.elbow + rest.wrist).toBe(90);
    expect(armPose(-1).yaw).toBe(-armPose(1).yaw);
    expect(armPose(10)).toEqual(armPose(1.5));
  });
});

describe("fabricated parts look and weigh like the real thing", () => {
  it("classifies prints as links, thin-walled shells or small fittings", async () => {
    const { printedForm } = await import("@/components/lab/hw3d/catalogMeshes");
    expect(printedForm([0.11, 0.008, 0.02])).toBe("link");
    expect(printedForm([0.09, 0.12, 0.07])).toBe("shell");
    expect(printedForm([0.02, 0.01, 0.015])).toBe("fitting");
  });

  it("weighs a printed enclosure as a 2.5 mm shell, far lighter than a solid block", () => {
    const a = sanitizeAssembly(asm([raw({ id: "body", ref: "fab:printed", size: [0.09, 0.12, 0.07], material: "pla" })]));
    // Solid PLA would be ~940 g; a 2.5 mm-wall shell is ~100 g.
    expect(a.parts[0].massG).toBeGreaterThan(60);
    expect(a.parts[0].massG).toBeLessThan(160);
    expect(a.parts[0].spec).toMatch(/2\.5 mm walls/);
  });

  it("tells Muse Spark to build limbs from servos and brackets, never printed bars", () => {
    const g = assemblyGuide();
    expect(g).toMatch(/LIMBS/);
    expect(g).toMatch(/bracket-multi-servo/);
    expect(g).toMatch(/NEVER use a fab:printed or fab:plate part as a moving limb segment/);
    expect(g).toMatch(/rotation \[0, 0, -90\] so its shaft points \+x/);
  });
});
