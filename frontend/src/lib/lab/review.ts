// Engineering review: before anything is modelled, Muse Spark checks whether the idea can be built
// from buyable hobbyist / student hardware. Buildable ideas are rethought into a practical design
// with a bill of materials; unbuildable ones are flagged plainly, with what to buy instead. The 3D
// build always happens either way.
import { z } from "zod";

export const VERDICTS = ["buildable", "partly_buildable", "not_buildable"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const ReviewOut = z.object({
  verdict: z.enum(VERDICTS),
  headline: z.string().describe("One plain sentence verdict"),
  explanation: z
    .string()
    .describe("Why. For not_buildable, state the limitation explicitly, e.g. 'Building custom LED panels or smartphone logic boards is not possible with student-grade hardware.'"),
  concept: z.string().describe("The practical design to build, in 1-3 sentences. For not_buildable: the concept exactly as the user imagined it"),
  bom: z
    .array(
      z.object({
        item: z.string().describe("Generic part, e.g. '6-DOF servo robotic arm kit'"),
        qty: z.number(),
        example: z.string().describe("A real buyable product, e.g. 'LewanSoul xArm 6DOF' or 'Arduino Mega 2560 Rev3'"),
        role: z.string().describe("What it does in this build"),
        priceUsd: z.number().describe("Approximate price of one, USD"),
      }),
    )
    .describe("Buyable parts for the practical design (empty for not_buildable unless parts of it can be bought)"),
  limitations: z.array(z.string()).describe("Things that can't be done with hobbyist hardware, or caveats"),
  alternative: z.string().describe("For partly/not buildable: what to buy or build instead. Otherwise ''"),
});

export type Review = z.infer<typeof ReviewOut>;

export const REVIEW_SYSTEM = `You are the feasibility engineer inside RoboCraft Control Lab, for students and hobbyists.

1. FEASIBILITY FILTER & REAL-WORLD RETHINKING
Evaluate whether the user's idea can realistically be built from existing, buyable hobbyist / student hardware. If it can, rethink their abstract description into a practical, multi-part hardware design with a bill of materials of real products.
- Robotics example: "a humanoid robotic arm to stack boxes" is NOT an industrial factory arm. Rethink it as a dual-arm system using two buyable 6-DOF robotic arm kits (e.g. LewanSoul / Hiwonder xArm, Elephant Robotics myCobot) synchronised by one microcontroller (Arduino Mega or Raspberry Pi), with suction cups or dual-servo grippers.
- IoT / automation example: "an automated smart greenhouse tracker" maps to an ESP32, DHT22 temperature/humidity sensors, a capacitive soil-moisture probe and a 5 V relay module driving a small pump.
Prefer kits and modules a student can order online and assemble with hand tools.

2. UNBUILDABLE CONCEPTS & GUARDRAILS
If the idea needs proprietary manufacturing, micro-fabrication or industrial-grade hardware a student cannot source or assemble, say so explicitly in the explanation. Never pretend it can be built at home.
- "A custom smart TV" or "a smartphone from scratch": say "Building custom LED panels or smartphone logic boards is not possible with student-grade hardware." and suggest a Raspberry Pi with a ready-made HDMI display instead.
- "An MRI machine for pets" or "a jet engine drone": say "Sourcing medical-grade magnets or high-temperature turbine alloys is outside the scope of buyable hobbyist hardware."
Use partly_buildable when a useful version can be built but some of the idea can't; put what can't in limitations and the closest buildable version in concept and bom.

3. THE 3D BUILD ALWAYS HAPPENS
Your verdict never stops the project. For not_buildable ideas, the concept field must still describe the device exactly as the user imagined it, because it will be rendered in full.

Keep it concise and practical. Prices are rough USD street prices.`;

/** Total BOM cost, USD. */
export function bomTotal(r: Review): number {
  return r.bom.reduce((s, b) => s + Math.max(0, b.qty) * Math.max(0, b.priceUsd), 0);
}

/** The review as context for the physics and 3D steps. */
export function reviewBrief(r: Review): string {
  const bom = r.bom.map((b) => `- ${b.qty} × ${b.item} (${b.example}): ${b.role}`).join("\n");
  return [
    `Feasibility: ${r.verdict.replace("_", " ")}. ${r.headline}`,
    `Design to build: ${r.concept}`,
    bom ? `Bill of materials:\n${bom}` : "",
    r.limitations.length ? `Limitations: ${r.limitations.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Cleans the review so the UI can rely on it. */
export function sanitizeReview(r: Review): Review {
  return {
    ...r,
    headline: r.headline.slice(0, 300),
    explanation: r.explanation.slice(0, 1200),
    concept: r.concept.slice(0, 800),
    bom: r.bom.slice(0, 30).map((b) => ({ ...b, qty: Math.max(1, Math.round(Number.isFinite(b.qty) ? b.qty : 1)), priceUsd: Number.isFinite(b.priceUsd) ? Math.max(0, b.priceUsd) : 0 })),
    limitations: r.limitations.slice(0, 8),
    alternative: r.alternative.slice(0, 600),
  };
}
