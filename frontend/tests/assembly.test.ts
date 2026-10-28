// AI-designed machines: the validator must turn any answer into something that renders.
import { describe, expect, it } from "vitest";
import { AssemblyOut, addPart, childrenOf, deletePart, describeAssembly, duplicatePart, MAX_PARTS, sanitizeAssembly, setMotion, totalMassG, updatePart, type Assembly, type PartSpec } from "@/lib/lab/assembly";
import { jsonSchemaFor } from "@/lib/meta/client";

const part = (over: Partial<PartSpec>): PartSpec => ({
  id: "p",
  name: "Part",
  spec: "",
  massG: 10,
  parent: "",
  shape: "box",
  material: "aluminium",
  color: "#c0c0c0",
  size: [0.1, 0.1, 0.1],
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  repeat: 1,
  repeatMode: "radial",
  repeatAxis: "y",
  repeatStep: 0,
  ...over,
});

const asm = (parts: PartSpec[], motions: Assembly["motions"] = []): Assembly => ({ title: "Test", parts, motions });

describe("assembly schema", () => {
  it("is valid for Meta's strict structured output", () => {
    const s = jsonSchemaFor(AssemblyOut) as { additionalProperties: boolean; required: string[]; properties: Record<string, { items?: { additionalProperties: boolean; required: string[] } }> };
    expect(s.additionalProperties).toBe(false);
    expect(s.required).toEqual(["title", "parts", "motions"]);
    const p = s.properties.parts.items!;
    expect(p.additionalProperties).toBe(false);
    expect(p.required).toContain("repeatStep");
  });
});

describe("sanitizeAssembly", () => {
  it("re-attaches parts with missing parents to the world", () => {
    const a = sanitizeAssembly(asm([part({ id: "base" }), part({ id: "arm", parent: "ghost" })]));
    expect(a.parts.find((p) => p.id === "arm")!.parent).toBe("");
  });

  it("breaks parent loops", () => {
    const a = sanitizeAssembly(asm([part({ id: "a", parent: "b" }), part({ id: "b", parent: "a" })]));
    const roots = childrenOf(a).get("") ?? [];
    expect(roots.length).toBeGreaterThan(0);
    // Walking up from every part must reach the world.
    const byId = new Map(a.parts.map((p) => [p.id, p]));
    for (const p of a.parts) {
      let cur = p.parent;
      for (let i = 0; cur && i < 10; i++) cur = byId.get(cur)!.parent;
      expect(cur).toBe("");
    }
  });

  it("makes ids unique, clamps sizes and positions, fixes bad colours", () => {
    const a = sanitizeAssembly(
      asm([
        part({ id: "x", size: [-1, Number.NaN, 999], position: [1e6, 0, 0], color: "red" }),
        part({ id: "x", size: [0.2, 0.2, 0.2] }),
      ]),
    );
    expect(new Set(a.parts.map((p) => p.id)).size).toBe(2);
    expect(a.parts[0].size).toEqual([0.0005, 0.05, 20]);
    expect(a.parts[0].position[0]).toBe(30);
    expect(a.parts[0].color).toBe("");
  });

  it("caps part count and repeats", () => {
    const many = Array.from({ length: MAX_PARTS + 20 }, (_, i) => part({ id: `p${i}` }));
    expect(sanitizeAssembly(asm(many)).parts.length).toBe(MAX_PARTS);
    expect(sanitizeAssembly(asm([part({ repeat: 500 })])).parts[0].repeat).toBe(36);
  });

  it("drops motions on parts that don't exist and defaults a zero gain", () => {
    const a = sanitizeAssembly(
      asm(
        [part({ id: "hub" })],
        [
          { part: "hub", kind: "spin", axis: "y", gain: 0 },
          { part: "nope", kind: "slide", axis: "x", gain: 1 },
        ],
      ),
    );
    expect(a.motions).toEqual([{ part: "hub", kind: "spin", axis: "y", gain: 1 }]);
  });

  it("refuses an empty design", () => {
    expect(() => sanitizeAssembly(asm([]))).toThrow(/no parts/);
  });
});

describe("editing an assembly", () => {
  // A fan: base → motor → hub (spins) → 5 blades.
  const fan = (): Assembly =>
    asm(
      [
        part({ id: "base", massG: 300 }),
        part({ id: "motor", parent: "base", massG: 120 }),
        part({ id: "hub", parent: "motor", massG: 20 }),
        part({ id: "blade", parent: "hub", shape: "blade", repeat: 5, massG: 8 }),
      ],
      [{ part: "hub", kind: "spin", axis: "y", gain: 0.10472 }],
    );

  it("updates one part and nothing else", () => {
    const a = updatePart(fan(), "hub", { massG: 25, id: "hacked" });
    expect(a.parts.find((p) => p.id === "hub")!.massG).toBe(25);
    expect(a.parts.map((p) => p.id)).toEqual(["base", "motor", "hub", "blade"]);
  });

  it("adds a part with a fresh id under the chosen parent", () => {
    const { assembly, id } = addPart(addPart(fan(), "base").assembly, "base");
    expect(id).toBe("box_2");
    expect(assembly.parts.find((p) => p.id === id)!.parent).toBe("base");
  });

  it("duplicates a part with everything attached and its motion", () => {
    const { assembly, id } = duplicatePart(fan(), "hub");
    expect(assembly.parts).toHaveLength(6);
    const copyBlade = assembly.parts.find((p) => p.parent === id)!;
    expect(copyBlade.shape).toBe("blade");
    expect(assembly.motions.map((m) => m.part)).toEqual(["hub", id]);
    expect(totalMassG(assembly)).toBe(totalMassG(fan()) + 20 + 40);
  });

  it("deletes a part with everything attached and drops its motion", () => {
    const a = deletePart(fan(), "motor");
    expect(a.parts.map((p) => p.id)).toEqual(["base"]);
    expect(a.motions).toEqual([]);
  });

  it("sets, changes and clears a motion", () => {
    let a = setMotion(fan(), "base", { kind: "rotate", axis: "y", gain: 1 });
    expect(a.motions).toHaveLength(2);
    a = setMotion(a, "hub", { kind: "spin", axis: "z", gain: 2 });
    expect(a.motions.find((m) => m.part === "hub")).toMatchObject({ axis: "z", gain: 2 });
    a = setMotion(a, "hub", null);
    expect(a.motions.map((m) => m.part)).toEqual(["base"]);
  });

  it("summarises the design as a parts list for re-deriving the physics", () => {
    const s = describeAssembly(fan());
    expect(s).toContain("total mass 480 g");
    expect(s).toMatch(/×5: blade/);
    expect(s).toMatch(/MOVES \(spin/);
  });
});
