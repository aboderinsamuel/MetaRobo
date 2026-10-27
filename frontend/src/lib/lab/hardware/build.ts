// Hardware builds: the parts and dimensions of one of the four rigs. Everything the lab
// simulates is derived from here - the plant comes from motor datasheet numbers, the actuator
// limits from the battery and driver, the sensor noise and latency from the sensor - so swapping a
// part changes the physics, the checks and the 3D model together.
import type { ControllerSpec, LabModel, ParamRow, RigKind } from "../types";
import {
  ALTIMETERS,
  AUTO_PARTS,
  BATTERIES,
  BOARDS,
  DRIVERS,
  DRONE_BATTERIES,
  DRONE_MOTORS,
  ENCODERS,
  ESCS,
  FLIGHT_CONTROLLERS,
  GEARMOTORS,
  HC_SR04,
  IMUS,
  KGCM,
  PROPS,
} from "./parts";
import { DECK_GAP, batteryDims, boardDims, driverDims, motorDims } from "./dims";
import type { Battery, Board, DroneMotor, Driver, GearMotor, PartBase, Prop, Sensor, SlotId } from "./parts";

const G = 9.81;
const TAU = Math.PI * 2;

export interface HardwareBuild {
  kind: RigKind;
  parts: Partial<Record<SlotId, string>>;
  /** SI units (m, kg, rad, m/s). */
  geom: Record<string, number>;
}

export interface GeomSpec {
  key: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  /** Displayed value = SI value × scale. */
  scale: number;
  group: "Geometry" | "Mass & payload" | "Mission";
  info?: string;
}

export interface SlotSpec {
  slot: SlotId;
  label: string;
  options: PartBase[];
  qty: number;
}

export type CheckLevel = "pass" | "info" | "warn" | "error";

export interface DesignCheck {
  id: string;
  level: CheckLevel;
  title: string;
  detail: string;
  slot?: SlotId;
  /** RoboCraft added a part to make the design safe. */
  auto?: boolean;
  fix?: { label: string; parts?: Partial<Record<SlotId, string>>; geom?: Record<string, number> };
  /** Short text shown on the part in the 3D view. */
  callout?: string;
}

export interface BomLine {
  name: string;
  qty: number;
  price: number;
  mass: number; // g, per unit
  slot?: SlotId;
  auto?: boolean;
}

export interface Stat {
  label: string;
  value: string;
  sub: string;
  tone?: "ok" | "warn" | "bad";
}

export interface NetNode {
  id: string;
  ref: string;
  name: string;
  sub: string;
  pins: string[];
  col: number;
  auto?: boolean;
}

export interface NetEdge {
  from: [string, string];
  to: [string, string];
  kind: "power" | "ground" | "signal" | "motor";
  net: string;
}

export interface DcMotorModel {
  R: number;
  L: number;
  Kt: number;
  Ke: number;
  b: number;
  Jr: number;
  wNl: number;
  stallNm: number;
}

export interface DerivedHardware {
  build: HardwareBuild;
  model: LabModel;
  board: Board;
  driver: Driver;
  battery: Battery;
  sensor: Sensor;
  motor?: GearMotor;
  droneMotor?: DroneMotor;
  prop?: Prop;
  dc?: DcMotorModel;
  vAvail: number;
  massKg: number;
  cost: number;
  bom: BomLine[];
  stats: Stat[];
  checks: DesignCheck[];
  wiring: { nodes: NetNode[]; edges: NetEdge[] };
  /** Rig-specific numbers used by telemetry and the 3D view. */
  facts: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Slots, geometry and defaults
// ---------------------------------------------------------------------------

export const SLOTS: Record<RigKind, SlotSpec[]> = {
  rover: [
    { slot: "motor", label: "Drive motors", options: GEARMOTORS.filter((m) => m.look !== "pg45"), qty: 2 },
    { slot: "driver", label: "Motor driver", options: DRIVERS, qty: 1 },
    { slot: "battery", label: "Battery", options: BATTERIES.filter((b) => b.kind === "battery"), qty: 1 },
    { slot: "board", label: "Controller board", options: BOARDS, qty: 1 },
    { slot: "sensor", label: "Wheel encoders", options: ENCODERS, qty: 2 },
  ],
  arm: [
    { slot: "motor", label: "Shoulder actuator", options: GEARMOTORS, qty: 1 },
    { slot: "driver", label: "Motor driver", options: DRIVERS, qty: 1 },
    { slot: "battery", label: "Power supply", options: BATTERIES, qty: 1 },
    { slot: "board", label: "Controller board", options: BOARDS, qty: 1 },
    { slot: "sensor", label: "Joint sensor", options: ENCODERS, qty: 1 },
  ],
  balancer: [
    { slot: "motor", label: "Wheel motors", options: GEARMOTORS.filter((m) => m.look !== "pg45"), qty: 2 },
    { slot: "driver", label: "Motor driver", options: DRIVERS, qty: 1 },
    { slot: "battery", label: "Battery", options: BATTERIES.filter((b) => b.kind === "battery"), qty: 1 },
    { slot: "board", label: "Controller board", options: BOARDS, qty: 1 },
    { slot: "sensor", label: "Tilt sensor (IMU)", options: IMUS, qty: 1 },
  ],
  drone: [
    { slot: "motor", label: "Motors", options: DRONE_MOTORS, qty: 4 },
    { slot: "prop", label: "Propellers + frame", options: PROPS, qty: 1 },
    { slot: "driver", label: "ESC", options: ESCS, qty: 1 },
    { slot: "battery", label: "Battery", options: DRONE_BATTERIES, qty: 1 },
    { slot: "board", label: "Flight controller", options: FLIGHT_CONTROLLERS, qty: 1 },
    { slot: "sensor", label: "Altitude sensor", options: ALTIMETERS, qty: 1 },
  ],
};

const g = (key: string, label: string, unit: string, min: number, max: number, step: number, scale: number, group: GeomSpec["group"], info?: string): GeomSpec => ({
  key,
  label,
  unit,
  min,
  max,
  step,
  scale,
  group,
  info,
});

export const GEOMETRY: Record<RigKind, GeomSpec[]> = {
  rover: [
    g("chassisL", "Chassis length", "mm", 0.12, 0.4, 0.005, 1000, "Geometry"),
    g("chassisW", "Chassis width", "mm", 0.08, 0.3, 0.005, 1000, "Geometry"),
    g("wheelD", "Wheel diameter", "mm", 0.032, 0.15, 0.001, 1000, "Geometry", "Bigger wheels go faster but need more torque."),
    g("chassisMass", "Chassis mass", "kg", 0.1, 3, 0.05, 1, "Mass & payload", "Frame, wheels and wiring, without the parts."),
    g("payload", "Payload", "kg", 0, 5, 0.05, 1, "Mass & payload"),
    g("target", "Cruise speed", "m/s", 0.1, 2, 0.05, 1, "Mission"),
    g("slope", "Ramp at the end", "°", 0, 0.436, 0.0175, 180 / Math.PI, "Mission", "A ramp the rover drives onto during the run (the load disturbance)."),
  ],
  arm: [
    g("shoulderH", "Shoulder height", "mm", 0.06, 0.2, 0.005, 1000, "Geometry"),
    g("upper", "Upper arm length", "mm", 0.06, 0.25, 0.005, 1000, "Geometry"),
    g("fore", "Forearm length", "mm", 0.06, 0.25, 0.005, 1000, "Geometry"),
    g("baseR", "Base footprint radius", "mm", 0.04, 0.15, 0.005, 1000, "Geometry", "Wider bases resist tipping at full reach."),
    g("upperMass", "Upper arm mass", "g", 0.02, 0.4, 0.005, 1000, "Mass & payload"),
    g("foreMass", "Forearm mass", "g", 0.02, 0.4, 0.005, 1000, "Mass & payload"),
    g("payload", "Payload", "g", 0, 1, 0.01, 1000, "Mass & payload"),
    g("target", "Lift angle", "°", 0.35, 1.4, 0.0175, 180 / Math.PI, "Mission", "How far the shoulder swings from the pick pose to the place pose."),
  ],
  balancer: [
    g("comH", "Centre-of-mass height", "mm", 0.06, 0.4, 0.005, 1000, "Geometry", "Taller robots fall more slowly and are easier to balance."),
    g("wheelD", "Wheel diameter", "mm", 0.04, 0.15, 0.002, 1000, "Geometry"),
    g("frameMass", "Frame mass", "kg", 0.1, 2, 0.05, 1, "Mass & payload", "Body frame and shell, without the parts."),
    g("payload", "Payload on top", "kg", 0, 2, 0.05, 1, "Mass & payload"),
    g("target", "Drive distance", "m", 0.1, 1.5, 0.05, 1, "Mission"),
  ],
  drone: [
    g("payload", "Payload (camera, gimbal)", "g", 0, 1.5, 0.01, 1000, "Mass & payload"),
    g("target", "Climb", "m", 0.3, 5, 0.1, 1, "Mission"),
    g("gust", "Down-gust strength", "%", 0, 0.4, 0.01, 100, "Mission", "A downdraft as a fraction of the vehicle's weight."),
  ],
};

export const DEFAULT_BUILDS: Record<RigKind, HardwareBuild> = {
  rover: {
    kind: "rover",
    parts: { motor: "n20", driver: "l298n", battery: "18650-2s", board: "esp32", sensor: "hall11" },
    geom: { chassisL: 0.2, chassisW: 0.14, wheelD: 0.065, chassisMass: 0.4, payload: 0.2, target: 0.5, slope: 0.1745 },
  },
  arm: {
    kind: "arm",
    parts: { motor: "jgb37", driver: "l298n", battery: "adapter12", board: "uno", sensor: "as5600" },
    geom: { shoulderH: 0.1, upper: 0.12, fore: 0.12, baseR: 0.07, upperMass: 0.06, foreMass: 0.045, payload: 0.05, target: 1.047 },
  },
  balancer: {
    kind: "balancer",
    parts: { motor: "jga25-12", driver: "l298n", battery: "lipo-3s", board: "nano", sensor: "mpu6050" },
    geom: { comH: 0.15, wheelD: 0.08, frameMass: 0.5, payload: 0, target: 0.3 },
  },
  drone: {
    kind: "drone",
    parts: { motor: "2212", prop: "p10", driver: "esc20", battery: "d3s2200", board: "f405", sensor: "vl53l1x" },
    geom: { payload: 0.3, target: 1, gust: 0.12 },
  },
};

export function defaultBuild(kind: RigKind): HardwareBuild {
  const b = DEFAULT_BUILDS[kind];
  return { kind, parts: { ...b.parts }, geom: { ...b.geom } };
}

function find<T extends PartBase>(list: T[], id: string | undefined): T {
  return list.find((p) => p.id === id) ?? list[0];
}

export function partFor(build: HardwareBuild, slot: SlotId): PartBase | undefined {
  const spec = SLOTS[build.kind].find((s) => s.slot === slot);
  return spec ? find(spec.options, build.parts[slot]) : undefined;
}

// ---------------------------------------------------------------------------
// Words → build
// ---------------------------------------------------------------------------

/** Pulls masses, speeds, distances and angles out of a description to size the build. */
export function applyHints(build: HardwareBuild, text: string): HardwareBuild {
  const t = text.toLowerCase();
  const geom = { ...build.geom };
  const num = (re: RegExp) => {
    const m = re.exec(t);
    return m ? parseFloat(m[1]) : undefined;
  };
  const kg = num(/(\d+(?:\.\d+)?)\s*kg\b/) ?? ((x) => (x === undefined ? undefined : x / 1000))(num(/(\d+(?:\.\d+)?)\s*(?:g|grams?)\b(?!\w)/));
  const clampTo = (key: string, v: number) => {
    const s = GEOMETRY[build.kind].find((x) => x.key === key);
    if (s) geom[key] = Math.min(s.max, Math.max(s.min, v));
  };
  const speed = num(/(\d+(?:\.\d+)?)\s*m\/s/);
  // Distances count as the mission only after a verb of motion ("drive 30 cm", "climb 2 m").
  const len = (re: RegExp) => {
    const m = re.exec(t);
    return m ? parseFloat(m[1]) * (m[2] === "cm" ? 0.01 : m[2] === "mm" ? 0.001 : 1) : undefined;
  };
  const metres = len(/(?:drive|move|go|travel|roll|climb|rise|ascend|fly|hover|lift)\w*(?:\s+(?:it|about|to|by|up|forward|ahead|another|the|robot))*\s+(\d+(?:\.\d+)?)\s*(cm|mm|m)\b(?!\/)/);
  const above = len(/(\d+(?:\.\d+)?)\s*(cm|mm|m)\s+(?:above|over|high)/);
  const deg = num(/(\d+(?:\.\d+)?)\s*(?:°|deg|degrees?)/);
  const rad = num(/(\d+(?:\.\d+)?)\s*rad/);
  // Small masses are payloads; large ones are the whole machine.
  if (build.kind === "rover") {
    if (speed !== undefined) clampTo("target", speed);
    if (kg !== undefined) clampTo("payload", kg < 0.5 ? kg : Math.max(0, kg - 0.6));
  } else if (build.kind === "arm") {
    if (deg !== undefined) clampTo("target", (deg * Math.PI) / 180);
    else if (rad !== undefined) clampTo("target", rad);
    if (kg !== undefined) clampTo("payload", kg);
  } else if (build.kind === "balancer") {
    if (metres !== undefined) clampTo("target", metres);
    if (above !== undefined) clampTo("comH", above);
    if (kg !== undefined) clampTo("frameMass", Math.max(0.1, kg - 0.6));
  } else {
    if (metres !== undefined) clampTo("target", metres);
    if (kg !== undefined) clampTo("payload", kg < 0.6 ? kg : Math.max(0, kg - 0.75));
  }
  return { ...build, geom };
}

// ---------------------------------------------------------------------------
// Physics helpers
// ---------------------------------------------------------------------------

export function dcMotor(m: GearMotor): DcMotorModel {
  const R = m.ratedV / m.stallA;
  const stallNm = m.stallKgcm * KGCM;
  const Kt = stallNm / m.stallA;
  const wNl = (m.rpm * TAU) / 60;
  const Ke = (m.ratedV - m.noLoadA * R) / wNl;
  return { R, L: 0.0015, Kt, Ke, b: (Kt * m.noLoadA) / wNl, Jr: m.rotorJ * m.ratio * m.ratio, wNl, stallNm };
}

function droneThrust(motor: DroneMotor, prop: Prop, battery: Battery) {
  const cf = (battery.cells ?? 3) / motor.cells;
  const pf = prop.inch / motor.propIn;
  const thrustN = ((motor.thrustG * Math.pow(cf, 1.5) * Math.min(2.5, Math.max(0.15, Math.pow(pf, 1.6)))) / 1000) * G;
  const maxA = motor.maxA * Math.pow(cf, 1.5) * Math.min(4, Math.max(0.1, Math.pow(pf, 2.4)));
  return { thrustN, maxA, cf, pf };
}

const p = (symbol: string, name: string, value: number, unit: string): ParamRow => ({ symbol, name, value, unit });
const r2 = (v: number, d = 2) => Number(v.toFixed(d));
const fmt = (v: number, d = 2) => (Math.abs(v) >= 100 ? Math.round(v).toString() : r2(v, d).toString());

/** Cheapest part in a list that satisfies a predicate. */
function cheapest<T extends PartBase>(list: T[], ok: (p: T) => boolean): T | undefined {
  return list.filter(ok).sort((a, b) => a.price - b.price)[0];
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

export function deriveHardware(build: HardwareBuild): DerivedHardware {
  switch (build.kind) {
    case "rover":
      return deriveRover(build);
    case "arm":
      return deriveArm(build);
    case "balancer":
      return deriveBalancer(build);
    default:
      return deriveDrone(build);
  }
}

interface Common {
  board: Board;
  driver: Driver;
  battery: Battery;
  sensor: Sensor;
  vAvail: number;
  checks: DesignCheck[];
  autoLines: BomLine[];
  levelShift: boolean;
  buck: boolean;
}

/** Power and logic rules shared by the three DC-motor rigs (the README's electrical engine). */
function electrical(build: HardwareBuild, motor: GearMotor, motors: number): Common {
  const board = find(BOARDS, build.parts.board);
  const driver = find(DRIVERS, build.parts.driver);
  const battery = find(BATTERIES, build.parts.battery);
  const sensor = find(build.kind === "balancer" ? IMUS : ENCODERS, build.parts.sensor);
  const checks: DesignCheck[] = [];
  const autoLines: BomLine[] = [];
  const vAvail = Math.max(0, Math.min(battery.vNom, driver.vMax) - driver.dropV);

  // Supply vs driver.
  if (battery.vMax > driver.vMax) {
    const fix = cheapest(DRIVERS, (d) => d.vMax >= battery.vMax && d.contA >= Math.min(motor.stallA, 10));
    checks.push({
      id: "drv-volt",
      level: "error",
      title: `${battery.name} exceeds the ${driver.name}'s ${driver.vMax} V limit`,
      detail: `A full pack reaches ${battery.vMax} V. The driver's MOSFETs are rated for ${driver.vMax} V and will fail.`,
      slot: "driver",
      callout: `${battery.vMax} V > ${driver.vMax} V`,
      fix: fix ? { label: `Use ${fix.name}`, parts: { driver: fix.id } } : undefined,
    });
  } else if (battery.vMin < driver.vMin) {
    checks.push({
      id: "drv-vmin",
      level: "warn",
      title: `${driver.name} drops out near the end of the battery`,
      detail: `The pack sags to ${battery.vMin} V, below the driver's ${driver.vMin} V minimum.`,
      slot: "driver",
    });
  } else {
    checks.push({ id: "drv-volt", level: "pass", title: `${battery.vNom} V supply suits the ${driver.name}`, detail: `Driver range ${driver.vMin}–${driver.vMax} V.`, slot: "driver" });
  }

  // Motor voltage.
  if (vAvail > motor.vMax * 1.1) {
    const v = Math.round((vAvail / motor.ratedV) * 100);
    checks.push({
      id: "mot-over",
      level: "warn",
      title: `Motors over-volted at ${fmt(vAvail)} V (${v}% of rated)`,
      detail: `The ${motor.name} is rated ${motor.ratedV} V (max ${motor.vMax} V). It will run fast and hot; limit the PWM duty in firmware or use a lower-voltage pack.`,
      slot: "motor",
      callout: `${fmt(vAvail)} V > ${motor.vMax} V`,
    });
  } else if (vAvail < motor.ratedV * 0.6) {
    checks.push({
      id: "mot-under",
      level: "warn",
      title: `Motors only see ${fmt(vAvail)} V of their ${motor.ratedV} V rating`,
      detail: `${driver.dropV > 1 ? `The ${driver.name} loses ${driver.dropV} V. ` : ""}Speed and torque drop to ${Math.round((vAvail / motor.ratedV) * 100)}%.`,
      slot: "battery",
      fix: driver.dropV > 1 ? { label: "Use TB6612FNG (0.5 V drop)", parts: { driver: "tb6612" } } : undefined,
    });
  } else {
    checks.push({ id: "mot-volt", level: "pass", title: `${fmt(vAvail)} V at the motors suits the ${motor.ratedV} V rating`, detail: `${battery.vNom} V pack minus the driver's ${driver.dropV} V drop.`, slot: "motor" });
  }

  if (driver.dropV >= 1.5)
    checks.push({
      id: "drv-drop",
      level: "info",
      title: `${driver.name} loses about ${driver.dropV} V`,
      detail: "Bipolar H-bridges waste power as heat. A MOSFET driver (TB6612FNG, MDD10A) gives the motors more voltage from the same battery.",
      slot: "driver",
    });

  // Stall current vs driver and battery.
  if (motor.stallA > driver.peakA) {
    const fix = cheapest(DRIVERS, (d) => d.peakA >= motor.stallA && d.vMax >= battery.vMax);
    checks.push({
      id: "drv-stall",
      level: "warn",
      title: `Stall current ${motor.stallA} A exceeds the driver's ${driver.peakA} A peak`,
      detail: `If a wheel jams the ${driver.name} will overheat or shut down. Add current limiting in firmware or pick a bigger driver.`,
      slot: "driver",
      callout: `${motor.stallA} A stall`,
      fix: fix ? { label: `Use ${fix.name}`, parts: { driver: fix.id } } : undefined,
    });
  }
  if (battery.maxA < motor.stallA * motors) {
    checks.push({
      id: "bat-amps",
      level: "warn",
      title: `Battery can deliver ${battery.maxA} A; both motors can stall at ${fmt(motor.stallA * motors)} A`,
      detail: "The pack's protection board will cut out under hard acceleration. A LiPo pack has the headroom.",
      slot: "battery",
      fix: { label: "Use 2S LiPo 2200 mAh", parts: { battery: "lipo-2s" } },
    });
  }

  // Logic rail.
  let buck = false;
  if (driver.onboard5v && battery.vMax <= driver.onboard5v.maxInV) {
    checks.push({ id: "5v", level: "pass", title: `5 V logic from the ${driver.name}'s regulator`, detail: `Its onboard regulator works up to ${driver.onboard5v.maxInV} V input.` });
  } else if (battery.kind === "adapter" || battery.vNom > 5.5) {
    buck = true;
    autoLines.push({ name: AUTO_PARTS.buck.name, qty: 1, price: AUTO_PARTS.buck.price, mass: AUTO_PARTS.buck.mass, auto: true });
    checks.push({
      id: "buck",
      level: "info",
      auto: true,
      title: "Added an LM2596 buck converter for the 5 V logic rail",
      detail: `${driver.onboard5v ? `The ${driver.name}'s regulator only takes ${driver.onboard5v.maxInV} V. ` : ""}The board and sensors need a clean 5 V supply.`,
    });
  } else {
    checks.push({ id: "5v", level: "info", title: "Board runs straight from the pack", detail: `${battery.vNom} V is within the board's input range.` });
  }

  // Logic levels.
  const vihNeeded = driver.vih < 1 ? driver.vih * 5 : driver.vih;
  if (board.logicV < vihNeeded) {
    checks.push({
      id: "logic-drv",
      level: "info",
      title: `Power the ${driver.name}'s logic from 3.3 V`,
      detail: `Its inputs need ${fmt(vihNeeded)} V when run at 5 V; on a 3.3 V logic supply the ${board.name}'s pins drive it directly.`,
      slot: "driver",
    });
  } else {
    checks.push({ id: "logic-drv", level: "pass", title: `${board.logicV} V signals drive the ${driver.name}`, detail: `Logic high threshold ${fmt(vihNeeded)} V.`, slot: "board" });
  }
  let levelShift = false;
  const sensorsOut = [sensor.outV, ...(build.kind === "rover" ? [HC_SR04.outV] : [])];
  if (board.logicV < 4 && sensorsOut.some((v) => v > 3.6)) {
    levelShift = true;
    autoLines.push({ name: AUTO_PARTS.levelShifter.name, qty: 1, price: AUTO_PARTS.levelShifter.price, mass: AUTO_PARTS.levelShifter.mass, auto: true });
    checks.push({
      id: "level",
      level: "info",
      auto: true,
      title: "Added a level shifter for 5 V sensor outputs",
      detail: `The ${board.name}'s pins tolerate ${board.logicV} V. ${build.kind === "rover" ? "The HC-SR04's 5 V ECHO pulse" : `The ${sensor.name}'s 5 V output`} would damage them.`,
      slot: "board",
    });
  } else {
    checks.push({ id: "level", level: "pass", title: "Sensor signals are safe for this board", detail: `Sensor outputs ≤ ${board.logicV + 0.3} V.`, slot: "sensor" });
  }

  // Safety parts.
  if (battery.kind === "battery") {
    autoLines.push({ name: AUTO_PARTS.fuse.name, qty: 1, price: AUTO_PARTS.fuse.price, mass: AUTO_PARTS.fuse.mass, auto: true });
    autoLines.push({ name: AUTO_PARTS.switch.name, qty: 1, price: AUTO_PARTS.switch.price, mass: AUTO_PARTS.switch.mass, auto: true });
    const fuseA = [2, 3, 5, 7.5, 10, 15, 20].find((a) => a >= Math.min(motor.stallA * motors * 0.6, battery.maxA) + 0.3) ?? 20;
    checks.push({ id: "fuse", level: "info", auto: true, title: `Added a ${fuseA} A fuse and a power switch`, detail: "A shorted wire on a lithium pack can start a fire; the fuse blows first.", slot: "battery" });
  }
  autoLines.push({ name: AUTO_PARTS.noiseCaps.name, qty: motors, price: AUTO_PARTS.noiseCaps.price, mass: 0, auto: true });
  checks.push({ id: "caps", level: "info", auto: true, title: "Added 100 nF noise capacitors across each motor", detail: "Brush noise otherwise resets the board and corrupts encoder counts." });
  if (battery.look === "lipo")
    checks.push({ id: "lipo", level: "info", title: "LiPo battery care", detail: `Never discharge below ${fmt((battery.vMin / (battery.cells ?? 1)) * 1.0, 1)} V per cell; the firmware reads the pack voltage and stops the motors.`, slot: "battery" });

  return { board, driver, battery, sensor, vAvail, checks, autoLines, levelShift, buck };
}

function finish(
  build: HardwareBuild,
  partLines: BomLine[],
  common: Pick<Common, "autoLines">,
  structureKg: number,
): { bom: BomLine[]; massKg: number; cost: number } {
  const bom = [...partLines, ...common.autoLines];
  const massKg = structureKg + bom.reduce((a, l) => a + (l.mass * l.qty) / 1000, 0);
  const cost = bom.reduce((a, l) => a + l.price * l.qty, 0);
  void build;
  return { bom, massKg, cost };
}

/**
 * Sensor/sampling latency as a first-order lag 1/(T s + 1): a rational stand-in for e^(−sT) that
 * keeps the closed-loop poles exact.
 */
function withLag(den: number[], T: number): number[] {
  const out = new Array(den.length + 1).fill(0);
  den.forEach((c, i) => {
    out[i] += c * T;
    out[i + 1] += c;
  });
  return out;
}

/** Sample-rate rule shared by all rigs: the slower of the board loop and the sensor sets latency. */
function latency(board: Board, sensor: Sensor) {
  const rate = Math.min(board.loopHz, sensor.rateHz);
  return { rate, delay: 1 / rate };
}

// ---------------------------------------------------------------------------
// Rover
// ---------------------------------------------------------------------------

function deriveRover(build: HardwareBuild): DerivedHardware {
  const gm = build.geom;
  const motor = find(GEARMOTORS, build.parts.motor);
  const c = electrical(build, motor, 2);
  const { board, driver, battery, sensor } = c;
  const dc = dcMotor(motor);
  const r = gm.wheelD / 2;
  const partLines: BomLine[] = [
    { name: motor.name, qty: 2, price: motor.price, mass: motor.mass, slot: "motor" },
    { name: driver.name, qty: 1, price: driver.price, mass: driver.mass, slot: "driver" },
    { name: battery.name, qty: 1, price: battery.price, mass: battery.mass, slot: "battery" },
    { name: board.name, qty: 1, price: board.price, mass: board.mass, slot: "board" },
    { name: sensor.name, qty: 2, price: sensor.price, mass: sensor.mass, slot: "sensor" },
    { name: HC_SR04.name, qty: 1, price: HC_SR04.price, mass: HC_SR04.mass },
  ];
  const { bom, massKg, cost } = finish(build, partLines, c, gm.chassisMass + gm.payload);
  const J = dc.Jr + (massKg / 2) * r * r;
  const bRoll = 0.015 * massKg * G * r * r * 0.5; // rolling resistance as viscous at cruise
  const b = dc.b + bRoll;
  const den = [J * dc.L, J * dc.R + b * dc.L, b * dc.R + dc.Kt * dc.Ke];
  const K = (r * dc.Kt) / den[2];
  const tauM = (J * dc.R) / (dc.Kt * dc.Ke + b * dc.R);
  const vTop = K * c.vAvail;
  const lat = latency(board, sensor);
  // Ramp: the extra uphill force on each wheel, as the motor voltage it costs.
  const slopeForce = massKg * G * Math.sin(gm.slope);
  const distV = -((slopeForce * r) / 2 / dc.Kt) * dc.R;
  const stallEff = dc.stallNm * Math.min(1.3, c.vAvail / motor.ratedV);
  const tractionN = 0.6 * massKg * G;
  const driveN = (2 * stallEff) / r;
  const contForce = (2 * stallEff * 0.35) / r;
  const needN = slopeForce + 0.015 * massKg * G;
  const tEnd = Math.min(8, Math.max(1.2, tauM * 14));
  const runtimeMin = battery.mAh > 0 ? ((battery.mAh / 1000) * 0.8 * 60) / (2 * (motor.noLoadA + (needN * r) / 2 / dc.Kt) + 0.15) : Infinity;
  const checks = [...c.checks];

  const target = gm.target;
  if (vTop < target * 1.1) {
    const fixMotor = cheapest(
      GEARMOTORS.filter((m) => m.look !== "pg45"),
      (m) => {
        const d = dcMotor(m);
        return ((r * d.Kt) / (d.b * d.R + d.Kt * d.Ke)) * c.vAvail >= target * 1.25 && c.vAvail <= m.vMax * 1.1;
      },
    );
    checks.push({
      id: "topspeed",
      level: vTop < target ? "error" : "warn",
      title: vTop < target ? `Can't reach ${fmt(target)} m/s: top speed is ${fmt(vTop)} m/s` : `Only ${Math.round((vTop / target - 1) * 100)}% speed headroom`,
      detail: `${motor.rpm} RPM motors on ${Math.round(gm.wheelD * 1000)} mm wheels at ${fmt(c.vAvail)} V. The controller will saturate and the integral term winds up.`,
      slot: "motor",
      callout: `max ${fmt(vTop)} m/s`,
      fix: fixMotor ? { label: `Use ${fixMotor.name}`, parts: { motor: fixMotor.id } } : { label: "Bigger wheels", geom: { wheelD: Math.min(0.15, gm.wheelD * (target * 1.3) / Math.max(vTop, 1e-3)) } },
    });
  } else {
    checks.push({ id: "topspeed", level: "pass", title: `Top speed ${fmt(vTop)} m/s covers the ${fmt(target)} m/s cruise`, detail: `${Math.round((vTop / target - 1) * 100)}% headroom for the controller.`, slot: "motor" });
  }
  if (needN > contForce) {
    checks.push({
      id: "slope",
      level: needN > driveN ? "error" : "warn",
      title: needN > driveN ? `Can't climb the ${fmt((gm.slope * 180) / Math.PI, 0)}° ramp` : `Ramp needs ${Math.round((needN / driveN) * 100)}% of stall torque`,
      detail: `Climbing needs ${fmt(needN)} N; the motors give ${fmt(driveN)} N at stall and about ${fmt(contForce)} N continuously.`,
      slot: "motor",
      callout: needN > driveN ? "stalls on ramp" : "hot on ramp",
      fix: { label: "Use JGB37-520 (10 kg·cm)", parts: { motor: "jgb37" } },
    });
  } else {
    checks.push({ id: "slope", level: "pass", title: `Climbs the ${fmt((gm.slope * 180) / Math.PI, 0)}° ramp at ${Math.round((needN / driveN) * 100)}% of stall torque`, detail: `${fmt(needN)} N needed of ${fmt(driveN)} N available.`, slot: "motor" });
  }
  checks.push(
    driveN > tractionN
      ? { id: "grip", level: "info", title: "Wheels can spin at full torque", detail: `Motors push ${fmt(driveN)} N but the tyres grip ${fmt(tractionN)} N on a hard floor; the firmware ramps the PWM to avoid wheelspin.` }
      : { id: "grip", level: "pass", title: "Tyres have enough grip", detail: `${fmt(tractionN)} N of grip for ${fmt(driveN)} N of drive.` },
  );
  // Does it physically fit? Parts sit in a row along the deck; motors face each other across it.
  const deckNeed = batteryDims(battery)[0] + boardDims(board)[0] + driverDims(driver)[0] + 4 * DECK_GAP;
  const motorNeed = 2 * motorDims(motor.look).len + 0.004;
  if (deckNeed > gm.chassisL)
    checks.push({
      id: "fit-deck",
      level: "error",
      title: `Parts don't fit on a ${Math.round(gm.chassisL * 1000)} mm deck`,
      detail: `Battery, board and driver need ${Math.round(deckNeed * 1000)} mm in a row.`,
      slot: "driver",
      callout: "doesn't fit",
      fix: { label: `Lengthen chassis to ${Math.ceil((deckNeed * 1000) / 5) * 5} mm`, geom: { chassisL: Math.ceil((deckNeed * 1000) / 5) * 0.005 } },
    });
  if (motorNeed > gm.chassisW)
    checks.push({
      id: "fit-motor",
      level: "error",
      title: `Motors collide inside a ${Math.round(gm.chassisW * 1000)} mm chassis`,
      detail: `Two ${motor.name} motors are ${Math.round(motorNeed * 1000)} mm end to end.`,
      slot: "motor",
      callout: "motors collide",
      fix: { label: `Widen chassis to ${Math.ceil((motorNeed * 1000) / 5) * 5} mm`, geom: { chassisW: Math.ceil((motorNeed * 1000) / 5) * 0.005 } },
    });
  if (deckNeed <= gm.chassisL && motorNeed <= gm.chassisW)
    checks.push({ id: "fit", level: "pass", title: "Everything fits on the chassis", detail: `${Math.round(deckNeed * 1000)} mm of ${Math.round(gm.chassisL * 1000)} mm deck used.` });
  checks.push({ id: "runtime", level: "info", title: `About ${Number.isFinite(runtimeMin) ? Math.round(runtimeMin) : "∞"} min of cruising`, detail: `${battery.mAh} mAh at 80% usable capacity.`, slot: "battery" });

  const model: LabModel = {
    title: "Differential-drive rover · speed loop",
    summary: `Two ${motor.name} motors turn ${Math.round(gm.wheelD * 1000)} mm wheels on a ${fmt(massKg)} kg rover. The ${driver.name} feeds them ${fmt(c.vAvail)} V from the ${battery.name}, and the ${board.name} closes the speed loop on ${sensor.name} counts. Halfway through the run it drives up a ${fmt((gm.slope * 180) / Math.PI, 0)}° ramp.`,
    domain: "electromechanical",
    input: { name: "Motor voltage", unit: "V" },
    output: { name: "Rover speed", unit: "m/s" },
    params: [
      p("R", `Armature resistance (${motor.ratedV} V / ${motor.stallA} A stall)`, r2(dc.R, 3), "Ω"),
      p("Kt", "Torque constant at the output shaft", r2(dc.Kt, 4), "N·m/A"),
      p("Ke", "Back-EMF constant at the output shaft", r2(dc.Ke, 4), "V·s/rad"),
      p("Jr", `Rotor inertia × gear ratio² (${motor.ratio}:1)`, dc.Jr, "kg·m²"),
      p("m", "Total mass (parts + chassis + payload)", r2(massKg, 3), "kg"),
      p("r", "Wheel radius", r, "m"),
      p("J", "Inertia per motor (Jr + m r²/2)", J, "kg·m²"),
      p("V", "Voltage at the motors", r2(c.vAvail), "V"),
    ],
    equations: ["L di/dt = V − R i − Ke ω", "J dω/dt = Kt i − b ω − τ_ramp", "v = ω r", "τ_ramp = m g sin(slope) · r / 2"],
    assumptions: ["Both wheels get the same voltage (driving straight).", "Wheels roll without slipping.", "Motor constants derived from the datasheet's stall and no-load points."],
    plant: { kind: "tf", num: [r * dc.Kt], den: withLag(den, lat.delay / 2) },
    // A deliberately gentle first guess (crossover ≈ 0.6/τ): it works, but sags on the ramp.
    controller: { type: "pid", kp: r2(0.6 / K, 2), ki: r2(0.6 / K / tauM, 1), kd: 0, N: 100 },
    controllerRationale: "PI control fits a speed loop: the integral term removes the error the ramp causes, and the motor is fast enough that derivative action only amplifies encoder noise.",
    specs: { maxOvershootPct: 10, maxSettlingTime: r2(tEnd * 0.3, 2), maxSsErrorPct: 2, uMin: -c.vAvail, uMax: c.vAvail },
    sim: { tEnd: r2(tEnd, 2), ref: target, disturbance: gm.slope > 0 ? { time: r2(tEnd * 0.6, 2), magnitude: distV } : undefined, noiseStd: sensor.noise * Math.max(0.2, target) },
    source: "offline",
    presetId: "rover",
    rig: { kind: "rover", signal: "speed" },
    drive: { R: dc.R, Ke: dc.Ke, wPerY: 1 / r, mode: "y", limitA: driver.contA, holdA: 0 },
  };

  return {
    build,
    model,
    board,
    driver,
    battery,
    sensor,
    motor,
    dc,
    vAvail: c.vAvail,
    massKg,
    cost,
    bom,
    checks: sortChecks(checks),
    stats: [
      { label: "Parts cost", value: `$${cost.toFixed(2)}`, sub: `${bom.length} line items` },
      { label: "Total mass", value: `${Math.round(massKg * 1000)} g`, sub: `payload ${Math.round(gm.payload * 1000)} g` },
      { label: "Top speed", value: `${fmt(vTop)} m/s`, sub: `cruise ${fmt(target)} m/s`, tone: vTop < target ? "bad" : vTop < target * 1.1 ? "warn" : "ok" },
      { label: "Runtime", value: Number.isFinite(runtimeMin) ? `${Math.round(runtimeMin)} min` : "mains", sub: "continuous cruising" },
    ],
    wiring: dcWiring(build, c, motor, 2, "rover"),
    facts: { r, vTop, massKg, tauM, distV, slope: gm.slope, rampAt: model.sim.disturbance?.time ?? -1 },
  };
}

// ---------------------------------------------------------------------------
// Arm
// ---------------------------------------------------------------------------

export const ARM_START = (25 * Math.PI) / 180; // pick pose: upper arm 25° above horizontal
export const ARM_GRIP = 0.03; // gripper length beyond the forearm
export const ARM_ELBOW = (-80 * Math.PI) / 180; // forearm angle relative to the upper arm

/** Edge length of the payload cube (m) for a mass, packed at about 2.5 g/cm³ (a box of bolts). */
export const payloadSize = (kg: number) => Math.max(0.018, Math.cbrt(Math.max(kg, 1e-4) / 2500));

/** Horizontal lever arms (m) of each mass about the shoulder for a shoulder angle θ. */
export function armLevers(gm: Record<string, number>, th: number) {
  const L1 = gm.upper,
    L2 = gm.fore;
  const e = L1 * Math.cos(th);
  return { upper: (L1 / 2) * Math.cos(th), elbow: e, fore: e + (L2 / 2) * Math.cos(th + ARM_ELBOW), tip: e + L2 * Math.cos(th + ARM_ELBOW) };
}

function deriveArm(build: HardwareBuild): DerivedHardware {
  const gm = build.geom;
  const motor = find(GEARMOTORS, build.parts.motor);
  const c = electrical(build, motor, 1);
  const { board, driver, battery, sensor } = c;
  const dc = dcMotor(motor);
  const elbowServo = 0.055; // MG996R holding the elbow
  const gripper = 0.03;
  const partLines: BomLine[] = [
    { name: motor.name, qty: 1, price: motor.price, mass: motor.mass, slot: "motor" },
    { name: "MG996R servo (elbow, held)", qty: 1, price: 9, mass: 55 },
    { name: "SG90 gripper servo + jaws", qty: 1, price: 5, mass: 30 },
    { name: driver.name, qty: 1, price: driver.price, mass: driver.mass, slot: "driver" },
    { name: battery.name, qty: 1, price: battery.price, mass: battery.mass, slot: "battery" },
    { name: board.name, qty: 1, price: board.price, mass: board.mass, slot: "board" },
    { name: sensor.name, qty: 1, price: sensor.price, mass: sensor.mass, slot: "sensor" },
    { name: "Turntable bearing + base plate", qty: 1, price: 8, mass: 0 },
  ];
  const baseMass = 0.35;
  const { bom, cost } = finish(build, partLines, c, gm.upperMass + gm.foreMass + gm.payload + baseMass);
  const massKg = bom.reduce((a, l) => a + (l.mass * l.qty) / 1000, 0) + gm.upperMass + gm.foreMass + gm.payload + baseMass;
  const L1 = gm.upper,
    L2 = gm.fore;
  const thEnd = ARM_START + gm.target;
  // Inertia about the shoulder at the mid-swing pose (point masses + slender rods).
  const thMid = ARM_START + gm.target / 2;
  const dist = (th: number) => {
    const ex = L1 * Math.cos(th),
      ey = L1 * Math.sin(th);
    const tx = ex + L2 * Math.cos(th + ARM_ELBOW),
      ty = ey + L2 * Math.sin(th + ARM_ELBOW);
    const fx = ex + (L2 / 2) * Math.cos(th + ARM_ELBOW),
      fy = ey + (L2 / 2) * Math.sin(th + ARM_ELBOW);
    return { elbow2: ex * ex + ey * ey, tip2: tx * tx + ty * ty, fore2: fx * fx + fy * fy };
  };
  const d = dist(thMid);
  const Jarm = (gm.upperMass * L1 * L1) / 3 + elbowServo * d.elbow2 + gm.foreMass * (d.fore2 + (L2 * L2) / 12) + (gm.payload + gripper) * d.tip2;
  const J = dc.Jr + Jarm;
  const torqueAt = (th: number, payload: number) => {
    const lv = armLevers(gm, th);
    return G * (gm.upperMass * lv.upper + elbowServo * lv.elbow + gm.foreMass * lv.fore + (gripper + payload) * lv.tip);
  };
  let tHold = 0,
    tHoldNoLoad = 0,
    tipMax = 0;
  for (let i = 0; i <= 40; i++) {
    const th = ARM_START + (gm.target * i) / 40;
    tHold = Math.max(tHold, Math.abs(torqueAt(th, gm.payload)));
    tHoldNoLoad = Math.max(tHoldNoLoad, Math.abs(torqueAt(th, 0)));
    tipMax = Math.max(tipMax, armLevers(gm, th).tip);
  }
  const stallEff = dc.stallNm * Math.min(1.3, c.vAvail / motor.ratedV);
  const ratio = tHold / stallEff;
  const maxPayload = Math.max(0, (0.8 * stallEff - tHoldNoLoad) / (G * Math.max(tipMax, 1e-3)));
  const reach = L1 + L2;
  const plantDen = [J * dc.L, J * dc.R + dc.b * dc.L, dc.b * dc.R + dc.Kt * dc.Ke, 0];
  const tauM = (J * dc.R) / (dc.Kt * dc.Ke + dc.b * dc.R);
  const Ktheta = dc.Kt / (dc.b * dc.R + dc.Kt * dc.Ke);
  const wTop = dc.wNl * (c.vAvail / motor.ratedV);
  const lat = latency(board, sensor);
  // Releasing the payload at the place pose: the gravity feed-forward still lifts it, so the arm kicks up.
  const releaseTorque = G * gm.payload * armLevers(gm, thEnd).tip;
  const distV = (releaseTorque / dc.Kt) * dc.R;
  const tEnd = Math.min(6, Math.max(1.2, (gm.target / Math.max(wTop * 0.6, 1e-3)) * 3 + tauM * 10));
  const checks = [...c.checks];

  if (ratio > 0.9) {
    const fix = cheapest(GEARMOTORS, (m) => dcMotor(m).stallNm * Math.min(1.3, c.vAvail / m.ratedV) * 0.5 >= tHold && c.vAvail <= m.vMax * 1.1);
    checks.push({
      id: "hold",
      level: "error",
      title: `Shoulder can't hold the arm: needs ${fmt(tHold / KGCM, 1)} kg·cm of ${fmt(stallEff / KGCM, 1)}`,
      detail: `Worst-case gravity torque with the payload is ${Math.round(ratio * 100)}% of stall. The arm will sag and the motor will burn out holding it.`,
      slot: "motor",
      callout: `${Math.round(ratio * 100)}% of stall`,
      fix: fix ? { label: `Use ${fix.name}`, parts: { motor: fix.id } } : undefined,
    });
  } else if (ratio > 0.5) {
    const fix = cheapest(GEARMOTORS, (m) => dcMotor(m).stallNm * Math.min(1.3, c.vAvail / m.ratedV) * 0.5 >= tHold && c.vAvail <= m.vMax * 1.1);
    checks.push({
      id: "hold",
      level: "warn",
      title: `Shoulder holds at ${Math.round(ratio * 100)}% of stall torque`,
      detail: `Holding ${fmt(tHold / KGCM, 1)} kg·cm continuously above half of stall overheats a brushed gearmotor. Keep it under 50%.`,
      slot: "motor",
      callout: `${Math.round(ratio * 100)}% of stall`,
      fix: fix ? { label: `Use ${fix.name}`, parts: { motor: fix.id } } : undefined,
    });
  } else {
    checks.push({ id: "hold", level: "pass", title: `Shoulder holds at ${Math.round(ratio * 100)}% of stall torque`, detail: `${fmt(tHold / KGCM, 1)} kg·cm worst case of ${fmt(stallEff / KGCM, 1)} kg·cm available.`, slot: "motor" });
  }
  checks.push({
    id: "payload",
    level: maxPayload < gm.payload ? "error" : "pass",
    title: `Can lift up to ≈${Math.round(maxPayload * 1000)} g with this motor`,
    detail: `At 80% of stall torque over the whole swing. Design payload ${Math.round(gm.payload * 1000)} g.`,
    slot: "motor",
  });
  // Tip-over: whole-machine centre of mass must stay inside the base footprint.
  const armMass = gm.upperMass + elbowServo + gm.foreMass + gripper + gm.payload;
  const lv = armLevers(gm, ARM_START);
  const armMoment = gm.upperMass * lv.upper + elbowServo * lv.elbow + gm.foreMass * lv.fore + (gripper + gm.payload) * lv.tip;
  const baseTotal = baseMass + motor.mass / 1000 + (battery.kind === "battery" ? battery.mass / 1000 : 0) + board.mass / 1000 + driver.mass / 1000;
  const comX = armMoment / (armMass + baseTotal);
  const tipRatio = comX / gm.baseR;
  checks.push(
    tipRatio > 0.9
      ? {
          id: "tip",
          level: "error",
          title: "Tips over at full reach",
          detail: `The centre of mass sits ${Math.round(comX * 1000)} mm out, past ${Math.round(gm.baseR * 900)} mm of usable footprint. Widen the base or add ${Math.round(((armMoment / (gm.baseR * 0.7) - armMass - baseTotal) * 1000) / 10) * 10} g of ballast.`,
          fix: { label: "Widen the base", geom: { baseR: Math.min(0.15, comX / 0.6) } },
          callout: "tips over",
        }
      : { id: "tip", level: tipRatio > 0.7 ? "warn" : "pass", title: tipRatio > 0.7 ? "Close to tipping at full reach" : "Won't tip over at full reach", detail: `Centre of mass ${Math.round(comX * 1000)} mm from the axis, base radius ${Math.round(gm.baseR * 1000)} mm.` },
  );
  const holdA = tHold / dc.Kt;
  if (holdA > driver.contA)
    checks.push({
      id: "hold-amps",
      level: "error",
      title: `Holding current ${fmt(holdA)} A exceeds the driver's ${driver.contA} A`,
      detail: `The ${driver.name} carries the holding current continuously.`,
      slot: "driver",
      callout: `${fmt(holdA)} A hold`,
      fix: { label: "Use Cytron MDD10A", parts: { driver: "mdd10a" } },
    });
  const quant = sensor.noise;
  checks.push({
    id: "resolution",
    level: quant * 3 > (gm.target * 1) / 100 ? "warn" : "pass",
    title: `${sensor.name}: ±${fmt((quant * 180) / Math.PI, 2)}° noise`,
    detail: `The 1% steady-state spec needs angle readings finer than ${fmt((gm.target * 180) / Math.PI / 100, 2)}°.`,
    slot: "sensor",
  });
  // The gripper must clear the table at the pick pose.
  const tipY = gm.shoulderH + L1 * Math.sin(ARM_START) + (L2 + ARM_GRIP) * Math.sin(ARM_START + ARM_ELBOW);
  const boxS = payloadSize(gm.payload);
  if (tipY < boxS * 0.5)
    checks.push({
      id: "clearance",
      level: "error",
      title: "Gripper hits the table at the pick pose",
      detail: `The jaws reach ${Math.round(tipY * 1000)} mm, below the ${Math.round(boxS * 500)} mm grip height. Raise the shoulder or shorten the forearm.`,
      callout: "hits table",
      fix: { label: "Raise the shoulder", geom: { shoulderH: Math.min(0.2, gm.shoulderH + boxS * 0.5 - tipY + 0.01) } },
    });
  checks.push({ id: "gravity", level: "info", title: "Firmware adds gravity feed-forward", detail: "A cos θ term cancels the arm's weight, so the PID loop only handles motion and payload changes." });

  const model: LabModel = {
    title: "3-axis robot arm · shoulder joint",
    summary: `A ${motor.name} drives the shoulder of a ${Math.round(reach * 1000)} mm-reach arm carrying a ${Math.round(gm.payload * 1000)} g payload. The ${board.name} reads the ${sensor.name} and drives the motor through the ${driver.name} at ${fmt(c.vAvail)} V. It lifts the part ${fmt((gm.target * 180) / Math.PI, 0)}° from the pick pose and releases it at the place pose.`,
    domain: "electromechanical",
    input: { name: "Motor voltage", unit: "V" },
    output: { name: "Shoulder lift", unit: "rad" },
    params: [
      p("R", "Armature resistance", r2(dc.R, 3), "Ω"),
      p("Kt", "Torque constant at the output", r2(dc.Kt, 4), "N·m/A"),
      p("Ke", "Back-EMF constant at the output", r2(dc.Ke, 4), "V·s/rad"),
      p("Jr", `Rotor inertia × ${motor.ratio}²`, dc.Jr, "kg·m²"),
      p("Ja", "Arm + payload inertia about the shoulder", Jarm, "kg·m²"),
      p("τg", "Worst-case holding torque", r2(tHold, 4), "N·m"),
      p("V", "Voltage at the motor", r2(c.vAvail), "V"),
    ],
    equations: ["L di/dt = V − R i − Ke ω", "(Jr + Ja) dω/dt = Kt i − b ω − τ_payload", "dθ/dt = ω", "V_ff = (R/Kt) · τg cos θ (gravity feed-forward)"],
    assumptions: ["Gravity is cancelled by feed-forward; the loop sees payload changes.", "Elbow and base servos follow the shoulder's normalised profile.", "Inertia taken at the mid-swing pose."],
    plant: { kind: "tf", num: [dc.Kt], den: withLag(plantDen, lat.delay / 2) },
    // First guess: a stiff P term with too little damping, so the payload swings past the shelf.
    controller: { type: "pid", kp: r2(2.4 / (Ktheta * tauM), 2), ki: 0, kd: r2(0.04 * (2.4 / (Ktheta * tauM)) * tauM, 3), N: 150 },
    controllerRationale: "PD control: the joint already integrates speed into angle, so proportional action reaches the target; derivative action damps the swing so the payload doesn't overshoot the shelf.",
    specs: { maxOvershootPct: 5, maxSettlingTime: r2(tEnd * 0.45, 2), maxSsErrorPct: 1, uMin: -c.vAvail, uMax: c.vAvail },
    sim: { tEnd: r2(tEnd, 2), ref: gm.target, disturbance: gm.payload > 0 ? { time: r2(tEnd * 0.7, 2), magnitude: distV } : undefined, noiseStd: sensor.noise },
    source: "offline",
    presetId: "arm",
    rig: { kind: "arm", signal: "angle" },
    drive: { R: dc.R, Ke: dc.Ke, wPerY: 1, mode: "dy", limitA: driver.contA, holdA: (tHold / dc.Kt) * 0.6 },
  };
  return {
    build,
    model,
    board,
    driver,
    battery,
    sensor,
    motor,
    dc,
    vAvail: c.vAvail,
    massKg,
    cost,
    bom,
    checks: sortChecks(checks),
    stats: [
      { label: "Parts cost", value: `$${cost.toFixed(2)}`, sub: `${bom.length} line items` },
      { label: "Total mass", value: `${Math.round(massKg * 1000)} g`, sub: "arm, base and electronics" },
      { label: "Max payload", value: `${Math.round(maxPayload * 1000)} g`, sub: `design: ${Math.round(gm.payload * 1000)} g`, tone: maxPayload < gm.payload ? "bad" : maxPayload < gm.payload * 1.5 ? "warn" : "ok" },
      { label: "Reach", value: `${Math.round(reach * 1000)} mm`, sub: "from the shoulder axis" },
    ],
    wiring: dcWiring(build, c, motor, 1, "arm"),
    facts: { tHold, stallEff, holdRatio: ratio, maxPayload, reach, distV, releaseAt: model.sim.disturbance?.time ?? -1, comX },
  };
}

// ---------------------------------------------------------------------------
// Self-balancing robot
// ---------------------------------------------------------------------------

function deriveBalancer(build: HardwareBuild): DerivedHardware {
  const gm = build.geom;
  const motor = find(GEARMOTORS, build.parts.motor);
  const c = electrical(build, motor, 2);
  const { board, driver, battery, sensor } = c;
  const dc = dcMotor(motor);
  const r = gm.wheelD / 2;
  const wheelMass = 0.04;
  const partLines: BomLine[] = [
    { name: motor.name, qty: 2, price: motor.price, mass: motor.mass, slot: "motor" },
    { name: `${Math.round(gm.wheelD * 1000)} mm wheels`, qty: 2, price: 4, mass: wheelMass * 1000 },
    { name: driver.name, qty: 1, price: driver.price, mass: driver.mass, slot: "driver" },
    { name: battery.name, qty: 1, price: battery.price, mass: battery.mass, slot: "battery" },
    { name: board.name, qty: 1, price: board.price, mass: board.mass, slot: "board" },
    { name: sensor.name, qty: 1, price: sensor.price, mass: sensor.mass, slot: "sensor" },
  ];
  const { bom, massKg, cost } = finish(build, partLines, c, gm.frameMass + gm.payload);
  const M = (2 * motor.mass) / 1000 + 2 * wheelMass + (2 * dc.Jr) / (r * r);
  const m = massKg - (2 * motor.mass) / 1000 - 2 * wheelMass;
  const l = gm.comH;
  const I = (m * l * l) / 3;
  const q = I * (M + m) + M * m * l * l;
  // Motor force at the wheels: F = a·V − c·ẋ (torque constant and back-EMF of both motors).
  const a = (2 * dc.Kt) / (dc.R * r);
  const cEmf = (2 * dc.Kt * dc.Ke) / (dc.R * r * r);
  const bTot = 0.05 + cEmf;
  const A = [
    [0, 1, 0, 0],
    [0, (-(I + m * l * l) * bTot) / q, (m * m * G * l * l) / q, 0],
    [0, 0, 0, 1],
    [0, (-m * l * bTot) / q, (m * G * l * (M + m)) / q, 0],
  ];
  const B = [0, (a * (I + m * l * l)) / q, 0, (a * m * l) / q];
  const stallEff = dc.stallNm * Math.min(1.3, c.vAvail / motor.ratedV);
  const Fmax = (2 * stallEff) / r;
  const maxLean = (Math.atan(Fmax / ((M + m) * G)) * 180) / Math.PI;
  const tFall = Math.sqrt((I + m * l * l) / (m * G * l));
  const vTop = dc.wNl * (c.vAvail / motor.ratedV) * r;
  const runtimeMin = ((battery.mAh / 1000) * 0.8 * 60) / (2 * motor.noLoadA * 2.5 + 0.1);
  const checks = [...c.checks];

  checks.push(
    maxLean < 6
      ? {
          id: "lean",
          level: "error",
          title: `Motors can only catch a ${fmt(maxLean, 1)}° lean`,
          detail: `The wheels push at most ${fmt(Fmax)} N; recovering from a small bump needs more. The robot will fall over.`,
          slot: "motor",
          callout: `max ${fmt(maxLean, 1)}°`,
          fix: { label: "Use JGB37-520 (10 kg·cm)", parts: { motor: "jgb37" } },
        }
      : maxLean < 15
        ? { id: "lean", level: "warn", title: `Recovers from leans up to ${fmt(maxLean, 1)}°`, detail: `${fmt(Fmax)} N of wheel force. Aim for 15° or more to survive pushes.`, slot: "motor", callout: `max ${fmt(maxLean, 1)}°` }
        : { id: "lean", level: "pass", title: `Recovers from leans up to ${fmt(maxLean, 1)}°`, detail: `${fmt(Fmax)} N of wheel force at stall.`, slot: "motor" },
  );
  checks.push(
    vTop < 0.4
      ? { id: "wheelspeed", level: "warn", title: `Wheel top speed only ${fmt(vTop)} m/s`, detail: "To catch a fall the base must drive under the body quickly; slow motors saturate.", slot: "motor", callout: `${fmt(vTop)} m/s` }
      : { id: "wheelspeed", level: "pass", title: `Wheels reach ${fmt(vTop)} m/s to catch a fall`, detail: `${motor.rpm} RPM on ${Math.round(gm.wheelD * 1000)} mm wheels at ${fmt(c.vAvail)} V.`, slot: "motor" },
  );
  if (motor.ratio > 60)
    checks.push({ id: "backlash", level: "warn", title: `${motor.ratio}:1 gearbox backlash makes balancing jittery`, detail: "High-ratio spur gearboxes have play. Balancing robots work best below about 50:1.", slot: "motor" });
  const needHz = 25 / tFall;
  checks.push(
    sensor.rateHz < needHz
      ? { id: "imu-rate", level: "warn", title: `${sensor.name} updates at ${sensor.rateHz} Hz; the body falls in ${fmt(tFall * 1000, 0)} ms`, detail: `Needs about ${Math.round(needHz)} Hz to react in time.`, slot: "sensor", callout: `${sensor.rateHz} Hz` }
      : { id: "imu-rate", level: "pass", title: `${sensor.name} at ${sensor.rateHz} Hz is fast enough`, detail: `Fall time constant ${fmt(tFall * 1000, 0)} ms; needs ≥ ${Math.round(needHz)} Hz.`, slot: "sensor" },
  );
  checks.push({ id: "height", level: "info", title: `Fall time constant ${fmt(tFall * 1000, 0)} ms`, detail: "Raising the centre of mass slows the fall and makes balancing easier, like balancing a broom versus a pencil." });
  checks.push({ id: "runtime", level: "info", title: `About ${Math.round(runtimeMin)} min of balancing`, detail: `${battery.mAh} mAh at 80% usable capacity.`, slot: "battery" });

  const model: LabModel = {
    title: "Two-wheeled self-balancing robot",
    summary: `An inverted pendulum on two ${motor.name} motors with ${Math.round(gm.wheelD * 1000)} mm wheels. The body (${fmt(m)} kg, centre of mass ${Math.round(l * 1000)} mm above the axle) falls over on its own; the ${board.name} reads the ${sensor.name} and drives the wheels through the ${driver.name} to keep it upright while driving ${fmt(gm.target)} m.`,
    domain: "mechanical",
    input: { name: "Motor voltage", unit: "V" },
    output: { name: "Base position", unit: "m" },
    params: [
      p("M", "Wheel base mass (+ reflected rotor inertia)", r2(M, 3), "kg"),
      p("m", "Body mass (frame + battery + electronics)", r2(m, 3), "kg"),
      p("l", "Centre-of-mass height", l, "m"),
      p("r", "Wheel radius", r, "m"),
      p("a", "Force per volt (2 Kt / R r)", r2(a, 3), "N/V"),
      p("c", "Back-EMF damping (2 Kt Ke / R r²)", r2(cEmf, 3), "N·s/m"),
      p("I", "Body inertia about its centre (m l²/3)", I, "kg·m²"),
    ],
    equations: ["(M + m) ẍ + (b + c) ẋ + m l θ̈ = a V", "(I + m l²) θ̈ − m g l θ = −m l ẍ", "Linearised about upright: sin θ ≈ θ, cos θ ≈ 1"],
    assumptions: ["Small tilt angles (linearised about upright).", "Both wheels move together (no turning).", "Motor back-EMF acts as viscous damping on the base."],
    plant: {
      kind: "ss",
      stateNames: ["x", "ẋ", "θ", "θ̇"],
      A,
      B,
      C: [1, 0, 0, 0],
    },
    controller: { type: "lqr", Q: [40, 0, 400, 0], R: 4 },
    controllerRationale:
      "The robot is open-loop unstable and has two things to control (tilt and position) with one input. Full state feedback with LQR weights handles both: a large weight on tilt keeps it upright, a smaller one on position drives it to the target.",
    specs: { maxOvershootPct: 15, maxSettlingTime: 3, maxSsErrorPct: 2, uMin: -c.vAvail, uMax: c.vAvail },
    sim: { tEnd: 8, ref: gm.target, noiseStd: sensor.noise * 0.5 },
    source: "offline",
    presetId: "balancer",
    rig: { kind: "balancer", signal: "position" },
    drive: { R: dc.R, Ke: dc.Ke, wPerY: 1 / r, mode: "dy", limitA: driver.contA, holdA: 0 },
  };
  return {
    build,
    model,
    board,
    driver,
    battery,
    sensor,
    motor,
    dc,
    vAvail: c.vAvail,
    massKg,
    cost,
    bom,
    checks: sortChecks(checks),
    stats: [
      { label: "Parts cost", value: `$${cost.toFixed(2)}`, sub: `${bom.length} line items` },
      { label: "Total mass", value: `${Math.round(massKg * 1000)} g`, sub: `body ${Math.round(m * 1000)} g` },
      { label: "Max lean caught", value: `${fmt(maxLean, 1)}°`, sub: `${fmt(Fmax)} N wheel force`, tone: maxLean < 6 ? "bad" : maxLean < 15 ? "warn" : "ok" },
      { label: "Runtime", value: `${Math.round(runtimeMin)} min`, sub: "balancing in place" },
    ],
    wiring: dcWiring(build, c, motor, 2, "balancer"),
    facts: { r, a, cEmf, M, m, l, maxLean, tFall, vTop },
  };
}

// ---------------------------------------------------------------------------
// Quadcopter
// ---------------------------------------------------------------------------

function deriveDrone(build: HardwareBuild): DerivedHardware {
  const gm = build.geom;
  const motor = find(DRONE_MOTORS, build.parts.motor);
  const prop = find(PROPS, build.parts.prop);
  const esc = find(ESCS, build.parts.driver);
  const battery = find(DRONE_BATTERIES, build.parts.battery);
  const board = find(FLIGHT_CONTROLLERS, build.parts.board);
  const sensor = find(ALTIMETERS, build.parts.sensor);
  const th = droneThrust(motor, prop, battery);
  const cells = battery.cells ?? 3;
  const checks: DesignCheck[] = [];
  const autoLines: BomLine[] = [];
  const partLines: BomLine[] = [
    { name: motor.name, qty: 4, price: motor.price, mass: motor.mass, slot: "motor" },
    { name: prop.name, qty: 1, price: prop.price, mass: prop.mass, slot: "prop" },
    { name: `${prop.inch}" class frame`, qty: 1, price: 25, mass: prop.frameG, slot: "prop" },
    { name: esc.name, qty: 1, price: esc.price, mass: esc.mass, slot: "driver" },
    { name: battery.name, qty: 1, price: battery.price, mass: battery.mass, slot: "battery" },
    { name: board.name, qty: 1, price: board.price, mass: board.mass, slot: "board" },
    { name: sensor.name, qty: 1, price: sensor.price, mass: sensor.mass, slot: "sensor" },
  ];
  autoLines.push({ name: "XT60 lead + 1000 µF low-ESR capacitor", qty: 1, price: 2, mass: 6, auto: true });
  if (board.logicV < 4 && sensor.outV > 3.6) autoLines.push({ name: AUTO_PARTS.levelShifter.name, qty: 1, price: AUTO_PARTS.levelShifter.price, mass: 2, auto: true });
  const { bom, massKg, cost } = finish(build, partLines, { autoLines }, gm.payload);
  const weight = massKg * G;
  const thrustTotal = 4 * th.thrustN;
  const twr = thrustTotal / weight;
  const hoverFrac = weight / thrustTotal;
  const hoverA = 4 * th.maxA * Math.pow(Math.min(1, hoverFrac), 1.5);
  const flightMin = ((battery.mAh / 1000) * 0.8 * 60) / Math.max(hoverA, 0.1);
  const tm = 0.02 + 0.008 * prop.inch;
  const cDrag = 0.15 + 0.05 * prop.inch;
  const lat = latency(board, sensor);

  checks.push(
    twr < 1.2
      ? {
          id: "twr",
          level: "error",
          title: `Can't take off: thrust-to-weight ${fmt(twr)}`,
          detail: `${fmt(thrustTotal / G, 2)} kg of thrust for ${fmt(massKg, 2)} kg. Needs at least 2:1 to climb and stay controllable.`,
          slot: "motor",
          callout: `T/W ${fmt(twr)}`,
          fix: { label: "Use 2806.5 + 7\" props on 6S", parts: { motor: "2806", prop: "p7", battery: "d6s1100", driver: "esc35" } },
        }
      : twr < 2
        ? { id: "twr", level: "warn", title: `Thrust-to-weight only ${fmt(twr)}`, detail: "Below 2:1 the drone hovers above 50% throttle and has little authority left for gusts.", slot: "motor", callout: `T/W ${fmt(twr)}` }
        : { id: "twr", level: "pass", title: `Thrust-to-weight ${fmt(twr)}:1`, detail: `${fmt(thrustTotal / G, 2)} kg of thrust for ${fmt(massKg, 2)} kg all-up weight.`, slot: "motor" },
  );
  checks.push({
    id: "hover",
    level: hoverFrac > 0.7 ? "warn" : "pass",
    title: `Hovers at ${Math.round(Math.min(1, hoverFrac) * 100)}% throttle`,
    detail: `${fmt(hoverA, 1)} A total at hover.`,
  });
  if (th.maxA > esc.contA) {
    const fix = cheapest(ESCS, (e) => e.contA >= th.maxA * 1.1 && cells >= (e.cellsMin ?? 1) && cells <= (e.cellsMax ?? 6));
    checks.push({
      id: "esc-amps",
      level: "error",
      title: `Motors pull ${fmt(th.maxA, 1)} A; the ESC is rated ${esc.contA} A`,
      detail: `At full throttle the ${esc.name} will overheat and desync, and the drone drops out of the sky.`,
      slot: "driver",
      callout: `${fmt(th.maxA, 1)} A > ${esc.contA} A`,
      fix: fix ? { label: `Use ${fix.name}`, parts: { driver: fix.id } } : undefined,
    });
  } else checks.push({ id: "esc-amps", level: "pass", title: `ESC handles ${fmt(th.maxA, 1)} A per motor`, detail: `${esc.contA} A continuous rating.`, slot: "driver" });
  if (cells < (esc.cellsMin ?? 1) || cells > (esc.cellsMax ?? 6)) {
    const fix = cheapest(ESCS, (e) => cells >= (e.cellsMin ?? 1) && cells <= (e.cellsMax ?? 6) && e.contA >= th.maxA);
    checks.push({
      id: "esc-cells",
      level: "error",
      title: `${cells}S battery is outside the ESC's ${esc.cellsMin}–${esc.cellsMax}S range`,
      detail: cells > (esc.cellsMax ?? 6) ? "Over-voltage destroys the ESC's MOSFETs on the first punch-out." : "The ESC won't arm below its minimum voltage.",
      slot: "driver",
      callout: `${cells}S ≠ ${esc.cellsMin}–${esc.cellsMax}S`,
      fix: fix ? { label: `Use ${fix.name}`, parts: { driver: fix.id } } : undefined,
    });
  }
  if (cells > motor.cells)
    checks.push({
      id: "overspeed",
      level: "warn",
      title: `${motor.kv} KV motors over-volted on ${cells}S`,
      detail: `Rated for ${motor.cells}S. They'll spin ${Math.round((cells / motor.cells) * 100)}% faster and draw ${fmt(th.maxA, 1)} A; expect hot motors and short flights.`,
      slot: "motor",
      callout: `${cells}S on ${motor.cells}S motor`,
    });
  if (th.pf > 1.15)
    checks.push({
      id: "prop-big",
      level: "warn",
      title: `${prop.inch}" props are too big for ${motor.stator} motors`,
      detail: `These motors are matched to ${motor.propIn}" props. Bigger props overload them (current × ${fmt(Math.pow(th.pf, 2.4), 1)}).`,
      slot: "prop",
      fix: { label: `Use ${motor.propIn}" props`, parts: { prop: PROPS.find((x) => x.inch === motor.propIn)?.id ?? prop.id } },
    });
  else if (th.pf < 0.8)
    checks.push({ id: "prop-small", level: "info", title: `${prop.inch}" props under-load these motors`, detail: `They're matched to ${motor.propIn}" props; you lose ${Math.round((1 - Math.pow(th.pf, 1.6)) * 100)}% thrust.`, slot: "prop" });
  const peakA = 4 * th.maxA;
  checks.push(
    peakA > battery.maxA
      ? { id: "c-rating", level: "warn", title: `Battery can deliver ${battery.maxA} A; full throttle needs ${fmt(peakA, 0)} A`, detail: "The voltage sags hard and the pack puffs. Use a higher C-rating pack.", slot: "battery", callout: `${fmt(peakA, 0)} A > ${battery.maxA} A` }
      : { id: "c-rating", level: "pass", title: `Battery supplies the ${fmt(peakA, 0)} A full-throttle draw`, detail: `${battery.maxA} A rating.`, slot: "battery" },
  );
  if (sensor.rangeMax !== undefined && gm.target + 0.2 > sensor.rangeMax)
    checks.push({
      id: "alt-range",
      level: "error",
      title: `${sensor.name} can't see ${fmt(gm.target, 1)} m`,
      detail: `Its range ends at ${sensor.rangeMax} m. Above that the altitude reading is garbage.`,
      slot: "sensor",
      callout: `range ${sensor.rangeMax} m`,
      fix: { label: "Use BMP388 barometer", parts: { sensor: "bmp388" } },
    });
  checks.push(
    sensor.noise > 0.05
      ? { id: "alt-noise", level: "warn", title: `${sensor.name} reads ±${Math.round(sensor.noise * 100)} cm`, detail: "Derivative action amplifies the noise; the motors will twitch. Filter the derivative or fuse with a ToF sensor.", slot: "sensor" }
      : { id: "alt-noise", level: "pass", title: `${sensor.name}: ±${fmt(sensor.noise * 100, 1)} cm at ${sensor.rateHz} Hz`, detail: `Latency about ${fmt(1000 / sensor.rateHz, 0)} ms.`, slot: "sensor" },
  );
  if (board.logicV < 4 && sensor.outV > 3.6)
    checks.push({ id: "level", level: "info", auto: true, title: "Added a level shifter for the 5 V echo pin", detail: `The ${board.name} is a 3.3 V part.`, slot: "board" });
  checks.push({ id: "flight", level: "info", title: `About ${fmt(flightMin, 1)} min of hover`, detail: `${battery.mAh} mAh, 80% usable, ${fmt(hoverA, 1)} A at hover.`, slot: "battery" });
  checks.push({ id: "lipo", level: "info", title: "LiPo battery care", detail: "Land at 3.5 V per cell; the flight controller's voltage alarm is configured for it.", slot: "battery" });

  const uMax = Math.max(0.05, thrustTotal - weight);
  const model: LabModel = {
    title: "Quadcopter altitude hold",
    summary: `A ${fmt(massKg, 2)} kg quadcopter on four ${motor.name} motors with ${prop.inch}" props and a ${battery.name}. Thrust changes reach the airframe after a ${Math.round(tm * 1000)} ms motor/prop lag; the ${board.name} closes the loop on the ${sensor.name} and climbs ${fmt(gm.target, 1)} m.`,
    domain: "aerospace",
    input: { name: "Thrust change from hover", unit: "N" },
    output: { name: "Altitude change", unit: "m" },
    params: [
      p("m", "All-up mass", r2(massKg, 3), "kg"),
      p("Tmax", "Total max thrust", r2(thrustTotal, 2), "N"),
      p("τm", `Motor/prop lag (${prop.inch}" props)`, r2(tm, 3), "s"),
      p("c", "Vertical drag", r2(cDrag, 3), "N·s/m"),
      p("Ts", `Sensor latency (${sensor.rateHz} Hz)`, r2(lat.delay, 4), "s"),
    ],
    equations: ["τm Ṫ = u − T", "m z̈ = T − c ż − F_gust", "u ∈ [−m g, Tmax − m g]"],
    assumptions: ["Hover thrust cancels gravity.", "Attitude held level by the inner loop.", "Thrust can't go below zero (props don't reverse)."],
    plant: { kind: "tf", num: [1], den: withLag([massKg * tm, massKg + cDrag * tm, cDrag, 0], lat.delay) },
    controller: { type: "pid", kp: r2(5 * massKg, 2), ki: r2(0.7 * massKg, 2), kd: r2(3.3 * massKg, 2), N: 30 },
    controllerRationale:
      "Altitude behaves like a double integrator, so proportional action alone oscillates. Derivative action adds damping, and a small integral term removes the error left by an imperfect hover thrust estimate.",
    specs: { maxOvershootPct: 10, maxSettlingTime: 4, maxSsErrorPct: 2, uMin: -weight, uMax },
    sim: { tEnd: 10, ref: gm.target, disturbance: gm.gust > 0 ? { time: 6, magnitude: -gm.gust * weight } : undefined, noiseStd: sensor.noise },
    source: "offline",
    presetId: "drone",
    rig: { kind: "drone", signal: "altitude" },
  };
  const common: Common = { board, driver: esc, battery, sensor, vAvail: battery.vNom, checks, autoLines, levelShift: board.logicV < 4 && sensor.outV > 3.6, buck: false };
  return {
    build,
    model,
    board,
    driver: esc,
    battery,
    sensor,
    droneMotor: motor,
    prop,
    vAvail: battery.vNom,
    massKg,
    cost,
    bom,
    checks: sortChecks(checks),
    stats: [
      { label: "Parts cost", value: `$${cost.toFixed(2)}`, sub: `${bom.length} line items` },
      { label: "All-up weight", value: `${Math.round(massKg * 1000)} g`, sub: `payload ${Math.round(gm.payload * 1000)} g` },
      { label: "Thrust / weight", value: `${fmt(twr)} : 1`, sub: `hover at ${Math.round(Math.min(1, hoverFrac) * 100)}% throttle`, tone: twr < 1.2 ? "bad" : twr < 2 ? "warn" : "ok" },
      { label: "Flight time", value: `${fmt(flightMin, 1)} min`, sub: "hovering" },
    ],
    wiring: droneWiring(common, motor),
    facts: { twr, hoverFrac, thrustTotal, weight, maxA: th.maxA, armM: prop.armM, propIn: prop.inch, massKg },
  };
}

// ---------------------------------------------------------------------------
// Live checks from the simulation
// ---------------------------------------------------------------------------

export interface Telemetry {
  /** Total supply current (A). */
  current: Float64Array;
  /** Current per motor channel, compared with the driver rating. */
  perMotor: Float64Array;
  limitA: number;
  label: string;
}

export function telemetry(hw: DerivedHardware, y: ArrayLike<number>, u: ArrayLike<number>, dt: number): Telemetry {
  const n = y.length;
  const current = new Float64Array(n);
  const perMotor = new Float64Array(n);
  const kind = hw.build.kind;
  if (kind === "drone") {
    const { thrustTotal, weight, maxA } = hw.facts;
    for (let i = 0; i < n; i++) {
      const T = Math.max(0, Math.min(thrustTotal, weight + (u[i] ?? 0)));
      const per = maxA * Math.pow(T / thrustTotal, 1.5);
      perMotor[i] = per;
      current[i] = 4 * per;
    }
    return { current, perMotor, limitA: hw.driver.contA, label: "per-motor current" };
  }
  const dc = hw.dc!;
  const motors = kind === "arm" ? 1 : 2;
  const r = hw.facts.r ?? 1;
  const holdA = kind === "arm" ? hw.facts.tHold / dc.Kt : 0;
  for (let i = 0; i < n; i++) {
    const dy = i > 0 ? (y[i] - y[i - 1]) / dt : 0;
    const w = kind === "arm" ? dy : kind === "rover" ? (y[i] ?? 0) / r : dy / r;
    const per = Math.abs(((u[i] ?? 0) - dc.Ke * w) / dc.R) + holdA * 0.6;
    perMotor[i] = Number.isFinite(per) ? per : 0;
    current[i] = perMotor[i] * motors + 0.15;
  }
  return { current, perMotor, limitA: hw.driver.contA, label: kind === "arm" ? "motor current" : "current per motor" };
}

export function liveChecks(hw: DerivedHardware, tel: Telemetry, u: ArrayLike<number>, wcp: number, stable: boolean): DesignCheck[] {
  const out: DesignCheck[] = [];
  let peak = 0;
  for (let i = 0; i < tel.perMotor.length; i++) peak = Math.max(peak, tel.perMotor[i]);
  // Sustained current: the highest 100 ms average.
  const win = Math.max(1, Math.round(tel.perMotor.length / 40));
  let sustained = 0,
    acc = 0;
  for (let i = 0; i < tel.perMotor.length; i++) {
    acc += tel.perMotor[i];
    if (i >= win) acc -= tel.perMotor[i - win];
    if (i >= win - 1) sustained = Math.max(sustained, acc / win);
  }
  const drv = hw.driver;
  if (!stable) {
    out.push({ id: "live-unstable", level: "error", title: "Control loop is unstable", detail: "The motors slam between full forward and reverse. Fix the controller before building this.", slot: "motor", callout: "unstable" });
  } else if (sustained > drv.contA) {
    out.push({
      id: "live-amps",
      level: peak > drv.peakA ? "error" : "warn",
      title: `Run draws ${hw.build.kind === "drone" ? "" : ""}${peak.toFixed(2)} A peak per motor; ${drv.name} is rated ${drv.contA} A`,
      detail: `Sustained ${sustained.toFixed(2)} A during the run. ${peak > drv.peakA ? `Above its ${drv.peakA} A peak rating: it will shut down.` : "It will get hot; soften the controller or use a bigger driver."}`,
      slot: "driver",
      callout: `${peak.toFixed(1)} A peak`,
      fix: (() => {
        const list = hw.build.kind === "drone" ? ESCS : DRIVERS;
        const f = cheapest(list, (d) => d.contA >= sustained * 1.15 && d.peakA >= peak && d.vMax >= hw.battery.vMax && d.vMin <= hw.battery.vNom);
        return f ? { label: `Use ${f.name}`, parts: { driver: f.id } } : undefined;
      })(),
    });
  } else {
    out.push({ id: "live-amps", level: "pass", title: `Peak ${peak.toFixed(2)} A per motor during the run`, detail: `Within the ${drv.name}'s ${drv.contA} A continuous rating.`, slot: "driver" });
  }
  const uMax = hw.model.specs.uMax,
    uMin = hw.model.specs.uMin;
  let sat = 0;
  for (let i = 0; i < u.length; i++) if (u[i] >= uMax * 0.999 || u[i] <= uMin * 0.999) sat++;
  const satFrac = u.length ? sat / u.length : 0;
  if (stable && satFrac > 0.15)
    out.push({
      id: "live-sat",
      level: "warn",
      title: `Actuator saturated ${Math.round(satFrac * 100)}% of the run`,
      detail: `The controller asks for more than the ${hw.build.kind === "drone" ? "motors' thrust" : `${fmtV(hw.vAvail)} at the motors`}. The hardware, not the gains, limits the response.`,
      slot: hw.build.kind === "drone" ? "motor" : "battery",
      callout: "saturated",
    });
  const rate = Math.min(hw.board.loopHz, hw.sensor.rateHz);
  const need = stable && wcp > 0 && wcp < 1e8 ? (wcp / TAU) * 20 : 0;
  if (need > rate)
    out.push({
      id: "live-rate",
      level: "warn",
      title: `Loop needs ≈${Math.round(need)} Hz; ${rate === hw.board.loopHz ? hw.board.name : hw.sensor.name} runs at ${rate} Hz`,
      detail: "Sampling should be 20× the crossover frequency or the digital controller loses phase margin.",
      slot: rate === hw.board.loopHz ? "board" : "sensor",
      callout: `${rate} Hz`,
    });
  else if (need > 0) out.push({ id: "live-rate", level: "pass", title: `${rate} Hz loop covers the ${fmtNum1(wcp / TAU)} Hz bandwidth`, detail: "Sampling is at least 20× the crossover frequency.", slot: "board" });
  return out;
}

const fmtV = (v: number) => `${v.toFixed(1)} V`;
const fmtNum1 = (v: number) => (v >= 10 ? Math.round(v).toString() : v.toFixed(1));

const ORDER: Record<CheckLevel, number> = { error: 0, warn: 1, info: 2, pass: 3 };
export function sortChecks(c: DesignCheck[]): DesignCheck[] {
  return [...c].sort((a, b) => ORDER[a.level] - ORDER[b.level] || Number(!!b.auto) - Number(!!a.auto));
}

/** Controller defaults for a fresh build. */
export function defaultController(hw: DerivedHardware): ControllerSpec {
  return hw.model.controller;
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function dcWiring(build: HardwareBuild, c: Common, motor: GearMotor, motors: number, kind: RigKind): { nodes: NetNode[]; edges: NetEdge[] } {
  const { board, driver, battery, sensor } = c;
  const nodes: NetNode[] = [];
  const edges: NetEdge[] = [];
  const e = (from: [string, string], to: [string, string], k: NetEdge["kind"], net: string) => edges.push({ from, to, kind: k, net });
  const P = board.form === "esp32" ? "GPIO" : board.form === "pico" ? "GP" : board.form === "teensy" ? "" : "D";
  const pwm = board.form === "esp32" ? [25, 26] : board.form === "pico" ? [16, 17] : [5, 6];
  const dig = board.form === "esp32" ? [16, 17, 18, 19, 23, 4] : board.form === "pico" ? [10, 11, 12, 13, 14, 15] : [7, 8, 9, 10, 11, 12];
  const inp = board.form === "esp32" ? [34, 35, 36, 39] : board.form === "pico" ? [6, 7, 8, 9] : [2, 3, 4, 13];
  const pin = (n: number) => `${P}${n}`;
  const logicPin = board.logicV < 4 ? "3V3" : "5V";
  const portable = battery.kind === "battery";

  nodes.push({ id: "bat", ref: "BT1", name: battery.name, sub: `${battery.vNom} V`, pins: ["+", "−"], col: 0 });
  let vbat: [string, string] = ["bat", "+"];
  if (portable) {
    nodes.push({ id: "fuse", ref: "F1", name: "Fuse", sub: AUTO_PARTS.fuse.name, pins: ["IN", "OUT"], col: 0, auto: true });
    nodes.push({ id: "sw", ref: "SW1", name: "Power switch", sub: AUTO_PARTS.switch.name, pins: ["IN", "OUT"], col: 0, auto: true });
    e(vbat, ["fuse", "IN"], "power", "VBAT");
    e(["fuse", "OUT"], ["sw", "IN"], "power", "VBAT");
    vbat = ["sw", "OUT"];
  }
  if (c.buck) {
    nodes.push({ id: "buck", ref: "U4", name: "Buck → 5 V", sub: AUTO_PARTS.buck.name, pins: ["VIN", "GND", "VOUT"], col: 1, auto: true });
    e(vbat, ["buck", "VIN"], "power", "VBAT");
    e(["bat", "−"], ["buck", "GND"], "ground", "GND");
  }
  nodes.push({ id: "mcu", ref: "U1", name: board.name, sub: `${board.logicV} V logic`, pins: ["5V", "GND", pin(pwm[0]), pin(dig[0]), pin(dig[1]), ...(motors > 1 ? [pin(pwm[1]), pin(dig[2]), pin(dig[3])] : []), pin(inp[0]), pin(inp[1]), ...(kind === "rover" ? [pin(dig[4]), pin(inp[2])] : []), logicPin === "3V3" ? "3V3" : "VCC"], col: 1 });
  const dPins =
    driver.look === "tb6612"
      ? ["VM", "VCC", "GND", "PWMA", "AIN1", "AIN2", "PWMB", "BIN1", "BIN2", "STBY", "AO1", "AO2", "BO1", "BO2"]
      : driver.look === "l298n"
        ? ["12V", "GND", "5V", "ENA", "IN1", "IN2", "ENB", "IN3", "IN4", "OUT1", "OUT2", "OUT3", "OUT4"]
        : ["V+", "GND", "PWM1", "DIR1", "PWM2", "DIR2", "M1A", "M1B", "M2A", "M2B"];
  nodes.push({ id: "drv", ref: "U2", name: driver.name, sub: `${driver.contA} A/ch`, pins: dPins, col: 2 });
  const vin = driver.look === "tb6612" ? "VM" : driver.look === "l298n" ? "12V" : "V+";
  e(vbat, ["drv", vin], "power", "VBAT");
  e(["bat", "−"], ["drv", "GND"], "ground", "GND");
  e(["drv", "GND"], ["mcu", "GND"], "ground", "GND");
  if (c.buck) e(["buck", "VOUT"], ["mcu", "5V"], "power", "5V");
  else if (driver.onboard5v) e(["drv", "5V"], ["mcu", "5V"], "power", "5V");
  else e(vbat, ["mcu", "5V"], "power", "VIN");
  const sig = (from: string, to: string, net: string) => e(["mcu", from], ["drv", to], "signal", net);
  if (driver.look === "l298n") {
    sig(pin(pwm[0]), "ENA", "ENA");
    sig(pin(dig[0]), "IN1", "IN1");
    sig(pin(dig[1]), "IN2", "IN2");
    if (motors > 1) {
      sig(pin(pwm[1]), "ENB", "ENB");
      sig(pin(dig[2]), "IN3", "IN3");
      sig(pin(dig[3]), "IN4", "IN4");
    }
  } else if (driver.look === "tb6612") {
    sig(pin(pwm[0]), "PWMA", "PWMA");
    sig(pin(dig[0]), "AIN1", "AIN1");
    sig(pin(dig[1]), "AIN2", "AIN2");
    if (motors > 1) {
      sig(pin(pwm[1]), "PWMB", "PWMB");
      sig(pin(dig[2]), "BIN1", "BIN1");
      sig(pin(dig[3]), "BIN2", "BIN2");
    }
    e(["mcu", logicPin === "3V3" ? "3V3" : "VCC"], ["drv", "VCC"], "power", "VLOGIC");
    e(["mcu", logicPin === "3V3" ? "3V3" : "VCC"], ["drv", "STBY"], "signal", "STBY");
  } else {
    sig(pin(pwm[0]), "PWM1", "PWM1");
    sig(pin(dig[0]), "DIR1", "DIR1");
    if (motors > 1) {
      sig(pin(pwm[1]), "PWM2", "PWM2");
      sig(pin(dig[2]), "DIR2", "DIR2");
    }
  }
  const outs = driver.look === "l298n" ? ["OUT1", "OUT2", "OUT3", "OUT4"] : driver.look === "tb6612" ? ["AO1", "AO2", "BO1", "BO2"] : ["M1A", "M1B", "M2A", "M2B"];
  const names = kind === "arm" ? ["Shoulder motor"] : ["Left motor", "Right motor"];
  for (let i = 0; i < motors; i++) {
    const id = `m${i}`;
    nodes.push({ id, ref: `M${i + 1}`, name: names[i], sub: motor.name, pins: ["+", "−"], col: 3 });
    e(["drv", outs[i * 2]], [id, "+"], "motor", `MOTOR_${i ? "B" : "A"}+`);
    e(["drv", outs[i * 2 + 1]], [id, "−"], "motor", `MOTOR_${i ? "B" : "A"}−`);
  }
  // Sensors.
  const shifter = c.levelShift;
  if (shifter) {
    nodes.push({ id: "ls", ref: "U3", name: "Level shifter", sub: AUTO_PARTS.levelShifter.name, pins: ["HV", "LV", "GND", "HV1", "LV1", "HV2", "LV2"], col: 2, auto: true });
    e(c.buck ? ["buck", "VOUT"] : driver.onboard5v ? ["drv", "5V"] : vbat, ["ls", "HV"], "power", "5V");
    e(["mcu", "3V3"], ["ls", "LV"], "power", "3V3");
    e(["mcu", "GND"], ["ls", "GND"], "ground", "GND");
  }
  const sensorCount = kind === "rover" ? 2 : 1;
  for (let i = 0; i < sensorCount; i++) {
    const id = `s${i}`;
    const isImu = sensor.kind === "imu";
    nodes.push({ id, ref: `S${i + 1}`, name: isImu ? "IMU" : kind === "rover" ? (i ? "Right encoder" : "Left encoder") : "Joint encoder", sub: sensor.name, pins: isImu || sensor.look === "magnetic" ? ["VCC", "GND", "SDA", "SCL"] : ["VCC", "GND", "A", "B"], col: 3 });
    e(sensor.vcc[0] > 3.6 ? (c.buck ? ["buck", "VOUT"] : driver.onboard5v ? ["drv", "5V"] : ["mcu", "5V"]) : ["mcu", logicPin === "3V3" ? "3V3" : "VCC"], [id, "VCC"], "power", sensor.vcc[0] > 3.6 ? "5V" : "VLOGIC");
    e(["mcu", "GND"], [id, "GND"], "ground", "GND");
    const p1 = isImu || sensor.look === "magnetic" ? "SDA" : "A";
    if (shifter && sensor.outV > 3.6 && i === 0) {
      e([id, p1], ["ls", "HV1"], "signal", `${p1}_5V`);
      e(["ls", "LV1"], ["mcu", pin(inp[0])], "signal", p1);
    } else e([id, p1], ["mcu", pin(inp[i * 2] ?? inp[0])], "signal", `${p1}${i}`);
  }
  if (kind === "rover") {
    nodes.push({ id: "us", ref: `S3`, name: "Ultrasonic sensor", sub: HC_SR04.name, pins: ["VCC", "GND", "TRIG", "ECHO"], col: 3 });
    e(c.buck ? ["buck", "VOUT"] : driver.onboard5v ? ["drv", "5V"] : ["mcu", "5V"], ["us", "VCC"], "power", "5V");
    e(["mcu", "GND"], ["us", "GND"], "ground", "GND");
    e(["mcu", pin(dig[4])], ["us", "TRIG"], "signal", "TRIG");
    if (shifter) {
      e(["us", "ECHO"], ["ls", "HV2"], "signal", "ECHO_5V");
      e(["ls", "LV2"], ["mcu", pin(inp[2])], "signal", "ECHO");
    } else e(["us", "ECHO"], ["mcu", pin(inp[2])], "signal", "ECHO");
  }
  void build;
  return { nodes, edges };
}

function droneWiring(c: Common, motor: DroneMotor): { nodes: NetNode[]; edges: NetEdge[] } {
  const { board, driver, battery, sensor } = c;
  const nodes: NetNode[] = [
    { id: "bat", ref: "BT1", name: battery.name, sub: `${battery.cells}S · XT60`, pins: ["+", "−"], col: 0 },
    { id: "cap", ref: "C1", name: "Low-ESR capacitor", sub: "1000 µF 35 V", pins: ["+", "−"], col: 0, auto: true },
    { id: "esc", ref: "U2", name: driver.name, sub: `${driver.contA} A`, pins: ["VBAT", "GND", "5V", "M1", "M2", "M3", "M4", "OUT1", "OUT2", "OUT3", "OUT4"], col: 1 },
    { id: "fc", ref: "U1", name: board.name, sub: `${board.loopHz} Hz loop`, pins: ["5V", "GND", "M1", "M2", "M3", "M4", "SDA", "SCL", "3V3"], col: 2 },
  ];
  const edges: NetEdge[] = [];
  const e = (from: [string, string], to: [string, string], k: NetEdge["kind"], net: string) => edges.push({ from, to, kind: k, net });
  e(["bat", "+"], ["cap", "+"], "power", "VBAT");
  e(["bat", "−"], ["cap", "−"], "ground", "GND");
  e(["cap", "+"], ["esc", "VBAT"], "power", "VBAT");
  e(["cap", "−"], ["esc", "GND"], "ground", "GND");
  e(["esc", "5V"], ["fc", "5V"], "power", "5V");
  e(["esc", "GND"], ["fc", "GND"], "ground", "GND");
  for (let i = 1; i <= 4; i++) {
    e(["fc", `M${i}`], ["esc", `M${i}`], "signal", `DSHOT${i}`);
    nodes.push({ id: `m${i}`, ref: `M${i}`, name: `Motor ${i}`, sub: `${motor.name}`, pins: ["A", "B", "C"], col: 3 });
    e(["esc", `OUT${i}`], [`m${i}`, "A"], "motor", `PHASE${i}`);
  }
  nodes.push({ id: "alt", ref: "S1", name: "Altitude sensor", sub: sensor.name, pins: ["VCC", "GND", sensor.look === "sonar" ? "ECHO" : "SDA", sensor.look === "sonar" ? "TRIG" : "SCL"], col: 3 });
  e(sensor.vcc[0] > 3.6 ? ["fc", "5V"] : ["fc", "3V3"], ["alt", "VCC"], "power", sensor.vcc[0] > 3.6 ? "5V" : "3V3");
  e(["fc", "GND"], ["alt", "GND"], "ground", "GND");
  e(["alt", sensor.look === "sonar" ? "ECHO" : "SDA"], ["fc", "SDA"], "signal", sensor.look === "sonar" ? "ECHO" : "SDA");
  e(["fc", "SCL"], ["alt", sensor.look === "sonar" ? "TRIG" : "SCL"], "signal", sensor.look === "sonar" ? "TRIG" : "SCL");
  return { nodes, edges };
}
