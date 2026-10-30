import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sanitizeDesign, type DesignAi } from "@/lib/create/design";
import { EXAMPLES } from "@/lib/create/examples";

const DIR = path.join(__dirname, "..", "public", "examples");

describe("ready-made examples", () => {
  it("has a file for every example and no stray files", () => {
    expect(readdirSync(DIR).sort()).toEqual(EXAMPLES.map((e) => `${e.id}.json`).sort());
  });

  for (const e of EXAMPLES) {
    it(`${e.id} opens as a working design`, () => {
      const d = sanitizeDesign(JSON.parse(readFileSync(path.join(DIR, `${e.id}.json`), "utf8")) as DesignAi);
      expect(d.robot.nodes.filter((n) => n.joint.type !== "fixed").length).toBeGreaterThan(3);
      expect(d.task.length).toBeGreaterThan(3);
      expect(d.scene.length).toBeGreaterThan(0);
      expect(JSON.stringify(d)).not.toMatch(/disney|bdx/i);
    });
  }
});
