import { describe, expect, it } from "vitest";
import { applyActions, assistContext, AssistOut, type AssistAction } from "@/lib/lab/assist";
import { defaultBuild, deriveHardware, GEOMETRY, SLOTS } from "@/lib/lab/hardware/build";

const act = (a: Partial<AssistAction>): AssistAction => ({ kind: "swap_part", target: "", value: "", kp: 0, ki: 0, kd: 0, why: "", ...a });

describe("the lab assistant's actions", () => {
  const build = defaultBuild("arm");
  const checks = deriveHardware(build).checks;
  const ctrl = { type: "pid" as const, kp: 2, ki: 0.5, kd: 0.1, N: 50 };

  it("swaps a part for a real option in that slot, and sets a size within its limits", () => {
    const driver = SLOTS.arm.find((s) => s.slot === "driver")!.options.find((o) => o.id !== build.parts.driver)!;
    const r = applyActions(
      [
        act({ kind: "swap_part", target: "driver", value: driver.id }),
        act({ kind: "set_size", target: "upper", value: "170" }),
      ],
      { build, slots: true, checks, machine: null, ctrl },
    );
    expect(r.build!.parts.driver).toBe(driver.id);
    expect(r.build!.geom.upper).toBeCloseTo(0.17, 6);
    expect(r.done).toHaveLength(2);
    expect(r.skipped).toHaveLength(0);
    // The original build is untouched.
    expect(build.parts.driver).not.toBe(driver.id);
  });

  it("refuses invented parts, unknown sizes and fixes that don't exist, and clamps sizes to their slider", () => {
    const upper = GEOMETRY.arm.find((g) => g.key === "upper")!;
    const r = applyActions(
      [
        act({ kind: "swap_part", target: "driver", value: "made-up-driver" }),
        act({ kind: "set_size", target: "wingspan", value: "3" }),
        act({ kind: "apply_fix", target: "no-such-check" }),
        act({ kind: "set_size", target: "upper", value: "9999" }),
      ],
      { build, slots: true, checks, machine: null, ctrl },
    );
    expect(r.skipped).toHaveLength(3);
    expect(r.build!.parts.driver).toBe(build.parts.driver);
    expect(r.build!.geom.upper).toBe(upper.max);
  });

  it("only changes PID gains to valid values", () => {
    expect(applyActions([act({ kind: "set_gains", kp: 4, ki: 1, kd: 0.2 })], { build, slots: true, checks, machine: null, ctrl }).ctrl).toMatchObject({ kp: 4, ki: 1, kd: 0.2 });
    const bad = applyActions([act({ kind: "set_gains", kp: -1, ki: 1, kd: 0 })], { build, slots: true, checks, machine: null, ctrl });
    expect(bad.ctrl).toEqual(ctrl);
    expect(bad.skipped).toHaveLength(1);
  });

  it("describes the machine with every slot's real options and the failing checks", () => {
    const ctx = JSON.parse(assistContext({ title: "Arm", build, slots: true, checks, machine: null, machineChecks: [], ctrl, metrics: null, specs: [] }));
    expect(ctx.slots.map((s: { slot: string }) => s.slot)).toEqual(SLOTS.arm.map((s) => s.slot));
    expect(ctx.slots[0].options.length).toBeGreaterThan(1);
    expect(ctx.sizes.find((g: { key: string }) => g.key === "upper").unit).toBe("mm");
  });

  it("has a strict response schema", () => {
    expect(AssistOut.safeParse({ reply: "ok", mode: "answer", actions: [] }).success).toBe(true);
    expect(AssistOut.safeParse({ reply: "ok", mode: "whatever", actions: [] }).success).toBe(false);
  });
});
