import { describe, expect, it } from "vitest";
import { runAgent, type CallModel, type ModelTurn } from "@/lib/agent/loop";
import { applyChanges, runTool, toolDefinitions, type AgentState } from "@/lib/agent/tools";
import { sanitizeDesign, type DesignAi } from "@/lib/create/design";
import { simulate } from "@/lib/create/sim";
import { ARM_FIXTURE } from "./fixtures/createFixtures";

// The arm with an under-sized shoulder: a 0.5 N·m hobby servo lifting a 0.3 m upper arm.
function weakArm(): DesignAi {
  const d = structuredClone(ARM_FIXTURE);
  const upper = d.robot.nodes.find((n) => n.id === "upper")!;
  upper.joint = { ...upper.joint, actuator: "mg996r", torqueNm: 0.5 };
  return d;
}

let n = 0;
const call = (name: string, args: object = {}): ModelTurn => ({ message: { content: null, tool_calls: [{ id: `call_${++n}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] }, usage: { costUsd: 0.01, inputTokens: 1000, outputTokens: 100 } });

/** A scripted stand-in for Muse Wonder, so the loop is tested end to end without a live call. */
function scripted(turns: ((seen: number) => ModelTurn)[]): CallModel {
  let i = 0;
  return async (messages) => turns[Math.min(i++, turns.length - 1)](messages.length);
}

describe("engineering agent tools", () => {
  it("exposes OpenAI-compatible tool definitions", () => {
    const defs = toolDefinitions();
    expect(defs.map((d) => d.function.name)).toEqual(["inspect_design", "run_simulation", "revise_design", "finish"]);
    for (const d of defs) expect(d.function.parameters).toHaveProperty("type", "object");
  });

  it("rejects malformed or unknown changes instead of crashing", async () => {
    const state: AgentState = { design: sanitizeDesign(weakArm()), recording: null, simulations: 0, revisions: 0 };
    const bad = await runTool("revise_design", JSON.stringify({ rationale: "x", changes: [{ op: "set_actuator", node: "upper" }] }), state, simulate);
    expect(bad.error).toBe(true);
    const unknownNode = await runTool("revise_design", JSON.stringify({ rationale: "x", changes: [{ op: "set_actuator", node: "nope", actuator: "ak60-6", torqueNm: 0 }] }), state, simulate);
    expect(unknownNode.error).toBe(true);
    expect(state.revisions).toBe(0);
    expect((await runTool("teleport", "{}", state, simulate)).error).toBe(true);
    expect((await runTool("run_simulation", "{not json", state, simulate)).error).toBe(true);
  });

  it("applies library actuators with their datasheet rating, and mirrors l_/r_ edits", () => {
    const d = sanitizeDesign(weakArm());
    const r = applyChanges(d, [{ op: "set_actuator", node: "upper", actuator: "dxl-xm540-w270", torqueNm: 999 }]);
    const upper = r.design.robot.nodes.find((x) => x.id === "upper")!;
    expect(upper.joint.actuator).toBe("dxl-xm540-w270");
    expect(upper.joint.torqueNm).toBe(5); // datasheet, not the model's 999
    const fingers = applyChanges(d, [{ op: "set_joint_speed", node: "l_finger", speed: 60 }]).design.robot.nodes.filter((x) => x.id.endsWith("_finger"));
    expect(fingers.length).toBe(2);
    expect(fingers.every((f) => f.joint.speed === 60)).toBe(true);
  });
});

describe("closed engineering loop", () => {
  it("finds the overloaded shoulder in simulation, fixes it, and proves the fix by re-simulating", async () => {
    const events: string[] = [];
    const result = await runAgent({
      design: sanitizeDesign(weakArm()),
      goal: "Make every step succeed and every joint hold its load.",
      simulate,
      onEvent: (e) => events.push(e.kind === "tool" ? `tool:${e.name}` : e.kind),
      callModel: scripted([
        () => call("inspect_design"),
        () => call("run_simulation"),
        () => call("revise_design", { rationale: "upper pulls 2.65 N·m on a 0.5 N·m MG996R; fore pulls 0.89 on 0.75", changes: [{ op: "set_actuator", node: "upper", actuator: "dxl-xm540-w270", torqueNm: 5 }, { op: "set_actuator", node: "fore", actuator: "dxl-xm430-w350", torqueNm: 2 }] }),
        () => call("run_simulation"),
        () => call("revise_design", { rationale: "it would tip over: widen and deepen the base", changes: [{ op: "resize_part", node: "base", scale: [1.8, 1.4, 1.8] }] }),
        () => call("run_simulation"),
        () => call("finish", { verdict: "validated", summary: "Shoulder and elbow upsized; base widened.", remaining: [] }),
      ]),
    });
    expect(result.before!.overloaded).toBeGreaterThan(0);
    expect(result.after!.overloaded).toBe(0);
    expect(result.after!.errors).toBeLessThan(result.before!.errors);
    console.info("agent before", JSON.stringify(result.before), "after", JSON.stringify(result.after), "verdict", result.verdict);
    expect(result.design.robot.nodes.find((x) => x.id === "upper")!.joint.actuator).toBe("dxl-xm540-w270");
    expect(result.simulations).toBe(3);
    expect(result.revisions).toBe(2);
    expect(events).toContain("design");
    expect(events.filter((e) => e === "tool:run_simulation").length).toBe(3);
    // The verdict comes from the numbers, not from the model's say-so.
    expect(["validated", "improved"]).toContain(result.verdict);
    if (result.verdict === "validated") expect(result.after!.stepsOk).toBe(result.after!.steps);
  }, 120_000);

  it("is bounded: a model that never finishes is stopped, and over-budget simulations are refused", async () => {
    const result = await runAgent({
      design: sanitizeDesign(weakArm()),
      goal: "test",
      simulate,
      maxTurns: 9,
      callModel: scripted([() => call("run_simulation")]),
    });
    expect(result.verdict).toBe("stopped");
    expect(result.turns).toBe(9);
    expect(result.simulations).toBe(6); // LIMITS.simulations
  }, 240_000);

  it("keeps the best measured design when a later revision makes it worse", async () => {
    const result = await runAgent({
      design: sanitizeDesign(weakArm()),
      goal: "test",
      simulate,
      callModel: scripted([
        () => call("run_simulation"),
        () => call("revise_design", { rationale: "fix", changes: [{ op: "set_actuator", node: "upper", actuator: "dxl-xm540-w270", torqueNm: 5 }] }),
        () => call("run_simulation"),
        () => call("revise_design", { rationale: "make it worse", changes: [{ op: "set_actuator", node: "upper", actuator: "mg996r", torqueNm: 0.5 }] }),
        () => call("run_simulation"),
        () => call("finish", { verdict: "validated", summary: "done", remaining: [] }),
      ]),
    });
    expect(result.design.robot.nodes.find((x) => x.id === "upper")!.joint.actuator).toBe("dxl-xm540-w270");
    expect(result.verdict).not.toBe("validated");
  }, 240_000);
});
