// Parts library import/export, and finding missing parts online (fetch stubbed: no network).
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acceptUploaded, catalogToCsv, parseCsv, parsePartsUpload } from "@/lib/lab/catalog/io";
import { CATALOG } from "@/lib/lab/catalog/parts";
import { resolveNeeds, sanitizeAssembly } from "@/lib/lab/assembly";

describe("parts library files", () => {
  it("round-trips the whole catalogue through CSV", () => {
    const { parts, skipped } = parsePartsUpload(catalogToCsv());
    expect(skipped).toBe(0);
    expect(parts).toHaveLength(CATALOG.length);
    const mg = parts.find((p) => p.name.startsWith("MG996R"))!;
    expect(mg.dims).toEqual([40.7, 42.9, 19.7]);
    expect(mg.actuator).toMatchObject({ kind: "servo", stallKgcm: 11 });
  });

  it("parses quoted CSV cells with commas and quotes", () => {
    expect(parseCsv('a,"b, c","say ""hi"""\n1,2,3')).toEqual([
      ["a", "b, c", 'say "hi"'],
      ["1", "2", "3"],
    ]);
  });

  it("accepts a user's CSV and JSON, rejecting rows without a name or size", () => {
    const csv = "id,name,category,model,length_mm,height_mm,width_mm,mass_g,price_usd,suppliers\nmy-claw,My claw,kit,gripper_claw,90,60,30,80,12,robotshop\nx1,,kit,,10,10,10,1,1,\nbad,Bad size,kit,,0,10,10,1,1,";
    const r = parsePartsUpload(csv);
    expect(r.parts.map((p) => p.id)).toEqual(["user-my-claw"]);
    expect(r.skipped).toBe(2);
    const j = parsePartsUpload(JSON.stringify([{ name: "Lab servo", category: "servo", dims: [40, 40, 20], massG: 50, actuator: { kind: "servo", stallKgcm: 9, speed: 400 } }]));
    expect(j.parts[0]).toMatchObject({ id: "user-lab-servo", category: "servo", model: "module_pcb", actuator: { stallKgcm: 9 } });
  });

  it("re-validates uploaded parts on the server", () => {
    const ok = parsePartsUpload(catalogToCsv(CATALOG.slice(0, 2))).parts;
    expect(acceptUploaded(ok)).toHaveLength(2);
    expect(acceptUploaded([{ name: "evil", dims: [1] }, "x", null])).toEqual([]);
    expect(acceptUploaded("not an array")).toEqual([]);
  });
});

describe("finding missing parts online", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "find-test-"));
    vi.stubEnv("META_CACHE_DIR", dir);
    vi.stubEnv("MODEL_API_KEY", "test-key");
    vi.stubEnv("META_LIVE", "1");
    vi.stubEnv("META_DAILY_BUDGET_USD", "1");
    vi.spyOn(console, "info").mockImplementation(() => {});
    const answer = {
      found: true,
      name: "Hiwonder LFD-01 anti-blocking servo",
      category: "servo",
      length_mm: 40,
      height_mm: 37,
      width_mm: 20,
      mass_g: 40,
      price_usd: 12,
      spec: "6 kg·cm @ 6 V · 0.16 s/60°",
      search: "Hiwonder LFD-01",
      source_url: "https://www.hiwonder.com/products/lfd-01",
      actuator_kind: "servo",
      rated_v: 6,
      stall_kgcm: 6,
      speed: 375,
      stall_a: 1.5,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            output: [
              { type: "web_search_call" },
              { type: "web_search_call" },
              { type: "message", content: [{ type: "output_text", text: `Here it is: ${JSON.stringify(answer)}`, annotations: [{ type: "url_citation", url: "https://example.com/lfd-01" }] }] },
            ],
            usage: { input_tokens: 2000, output_tokens: 400 },
          }),
          { status: 200 },
        ),
      ),
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("looks the part up with web search, costs the searches, and resolves it into the design", async () => {
    vi.resetModules();
    const { findPartOnline } = await import("@/lib/lab/ai");
    const r = await findPartOnline("Hiwonder LFD-01 servo", "a waving robot");
    expect(r.part).toMatchObject({ id: expect.stringMatching(/^web-/), category: "servo", model: "servo_standard", source: "https://www.hiwonder.com/products/lfd-01", actuator: { stallKgcm: 6 } });
    // 2,000 in + 400 out tokens, plus 2 searches at $2.50 per 1,000.
    expect(r.usage.costUsd).toBeCloseTo((2000 * 1.25 + 400 * 4.25) / 1e6 + 0.005, 6);
    const log = readFileSync(path.join(dir, "usage.jsonl"), "utf8");
    expect(log).toMatch(/find_part\+search×2/);

    const a = sanitizeAssembly({
      title: "Waver",
      parts: [{ id: "s", name: "Shoulder", parent: "", ref: "need:Hiwonder LFD-01 servo", size: [0, 0, 0], material: "", color: "", position: [0, 0, 0], rotation: [0, 0, 0], repeat: 1, repeatMode: "radial", repeatAxis: "y", repeatStep: 0 }],
      joints: [],
      program: [],
    });
    expect(a.unresolved).toEqual(["Hiwonder LFD-01 servo"]);
    const fixed = resolveNeeds(a, new Map([["Hiwonder LFD-01 servo", r.part!]]));
    expect(fixed.parts[0]).toMatchObject({ kind: "catalog", massG: 40, catalog: { source: "https://www.hiwonder.com/products/lfd-01" } });
    expect(fixed.unresolved).toEqual([]);
  });
});
