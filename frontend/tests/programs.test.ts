// Motion programs: every program plays, and the shapes come out right.
import { describe, expect, it } from "vitest";
import { run } from "@/lib/lab/analysis";
import { autoTune } from "@/lib/lab/advisor";
import { defaultBuild, deriveHardware } from "@/lib/lab/hardware/build";
import { PROGRAMS, programRun, segmentAt } from "@/lib/lab/programs";
import type { RigKind } from "@/lib/lab/types";
import { tsEngine } from "@/lib/sim/engine";

const setup = (kind: RigKind, tuned = false) => {
  const b = defaultBuild(kind);
  const model = deriveHardware(b).model;
  const ctrl = tuned ? autoTune(tsEngine, model, model.controller, 60) : model.controller;
  return { b, model, ctrl, mission: run(tsEngine, model, ctrl) };
};

describe("programs", { timeout: 60000 }, () => {
  for (const kind of ["rover", "arm", "balancer", "drone"] as RigKind[])
    it(`${kind}: every program produces finite motion with labelled steps`, () => {
      const { b, model, ctrl, mission } = setup(kind);
      for (const p of PROGRAMS[kind]) {
        const r = programRun(tsEngine, p.id, b, model, ctrl, mission);
        expect(r.y.length, `${kind}/${p.id}`).toBeGreaterThan(100);
        expect(r.y.every(Number.isFinite) && r.u.every(Number.isFinite), `${kind}/${p.id}`).toBe(true);
        expect(r.segs.length).toBeGreaterThan(0);
        expect(r.segs.at(-1)!.t1).toBeCloseTo(r.tEnd, 6);
        expect(segmentAt(r, r.tEnd)).toBe(r.segs.length - 1);
      }
    });

  it("mission replays the exact simulation", () => {
    const { b, model, ctrl, mission } = setup("drone");
    const r = programRun(tsEngine, "mission", b, model, ctrl, mission);
    expect(Array.from(r.y)).toEqual(Array.from(mission.sim.y));
    expect(r.linear).toBe(false);
  });

  it("rover square: four turns of about 90° and a route that nearly closes", () => {
    const { b, model, ctrl, mission } = setup("rover", true);
    const r = programRun(tsEngine, "square", b, model, ctrl, mission);
    const n = r.pose!.x.length - 1;
    expect(Math.abs(r.pose!.h[n] - 2 * Math.PI)).toBeLessThan(0.35);
    expect(Math.hypot(r.pose!.x[n], r.pose!.z[n])).toBeLessThan(0.15);
    // The commanded plan closes exactly.
    const [px, pz] = r.plan!.at(-1)!;
    expect(Math.hypot(px, pz)).toBeLessThan(0.02);
  });

  it("rover figure-8 turns left then right and spin stays on the spot", () => {
    const { b, model, ctrl, mission } = setup("rover", true);
    const f8 = programRun(tsEngine, "figure8", b, model, ctrl, mission);
    const half = Math.round(f8.segs[0].t1 / f8.dt);
    expect(f8.pose!.h[half]).toBeGreaterThan(5);
    expect(Math.abs(f8.pose!.h[f8.pose!.h.length - 1])).toBeLessThan(0.5);
    const spin = programRun(tsEngine, "spin", b, model, ctrl, mission);
    const maxR = Math.max(...Array.from(spin.pose!.x, (x, i) => Math.hypot(x, spin.pose!.z[i])));
    expect(maxR).toBeLessThan(0.01);
  });

  it("arm stack: three grips and three releases at rising lift", () => {
    const { b, model, ctrl, mission } = setup("arm", true);
    const r = programRun(tsEngine, "stack", b, model, ctrl, mission);
    const rel = r.events.filter((e) => e.kind === "release").map((e) => r.y[Math.round(e.t / r.dt)]);
    expect(r.events.filter((e) => e.kind === "grip")).toHaveLength(3);
    expect(rel).toHaveLength(3);
    expect(rel[1]).toBeGreaterThan(rel[0]);
    expect(rel[2]).toBeGreaterThan(rel[1]);
    expect(r.yaw!.some((v) => v > 1.4)).toBe(true);
  });

  it("drone stairs end at the target and balancer shuttle crosses behind the start", () => {
    const d = setup("drone", true);
    const stairs = programRun(tsEngine, "stairs", d.b, d.model, d.ctrl, d.mission);
    expect(stairs.y[stairs.y.length - 1]).toBeCloseTo(d.model.sim.ref, 1);
    const bl = setup("balancer", true);
    const sh = programRun(tsEngine, "shuttle", bl.b, bl.model, bl.ctrl, bl.mission);
    expect(Math.min(...sh.y)).toBeLessThan(-0.1);
    expect(sh.tilt).toBeDefined();
  });
});
