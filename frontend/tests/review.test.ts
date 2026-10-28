// Engineering review: format, cleaning, and how it's passed on to the physics and 3D steps.
import { describe, expect, it } from "vitest";
import { jsonSchemaFor } from "@/lib/meta/client";
import { REVIEW_SYSTEM, ReviewOut, bomTotal, reviewBrief, sanitizeReview, type Review } from "@/lib/lab/review";

const dualArm: Review = {
  verdict: "buildable",
  headline: "Buildable as a dual-arm kit build.",
  explanation: "Two hobby 6-DOF arms synchronised by one controller can stack light boxes.",
  concept: "Two 6-DOF servo arm kits on a shared base, synchronised by an Arduino Mega, with suction grippers.",
  bom: [
    { item: "6-DOF servo robotic arm kit", qty: 2, example: "LewanSoul xArm 6DOF", role: "The two arms", priceUsd: 200 },
    { item: "Microcontroller", qty: 1, example: "Arduino Mega 2560 Rev3", role: "Synchronises both arms", priceUsd: 45 },
    { item: "Vacuum suction cup kit", qty: 2, example: "Hiwonder suction kit", role: "Grippers", priceUsd: 25 },
  ],
  limitations: ["Payload about 200 g per arm"],
  alternative: "",
};

describe("engineering review", () => {
  it("is valid for Meta's strict structured output", () => {
    const s = jsonSchemaFor(ReviewOut) as { additionalProperties: boolean; required: string[] };
    expect(s.additionalProperties).toBe(false);
    expect(s.required).toEqual(["verdict", "headline", "explanation", "concept", "bom", "limitations", "alternative"]);
  });

  it("carries the user's rules: rethink into buyable parts, flag the unbuildable, always render", () => {
    expect(REVIEW_SYSTEM).toMatch(/6-DOF/);
    expect(REVIEW_SYSTEM).toMatch(/ESP32, DHT22/);
    expect(REVIEW_SYSTEM).toMatch(/not possible with student-grade hardware/);
    expect(REVIEW_SYSTEM).toMatch(/medical-grade magnets/);
    expect(REVIEW_SYSTEM).toMatch(/never stops the project/);
  });

  it("totals the bill of materials", () => {
    expect(bomTotal(dualArm)).toBe(2 * 200 + 45 + 2 * 25);
  });

  it("briefs the physics and 3D steps with the practical design and its parts", () => {
    const b = reviewBrief(dualArm);
    expect(b).toMatch(/Feasibility: buildable/);
    expect(b).toMatch(/2 × 6-DOF servo robotic arm kit \(LewanSoul xArm 6DOF\)/);
    expect(b).toMatch(/Arduino Mega/);
  });

  it("cleans quantities and prices", () => {
    const r = sanitizeReview({ ...dualArm, bom: [{ ...dualArm.bom[0], qty: 0.2, priceUsd: Number.NaN }] });
    expect(r.bom[0]).toMatchObject({ qty: 1, priceUsd: 0 });
  });
});
