// Engineering for AI-designed robots: the same questions a hardware engineer asks of any design.
// Are the actuators big enough for the loads the simulation measured? What bus voltage, peak and
// average current, battery, protection and wiring does it need? Is it feasible and electrically
// safe? Then firmware generated from the simulated motion.
//
// Numbers come from three places, and each result says which: the physics/kinematics simulation
// (measured loads), real datasheets (the actuator library and the parts catalogue), and
// engineering rules of thumb (efficiency, duty cycle, wire gauge). Rule-of-thumb results are
// labelled estimates.
import { CATALOG } from "@/lib/lab/catalog/parts";
import type { Design, NodeSpec } from "./design";
import type { Recording } from "./sim";

// ------------------------------------------------------------------------------ actuators

export interface Actuator {
  id: string;
  name: string;
  /** rated continuous torque, N·m (what it can hold all day) */
  ratedNm: number;
  /** peak torque, N·m (short bursts) */
  peakNm: number;
  /** max output speed, deg/s */
  speed: number;
  volts: number;
  massKg: number;
  usd?: number;
  kind: "hobby servo" | "smart servo" | "QDD actuator";
  source: string;
}

/**
 * Real actuators with datasheet ratings (continuous / peak torque at the rated voltage). Values are
 * the manufacturers' published figures, rounded; check the current datasheet before you buy.
 */
export const ACTUATORS: Actuator[] = [
  { id: "mg996r", name: "MG996R servo", ratedNm: 0.5, peakNm: 1.08, speed: 430, volts: 6, massKg: 0.055, usd: 8, kind: "hobby servo", source: "TowerPro MG996R" },
  { id: "ds3218", name: "DS3218 20 kg servo", ratedNm: 1, peakNm: 2.1, speed: 430, volts: 6.8, massKg: 0.06, usd: 15, kind: "hobby servo", source: "DSServo DS3218" },
  { id: "dynamixel-xl430", name: "Dynamixel XL430-W250-T", ratedNm: 0.75, peakNm: 1.5, speed: 342, volts: 12, massKg: 0.057, usd: 50, kind: "smart servo", source: "ROBOTIS e-Manual" },
  { id: "dxl-xm430-w350", name: "Dynamixel XM430-W350", ratedNm: 2, peakNm: 4.1, speed: 276, volts: 12, massKg: 0.082, usd: 290, kind: "smart servo", source: "ROBOTIS e-Manual" },
  { id: "dxl-xm540-w270", name: "Dynamixel XM540-W270", ratedNm: 5, peakNm: 10.6, speed: 180, volts: 12, massKg: 0.165, usd: 500, kind: "smart servo", source: "ROBOTIS e-Manual" },
  { id: "ak60-6", name: "CubeMars AK60-6", ratedNm: 3, peakNm: 9, speed: 1260, volts: 24, massKg: 0.315, usd: 300, kind: "QDD actuator", source: "CubeMars AK60-6 datasheet" },
  { id: "ak70-10", name: "CubeMars AK70-10", ratedNm: 8.3, peakNm: 24.8, speed: 890, volts: 24, massKg: 0.521, usd: 400, kind: "QDD actuator", source: "CubeMars AK70-10 datasheet" },
  { id: "ak80-9", name: "CubeMars AK80-9", ratedNm: 9, peakNm: 18, speed: 1400, volts: 48, massKg: 0.485, usd: 500, kind: "QDD actuator", source: "CubeMars AK80-9 datasheet" },
  { id: "ak10-9", name: "CubeMars AK10-9 V2", ratedNm: 18, peakNm: 48, speed: 1500, volts: 48, massKg: 0.96, usd: 700, kind: "QDD actuator", source: "CubeMars AK10-9 V2 datasheet" },
  { id: "ak80-64", name: "CubeMars AK80-64", ratedNm: 48, peakNm: 120, speed: 340, volts: 48, massKg: 0.85, usd: 900, kind: "QDD actuator", source: "CubeMars AK80-64 datasheet" },
];

/** What a joint's named actuator is, if we know it (library or catalogue). */
export function knownActuator(ref: string): Actuator | undefined {
  const id = ref.replace(/^need:/, "").trim().toLowerCase();
  const lib = ACTUATORS.find((a) => a.id === id || a.name.toLowerCase() === id || id.includes(a.name.toLowerCase().replace(/^cubemars |^dynamixel /, "")));
  if (lib) return lib;
  const c = CATALOG.find((p) => p.id === id && p.actuator);
  if (!c?.actuator) return undefined;
  const stall = c.actuator.stallKgcm * 0.0981;
  return { id: c.id, name: c.name, ratedNm: stall / 2, peakNm: stall, speed: c.actuator.speed, volts: c.actuator.ratedV, massKg: c.massG / 1000, usd: c.priceUsd, kind: "hobby servo", source: "RoboCraft catalogue" };
}

/** Smallest library actuator that holds `needNm` continuously with a 1.3× margin. */
export function pickActuator(needNm: number, prefer?: Actuator["kind"]): Actuator | undefined {
  const fits = ACTUATORS.filter((a) => a.ratedNm >= needNm * 1.3).sort((a, b) => a.ratedNm - b.ratedNm);
  return (prefer && fits.find((a) => a.kind === prefer)) || fits[0];
}

export interface JointLoad {
  node: NodeSpec;
  actuator?: Actuator;
  /** the design's own rating (what the AI wrote), N·m */
  ratedNm: number;
  /** measured in the simulation, N·m */
  peakNm: number;
  margin: number;
  status: "ok" | "tight" | "over" | "unrated";
  upgrade?: Actuator;
}

export function jointLoads(d: Design, rec: Recording | null): JointLoad[] {
  const peak = new Map((rec?.torque ?? []).map((t) => [t.node, t.peakNm]));
  return d.robot.nodes
    .filter((n) => n.joint.type === "revolute" && !["finger", "gripper_pad"].includes(n.role))
    .map((n) => {
      const actuator = knownActuator(n.joint.actuator);
      // A known actuator's continuous rating wins over what the design claims.
      const ratedNm = actuator ? actuator.ratedNm : n.joint.torqueNm;
      const peakNm = peak.get(n.id) ?? 0;
      const margin = ratedNm > 0 ? ratedNm / Math.max(1e-6, peakNm) : 0;
      const status: JointLoad["status"] = ratedNm <= 0 ? "unrated" : margin < 1 ? "over" : margin < 1.3 ? "tight" : "ok";
      return { node: n, actuator, ratedNm, peakNm, margin, status, upgrade: status === "over" || status === "tight" || status === "unrated" ? pickActuator(peakNm, actuator?.kind) : undefined };
    });
}

/** Swap overloaded / unrated joints to actuators that hold their measured loads. */
export function upsizeActuators(d: Design, loads: JointLoad[], only?: string): Design {
  const swap = new Map(loads.filter((l) => l.upgrade && (!only || l.node.id === only)).map((l) => [l.node.id, l.upgrade!]));
  return {
    ...d,
    robot: {
      ...d.robot,
      nodes: d.robot.nodes.map((n) => {
        const a = swap.get(n.id);
        return a ? { ...n, joint: { ...n.joint, actuator: `need:${a.name}`, torqueNm: a.ratedNm, speed: Math.min(n.joint.speed, a.speed) } } : n;
      }),
    },
  };
}

// ------------------------------------------------------------------------------ electronics

export interface Check {
  id: string;
  severity: "error" | "warning" | "info" | "pass";
  title: string;
  detail: string;
  fix?: string;
  autoFixed?: boolean;
  basis: "physics" | "kinematics" | "engineering" | "estimate" | "ai";
}

export interface Electronics {
  busVolts: number;
  domains: { volts: number; loads: string[] }[];
  peakA: number;
  avgA: number;
  avgW: number;
  battery: { cells: number; volts: number; ah: number; wh: number; massKg: number; name: string };
  runtimeMin: number;
  fuseA: number;
  awg: number;
  converters: string[];
  computeW: number;
  checks: Check[];
}

const AWG: [number, number][] = [
  [3, 22],
  [5, 20],
  [10, 18],
  [15, 16],
  [20, 14],
  [30, 12],
  [40, 10],
  [60, 8],
  [100, 6],
];
const FUSES = [1, 2, 3, 5, 7.5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100, 125, 150];

function computePower(ref: string): number {
  const s = ref.toLowerCase();
  if (/jetson.*(orin|agx)|nuc|xavier/.test(s)) return 25;
  if (/jetson/.test(s)) return 15;
  if (/raspberry|rpi|pi 5|pi5|board_pi/.test(s)) return 7;
  if (/esp32|arduino|uno|nano|pico|stm32/.test(s)) return 1;
  return 10;
}

export function electronics(d: Design, rec: Recording | null, loads = jointLoads(d, rec)): Electronics {
  const checks: Check[] = [];
  // Each actuator's supply voltage: its datasheet, else the class its torque implies.
  const volts = (l: JointLoad) => l.actuator?.volts ?? (l.ratedNm <= 2 ? 7.4 : l.ratedNm <= 15 ? 24 : 48);
  const domainsMap = new Map<number, string[]>();
  for (const l of loads) domainsMap.set(volts(l), [...(domainsMap.get(volts(l)) ?? []), l.node.name]);
  const domains = [...domainsMap].map(([v, names]) => ({ volts: v, loads: names })).sort((a, b) => b.volts - a.volts);
  const busVolts = domains[0]?.volts ?? 12;

  // Power: mechanical power at the measured load and half the planned speed, 70% motor+driver
  // efficiency. Joints don't all peak at once, so the average is a fraction of the summed peaks.
  let peakW = 0;
  let idleW = 0;
  for (const l of loads) {
    // The task moves a joint at most at its planned speed (never faster than the actuator), and
    // rarely flat out: half of it is a fair working speed.
    const omega = (Math.min(l.node.joint.speed, l.actuator?.speed ?? Infinity) * 0.5 * Math.PI) / 180;
    peakW += (Math.max(l.peakNm, l.ratedNm * 0.3) * omega) / 0.7;
    idleW += l.actuator?.kind === "QDD actuator" ? 3 : l.actuator?.kind === "smart servo" ? 0.5 : 0.2;
  }
  const computeW = computePower(d.robot.controller) + d.robot.sensors.length * 2.5;
  // Moving robots draw locomotion power too: rolling ~ 0.05 × weight × speed; walking ~ 3× that.
  const massKg = rec?.massKg ?? 10;
  const travelW = d.robot.mobility === "fixed" ? 0 : ((d.robot.mobility === "legs" ? 0.15 : d.robot.mobility === "flying" ? 1 : 0.05) * massKg * 9.81 * (d.robot.speed || 0.4)) / 0.7 + (d.robot.mobility === "flying" ? massKg * 150 : 0);
  const avgW = peakW * 0.3 + idleW + computeW + travelW * 0.5;
  const peakA = (peakW + computeW + travelW) / busVolts;
  const avgA = avgW / busVolts;

  // Battery: Li-ion cells in series for the bus, capacity for 2 hours (30 min for drones).
  const cells = Math.max(1, Math.round(busVolts / 3.7));
  const packV = cells * 3.7;
  const hours = d.robot.mobility === "flying" ? 0.5 : 2;
  const ah = Math.max(1, Math.ceil(((avgW * hours) / packV) * 2) / 2);
  const wh = ah * packV;
  const named = d.robot.power ? CATALOG.find((p) => p.id === d.robot.power) : undefined;
  const namedWh = named?.electrical?.mAh ? (named.electrical.mAh / 1000) * (named.electrical.vMax ?? packV) : undefined;
  const battery = namedWh
    ? { cells, volts: named!.electrical!.vMax ?? packV, ah: named!.electrical!.mAh! / 1000, wh: namedWh, massKg: named!.massG / 1000, name: named!.name }
    : { cells, volts: packV, ah, wh, massKg: wh / 180, name: `${cells}S Li-ion ${ah} Ah (${Math.round(wh)} Wh)` };
  const runtimeMin = (battery.wh * 0.85 * 60) / Math.max(1, avgW);

  const fuseA = FUSES.find((f) => f >= peakA * 1.25) ?? 150;
  const awg = (AWG.find(([a]) => a >= peakA * 1.25) ?? [0, 4])[1];
  const converters = domains.slice(1).map((dm) => `${busVolts} V → ${dm.volts} V DC-DC (${dm.loads.length} actuator${dm.loads.length > 1 ? "s" : ""})`);
  if (computeW > 0) converters.push(`${busVolts} V → 5 V / ${computeW > 12 ? "5 A" : "3 A"} for the computer and sensors`);

  // ---- checks
  const over = loads.filter((l) => l.status === "over");
  const tight = loads.filter((l) => l.status === "tight");
  const unrated = loads.filter((l) => l.status === "unrated");
  if (over.length) checks.push({ id: "torque", severity: "error", title: `${over.length} joint${over.length > 1 ? "s" : ""} can't hold their load`, detail: over.slice(0, 5).map((l) => `${l.node.name}: needs ${l.peakNm.toFixed(1)} N·m, rated ${l.ratedNm.toFixed(1)}`).join("; "), fix: "Use Fix overloaded joints to upsize them to real actuators that hold the measured loads with margin.", basis: "physics" });
  if (tight.length) checks.push({ id: "tight", severity: "warning", title: `${tight.length} joint${tight.length > 1 ? "s" : ""} under 30% margin`, detail: tight.slice(0, 5).map((l) => `${l.node.name} ${Math.round((l.margin - 1) * 100)}% spare`).join("; "), fix: "Upsize them, or shorten the lever / lighten what they carry.", basis: "physics" });
  if (unrated.length) checks.push({ id: "unrated", severity: "warning", title: `${unrated.length} joint${unrated.length > 1 ? "s have" : " has"} no rated actuator`, detail: unrated.slice(0, 6).map((l) => l.node.name).join(", "), fix: "Fix overloaded joints picks one for each from their measured loads.", basis: "engineering" });
  if (!over.length && !tight.length && loads.length) checks.push({ id: "torque-ok", severity: "pass", title: "Every actuator holds its load with margin", detail: `Smallest margin ${Math.round((Math.min(...loads.filter((l) => l.ratedNm > 0).map((l) => l.margin)) - 1) * 100)}% over the peak measured in the simulation.`, basis: "physics" });
  if (domains.length > 1) checks.push({ id: "domains", severity: "info", title: `${domains.length} voltage domains: added DC-DC converters`, detail: domains.map((dm) => `${dm.volts} V: ${dm.loads.length} actuator(s)`).join(" · "), autoFixed: true, basis: "engineering" });
  checks.push({ id: "fuse", severity: "info", title: `Added a ${fuseA} A main fuse and an emergency stop`, detail: `Peak draw is about ${peakA.toFixed(1)} A at ${busVolts} V; the fuse is sized at 125% of it. A latching E-stop cuts actuator power but keeps the computer alive.`, autoFixed: true, basis: "estimate" });
  checks.push({ id: "wire", severity: "info", title: `Main power wiring: ${awg} AWG`, detail: `Rated for ${(AWG.find(([, g]) => g === awg)?.[0] ?? 0).toFixed(0)} A chassis wiring at ${peakA.toFixed(1)} A peak.`, basis: "estimate" });
  if (namedWh) checks.push({ id: "battery", severity: runtimeMin < 20 ? "warning" : "pass", title: `${battery.name}: about ${Math.round(runtimeMin)} min`, detail: `${Math.round(battery.wh)} Wh at an estimated ${Math.round(avgW)} W average.`, fix: runtimeMin < 20 ? "Use a bigger pack." : undefined, basis: "estimate" });
  else checks.push({ id: "battery", severity: "info", title: `Sized the battery: ${battery.name}`, detail: `About ${Math.round(runtimeMin)} min at an estimated ${Math.round(avgW)} W average (${Math.round(peakW)} W actuator peak, ${computeW} W computing and sensing). Weighs about ${battery.massKg.toFixed(1)} kg.`, autoFixed: true, basis: "estimate" });
  if (busVolts >= 48) checks.push({ id: "hv", severity: "info", title: "48 V bus: use a precharge circuit", detail: "Motor controllers' input capacitors draw a large inrush at 48 V; a precharge resistor and relay prevent arcing at the connector.", autoFixed: true, basis: "engineering" });
  const ctrl = d.robot.controller.toLowerCase();
  if (loads.some((l) => l.actuator?.kind === "QDD actuator") && /arduino|uno|nano|esp32/.test(ctrl)) checks.push({ id: "can", severity: "warning", title: "QDD actuators need a CAN bus", detail: "CubeMars-style actuators talk CAN; an Arduino / ESP32 needs a CAN transceiver (and an ESP32 is short on compute for many of them).", fix: "Add an MCP2515 / SN65HVD230 CAN interface, or use a computer with CAN.", basis: "engineering" });
  if (loads.length > 8 && /arduino|uno|nano/.test(ctrl)) checks.push({ id: "io", severity: "warning", title: `${loads.length} actuators on an ${d.robot.controller}`, detail: "That's more PWM channels and current than it can handle directly.", fix: "Use smart servos on one bus, or a PCA9685 driver.", basis: "engineering" });
  return { busVolts, domains, peakA, avgA, avgW, battery, runtimeMin, fuseA, awg, converters, computeW, checks };
}

// ------------------------------------------------------------------------------ verdict

export function overview(d: Design, rec: Recording | null) {
  const loads = jointLoads(d, rec);
  const elec = electronics(d, rec, loads);
  const simChecks: Check[] = (rec?.checks ?? [])
    .filter((c) => !c.id.startsWith("torque") && c.id !== "unrated")
    .map((c) => ({ id: `sim-${c.id}`, severity: c.level === "warn" ? "warning" : c.level, title: c.title, detail: c.detail, basis: c.basis }));
  const checks = [...elec.checks, ...simChecks];
  const errors = checks.filter((c) => c.severity === "error").length;
  const warnings = checks.filter((c) => c.severity === "warning").length;
  const costed = loads.filter((l) => l.actuator?.usd);
  const cost = costed.reduce((s, l) => s + (l.actuator!.usd ?? 0), 0);
  return { loads, elec, checks, errors, warnings, passed: checks.filter((c) => c.severity === "pass").length, autoFixes: checks.filter((c) => c.autoFixed).length, cost, costed: costed.length };
}

// ------------------------------------------------------------------------------ firmware

/** Joint positions at the end of each task step, from the simulation. */
function keyframes(d: Design, rec: Recording) {
  return rec.steps.map((s) => {
    const f = Math.min(rec.frames - 1, Math.round(s.end * rec.fps));
    const q = rec.joints.map((j, k) => ({ id: d.robot.nodes[j].id, value: rec.q[f * rec.joints.length + k], type: d.robot.nodes[j].joint.type }));
    return { label: s.label, t: s.end, q };
  });
}

/** ROS 2 (rclpy) node that plays the simulated task as a JointTrajectory. */
export function ros2Node(d: Design, rec: Recording): string {
  const kf = keyframes(d, rec);
  const joints = kf[0]?.q ?? [];
  const name = d.title.replace(/\W+/g, "_").toLowerCase();
  const rad = (v: number, t: string) => (t === "revolute" ? (v * Math.PI) / 180 : v).toFixed(4);
  return `#!/usr/bin/env python3
"""${d.title}: plays the task RoboCraft simulated, as a ROS 2 JointTrajectory.

Joint names match the exported URDF (<node>_joint). Positions are in radians (revolute) and
metres (prismatic), one waypoint per task step, timed like the simulation. Send it to a
joint_trajectory_controller (ros2_control); check limits on the real robot before running.
"""
import rclpy
from rclpy.node import Node
from builtin_interfaces.msg import Duration
from trajectory_msgs.msg import JointTrajectory, JointTrajectoryPoint

JOINTS = [
${joints.map((j) => `    "${j.id}_joint",`).join("\n")}
]

# (time from start in s, positions, step)
WAYPOINTS = [
${kf.map((k) => `    (${k.t.toFixed(2)}, [${k.q.map((j) => rad(j.value, j.type)).join(", ")}], ${JSON.stringify(k.label)}),`).join("\n")}
]


class ${name.replace(/(^|_)(\w)/g, (_, __, c: string) => c.toUpperCase()).slice(0, 40) || "Task"}Player(Node):
    def __init__(self):
        super().__init__("${name.slice(0, 40)}_task")
        self.pub = self.create_publisher(JointTrajectory, "/joint_trajectory_controller/joint_trajectory", 10)
        self.timer = self.create_timer(1.0, self.send_once)

    def send_once(self):
        self.timer.cancel()
        msg = JointTrajectory()
        msg.joint_names = JOINTS
        for t, positions, label in WAYPOINTS:
            p = JointTrajectoryPoint()
            p.positions = positions
            p.time_from_start = Duration(sec=int(t), nanosec=int((t % 1) * 1e9))
            msg.points.append(p)
        self.pub.publish(msg)
        self.get_logger().info(f"Sent {len(WAYPOINTS)} waypoints over {WAYPOINTS[-1][0]:.1f} s")


def main():
    rclpy.init()
    rclpy.spin(${name.replace(/(^|_)(\w)/g, (_, __, c: string) => c.toUpperCase()).slice(0, 40) || "Task"}Player())


if __name__ == "__main__":
    main()
`;
}

/** Arduino / ESP32 sketch for hobby-servo robots: each step eases every servo to its pose. */
export function arduinoSketch(d: Design, rec: Recording): string {
  const kf = keyframes(d, rec);
  const servos = (kf[0]?.q ?? []).filter((j) => j.type === "revolute").slice(0, 16);
  const ids = servos.map((s) => s.id);
  return `// ${d.title}: the task RoboCraft simulated, for hobby servos on a PCA9685 (16 channels).
// Each row is a task step: target angles (degrees from the servo's centre) and its duration.
// Calibrate each servo's centre and direction on the real robot before running the full task.
#include <Wire.h>
#include <Adafruit_PWMServoDriver.h>

Adafruit_PWMServoDriver pwm;
const int N = ${ids.length};
// Channel order: ${ids.join(", ")}
const float SERVO_MIN_US = 500, SERVO_MAX_US = 2500;

struct Step { const char* label; float ms; float deg[${Math.max(1, ids.length)}]; };
const Step STEPS[] = {
${kf.map((k, i) => `  {${JSON.stringify(k.label.slice(0, 40))}, ${Math.round((k.t - (i ? kf[i - 1].t : 0)) * 1000)}, {${ids.map((id) => (k.q.find((j) => j.id === id)?.value ?? 0).toFixed(1)).join(", ")}}},`).join("\n")}
};
float now[${Math.max(1, ids.length)}];

void writeDeg(int ch, float deg) {
  float us = 1500 + constrain(deg, -90, 90) * (SERVO_MAX_US - SERVO_MIN_US) / 180.0;
  pwm.writeMicroseconds(ch, us);
}

void setup() {
  Serial.begin(115200);
  pwm.begin();
  pwm.setOscillatorFrequency(27000000);
  pwm.setPWMFreq(50);
  for (int i = 0; i < N; i++) { now[i] = STEPS[0].deg[i]; writeDeg(i, now[i]); }
  delay(1000);
}

void loop() {
  for (const Step& s : STEPS) {
    Serial.println(s.label);
    float from[${Math.max(1, ids.length)}];
    for (int i = 0; i < N; i++) from[i] = now[i];
    const int frames = max(1, (int)(s.ms / 20));
    for (int f = 1; f <= frames; f++) {
      float u = (float)f / frames;
      u = u * u * (3 - 2 * u);  // ease in and out, like the simulation
      for (int i = 0; i < N; i++) { now[i] = from[i] + (s.deg[i] - from[i]) * u; writeDeg(i, now[i]); }
      delay(20);
    }
  }
  delay(3000);
}
`;
}
