// Hobby-market parts the four rigs can be built from. Ratings are typical datasheet values
// (the same library the original RoboCraft studio used, plus drone and IMU parts); the UI tells
// users to check the datasheet of the exact part they buy.

export type SlotId = "board" | "driver" | "motor" | "battery" | "sensor" | "prop";

export interface PartBase {
  id: string;
  name: string;
  /** One-line spec shown under the name in pickers. */
  spec: string;
  price: number; // USD
  mass: number; // g
}

export interface Board extends PartBase {
  logicV: number;
  loopHz: number; // realistic control-loop rate with sensor reads and PWM updates
  color: string;
  form: "uno" | "nano" | "esp32" | "pico" | "teensy" | "fc";
}

export interface Driver extends PartBase {
  vMin: number;
  vMax: number;
  contA: number; // per channel
  peakA: number;
  dropV: number;
  /** Minimum logic-high voltage on the control pins, or a ratio of the driver's logic supply. */
  vih: number;
  onboard5v?: { maxInV: number; maxA: number };
  look: "l298n" | "tb6612" | "mdd10a" | "bts7960" | "esc";
  cellsMin?: number;
  cellsMax?: number;
}

export interface GearMotor extends PartBase {
  ratedV: number;
  vMax: number;
  rpm: number; // no-load output speed at ratedV
  stallKgcm: number; // output stall torque at ratedV
  stallA: number;
  noLoadA: number;
  ratio: number;
  rotorJ: number; // rotor inertia at the motor shaft, kg·m²
  look: "n20" | "tt" | "jga25" | "jgb37" | "37d" | "pg45";
}

export interface Battery extends PartBase {
  kind: "battery" | "adapter";
  chem: string;
  vNom: number;
  vMin: number;
  vMax: number;
  mAh: number;
  maxA: number;
  cells?: number;
  look: "aa" | "18650" | "lipo" | "adapter";
}

export interface Sensor extends PartBase {
  kind: "encoder" | "imu" | "altimeter";
  rateHz: number;
  /** 1σ measurement noise in the rig's output units (m/s, rad, m). */
  noise: number;
  outV: number; // logic level of the sensor's output pins
  vcc: [number, number];
  rangeMax?: number; // altimeters: m
  look: "hall" | "optical" | "magnetic" | "mpu" | "bno" | "icm" | "sonar" | "tof" | "baro";
}

export interface DroneMotor extends PartBase {
  kv: number;
  cells: number; // rated LiPo cell count
  propIn: number; // recommended prop
  thrustG: number; // max thrust per motor at rated cells with the recommended prop
  maxA: number;
  stator: string;
}

export interface Prop extends PartBase {
  inch: number;
  frameG: number; // matching frame mass
  armM: number; // motor-to-centre distance on the matching frame
}

const kgcm = 0.0980665; // N·m per kg·cm
export const KGCM = kgcm;

// ---------------------------------------------------------------------------
// Controllers
// ---------------------------------------------------------------------------

export const BOARDS: Board[] = [
  { id: "uno", name: "Arduino Uno R3", spec: "ATmega328P · 5 V logic · ~1 kHz loop", price: 27, mass: 25, logicV: 5, loopHz: 1000, color: "#1b5fa8", form: "uno" },
  { id: "nano", name: "Arduino Nano", spec: "ATmega328P · 5 V logic · ~1 kHz loop", price: 22, mass: 7, logicV: 5, loopHz: 1000, color: "#1b5fa8", form: "nano" },
  { id: "esp32", name: "ESP32 DevKitC", spec: "240 MHz dual core · 3.3 V logic · ~10 kHz loop", price: 10, mass: 10, logicV: 3.3, loopHz: 10000, color: "#15181d", form: "esp32" },
  { id: "pico", name: "Raspberry Pi Pico", spec: "RP2040 · 3.3 V logic · ~5 kHz loop", price: 4, mass: 3, logicV: 3.3, loopHz: 5000, color: "#1f7a3a", form: "pico" },
  { id: "teensy", name: "Teensy 4.1", spec: "600 MHz Cortex-M7 · 3.3 V logic · ~20 kHz loop", price: 32, mass: 9, logicV: 3.3, loopHz: 20000, color: "#2b6b3f", form: "teensy" },
];

export const FLIGHT_CONTROLLERS: Board[] = [
  { id: "nano-fc", name: "Arduino Nano (DIY flight controller)", spec: "5 V logic · ~250 Hz loop with IMU fusion", price: 22, mass: 7, logicV: 5, loopHz: 250, color: "#1b5fa8", form: "nano" },
  { id: "f405", name: "F405 flight controller", spec: "168 MHz · 3.3 V · 4 kHz PID loop", price: 40, mass: 8, logicV: 3.3, loopHz: 4000, color: "#111317", form: "fc" },
  { id: "f722", name: "F722 flight controller", spec: "216 MHz · 3.3 V · 8 kHz PID loop", price: 55, mass: 8, logicV: 3.3, loopHz: 8000, color: "#111317", form: "fc" },
];

// ---------------------------------------------------------------------------
// Motor drivers and ESCs
// ---------------------------------------------------------------------------

export const DRIVERS: Driver[] = [
  { id: "l298n", name: "L298N Dual H-Bridge", spec: "5–35 V · 2 A/ch · 2 V drop · bipolar", price: 4, mass: 26, vMin: 5, vMax: 35, contA: 2, peakA: 3, dropV: 2, vih: 2.3, onboard5v: { maxInV: 12, maxA: 0.5 }, look: "l298n" },
  { id: "tb6612", name: "TB6612FNG Dual Driver", spec: "4.5–13.5 V · 1.2 A/ch · 0.5 V drop · MOSFET", price: 5, mass: 3, vMin: 4.5, vMax: 13.5, contA: 1.2, peakA: 3.2, dropV: 0.5, vih: 0.7, look: "tb6612" },
  { id: "mdd10a", name: "Cytron MDD10A", spec: "5–30 V · 10 A/ch · 0.2 V drop", price: 20, mass: 40, vMin: 5, vMax: 30, contA: 10, peakA: 30, dropV: 0.2, vih: 2, look: "mdd10a" },
  { id: "bts7960", name: "BTS7960 43 A (×2)", spec: "5.5–27 V · 43 A · 0.1 V drop · one per motor", price: 18, mass: 132, vMin: 5.5, vMax: 27, contA: 15, peakA: 43, dropV: 0.1, vih: 2, look: "bts7960" },
];

export const ESCS: Driver[] = [
  { id: "esc12", name: "12 A BLHeli_S ESC (×4)", spec: "1–2S · 12 A continuous", price: 28, mass: 16, vMin: 3, vMax: 8.7, contA: 12, peakA: 15, dropV: 0.1, vih: 1.5, look: "esc", cellsMin: 1, cellsMax: 2 },
  { id: "esc20", name: "20 A BLHeli_S ESC (×4)", spec: "2–4S · 20 A continuous", price: 36, mass: 24, vMin: 6, vMax: 17.4, contA: 20, peakA: 25, dropV: 0.1, vih: 1.5, look: "esc", cellsMin: 2, cellsMax: 4 },
  { id: "esc35", name: "35 A 4-in-1 ESC", spec: "3–6S · 35 A continuous", price: 45, mass: 14, vMin: 9, vMax: 26, contA: 35, peakA: 45, dropV: 0.1, vih: 1.5, look: "esc", cellsMin: 3, cellsMax: 6 },
  { id: "esc55", name: "55 A 4-in-1 ESC", spec: "3–6S · 55 A continuous", price: 70, mass: 18, vMin: 9, vMax: 26, contA: 55, peakA: 65, dropV: 0.1, vih: 1.5, look: "esc", cellsMin: 3, cellsMax: 6 },
];

// ---------------------------------------------------------------------------
// Actuators
// ---------------------------------------------------------------------------

export const GEARMOTORS: GearMotor[] = [
  { id: "n20", name: "N20 Micro Metal Gearmotor 100:1", spec: "6 V · 300 RPM · 2 kg·cm · 1.5 A stall", price: 6, mass: 10, ratedV: 6, vMax: 9, rpm: 300, stallKgcm: 2, stallA: 1.5, noLoadA: 0.1, ratio: 100, rotorJ: 5e-8, look: "n20" },
  { id: "tt", name: "TT Gear Motor 1:48 (yellow)", spec: "6 V · 200 RPM · 1.5 kg·cm · 1.5 A stall", price: 3, mass: 30, ratedV: 6, vMax: 6, rpm: 200, stallKgcm: 1.5, stallA: 1.5, noLoadA: 0.2, ratio: 48, rotorJ: 3e-7, look: "tt" },
  { id: "jga25-6", name: "JGA25-370 6 V 210 RPM", spec: "6 V · 210 RPM · 3.2 kg·cm · 2.4 A stall", price: 9, mass: 90, ratedV: 6, vMax: 7.5, rpm: 210, stallKgcm: 3.2, stallA: 2.4, noLoadA: 0.12, ratio: 21, rotorJ: 1.2e-6, look: "jga25" },
  { id: "jga25-12", name: "JGA25-370 12 V 280 RPM", spec: "12 V · 280 RPM · 4.5 kg·cm · 2 A stall", price: 9, mass: 90, ratedV: 12, vMax: 12, rpm: 280, stallKgcm: 4.5, stallA: 2, noLoadA: 0.1, ratio: 34, rotorJ: 1.2e-6, look: "jga25" },
  { id: "jgb37", name: "JGB37-520 12 V 110 RPM", spec: "12 V · 110 RPM · 10 kg·cm · 3 A stall", price: 12, mass: 160, ratedV: 12, vMax: 12, rpm: 110, stallKgcm: 10, stallA: 3, noLoadA: 0.12, ratio: 90, rotorJ: 2e-6, look: "jgb37" },
  { id: "37d", name: "37D Metal Gearmotor 50:1", spec: "12 V · 200 RPM · 21 kg·cm · 5.5 A stall", price: 40, mass: 200, ratedV: 12, vMax: 12, rpm: 200, stallKgcm: 21, stallA: 5.5, noLoadA: 0.2, ratio: 50, rotorJ: 3e-6, look: "37d" },
  { id: "pg45", name: "PG45 Planetary 12 V 60 RPM", spec: "12 V · 60 RPM · 60 kg·cm · 8 A stall", price: 58, mass: 420, ratedV: 12, vMax: 13, rpm: 60, stallKgcm: 60, stallA: 8, noLoadA: 0.3, ratio: 139, rotorJ: 4e-6, look: "pg45" },
];

export const DRONE_MOTORS: DroneMotor[] = [
  { id: "1404", name: "1404 3800 KV", spec: "4S · 3\" props · 420 g thrust · 12 A", price: 15, mass: 9, kv: 3800, cells: 4, propIn: 3, thrustG: 420, maxA: 12, stator: "14×04" },
  { id: "2306", name: "2306 2450 KV", spec: "4S · 5\" props · 1300 g thrust · 38 A", price: 20, mass: 32, kv: 2450, cells: 4, propIn: 5, thrustG: 1300, maxA: 38, stator: "23×06" },
  { id: "2207", name: "2207 1950 KV", spec: "6S · 5\" props · 1450 g thrust · 40 A", price: 22, mass: 33, kv: 1950, cells: 6, propIn: 5, thrustG: 1450, maxA: 40, stator: "22×07" },
  { id: "2806", name: "2806.5 1300 KV", spec: "6S · 7\" props · 2000 g thrust · 42 A", price: 28, mass: 50, kv: 1300, cells: 6, propIn: 7, thrustG: 2000, maxA: 42, stator: "28×06.5" },
  { id: "2212", name: "2212 920 KV", spec: "3S · 10\" props · 850 g thrust · 15 A", price: 12, mass: 56, kv: 920, cells: 3, propIn: 10, thrustG: 850, maxA: 15, stator: "22×12" },
];

export const PROPS: Prop[] = [
  { id: "p3", name: "3\" tri-blade props", spec: "3 in · 140 mm frame", price: 4, mass: 8, inch: 3, frameG: 55, armM: 0.07 },
  { id: "p5", name: "5\" tri-blade props", spec: "5 in · 220 mm frame", price: 5, mass: 18, inch: 5, frameG: 120, armM: 0.11 },
  { id: "p7", name: "7\" bi-blade props", spec: "7 in · 300 mm frame", price: 8, mass: 28, inch: 7, frameG: 170, armM: 0.15 },
  { id: "p10", name: "10\" bi-blade props", spec: "10 in · 450 mm frame", price: 9, mass: 44, inch: 10, frameG: 280, armM: 0.225 },
];

// ---------------------------------------------------------------------------
// Power
// ---------------------------------------------------------------------------

export const BATTERIES: Battery[] = [
  { id: "aa4", name: "4× AA NiMH pack", spec: "4.8 V · 2000 mAh · 4 A max", price: 10, mass: 110, kind: "battery", chem: "NiMH", vNom: 4.8, vMin: 4, vMax: 5.6, mAh: 2000, maxA: 4, look: "aa" },
  { id: "18650-2s", name: "2S 18650 Li-ion pack", spec: "7.4 V · 2600 mAh · 5 A max", price: 15, mass: 95, kind: "battery", chem: "Li-ion", vNom: 7.4, vMin: 6, vMax: 8.4, mAh: 2600, maxA: 5, cells: 2, look: "18650" },
  { id: "lipo-2s", name: "2S LiPo 2200 mAh 20C", spec: "7.4 V · 2200 mAh · 44 A max", price: 18, mass: 110, kind: "battery", chem: "LiPo", vNom: 7.4, vMin: 6.4, vMax: 8.4, mAh: 2200, maxA: 44, cells: 2, look: "lipo" },
  { id: "lipo-3s", name: "3S LiPo 2200 mAh 20C", spec: "11.1 V · 2200 mAh · 44 A max", price: 24, mass: 180, kind: "battery", chem: "LiPo", vNom: 11.1, vMin: 9.6, vMax: 12.6, mAh: 2200, maxA: 44, cells: 3, look: "lipo" },
  { id: "lipo-4s", name: "4S LiPo 1500 mAh 75C", spec: "14.8 V · 1500 mAh · 112 A max", price: 30, mass: 175, kind: "battery", chem: "LiPo", vNom: 14.8, vMin: 12.8, vMax: 16.8, mAh: 1500, maxA: 112, cells: 4, look: "lipo" },
  { id: "adapter12", name: "12 V 5 A DC adapter", spec: "12 V · 5 A · mains powered", price: 15, mass: 0, kind: "adapter", chem: "mains", vNom: 12, vMin: 12, vMax: 12, mAh: 0, maxA: 5, look: "adapter" },
];

export const DRONE_BATTERIES: Battery[] = [
  { id: "d2s450", name: "2S LiPo 450 mAh 80C", spec: "7.4 V · 450 mAh · 36 A max", price: 9, mass: 28, kind: "battery", chem: "LiPo", vNom: 7.4, vMin: 6.4, vMax: 8.4, mAh: 450, maxA: 36, cells: 2, look: "lipo" },
  { id: "d3s2200", name: "3S LiPo 2200 mAh 30C", spec: "11.1 V · 2200 mAh · 66 A max", price: 22, mass: 180, kind: "battery", chem: "LiPo", vNom: 11.1, vMin: 9.6, vMax: 12.6, mAh: 2200, maxA: 66, cells: 3, look: "lipo" },
  { id: "d4s1500", name: "4S LiPo 1500 mAh 100C", spec: "14.8 V · 1500 mAh · 150 A max", price: 32, mass: 185, kind: "battery", chem: "LiPo", vNom: 14.8, vMin: 12.8, vMax: 16.8, mAh: 1500, maxA: 150, cells: 4, look: "lipo" },
  { id: "d6s1100", name: "6S LiPo 1100 mAh 120C", spec: "22.2 V · 1100 mAh · 132 A max", price: 38, mass: 190, kind: "battery", chem: "LiPo", vNom: 22.2, vMin: 19.2, vMax: 25.2, mAh: 1100, maxA: 132, cells: 6, look: "lipo" },
  { id: "d6s3000", name: "6S Li-ion 3000 mAh (long range)", spec: "21.6 V · 3000 mAh · 30 A max", price: 45, mass: 300, kind: "battery", chem: "Li-ion", vNom: 21.6, vMin: 18, vMax: 25.2, mAh: 3000, maxA: 30, cells: 6, look: "18650" },
];

// ---------------------------------------------------------------------------
// Sensors
// ---------------------------------------------------------------------------

export const ENCODERS: Sensor[] = [
  { id: "hall11", name: "Hall encoder, 11 PPR", spec: "Magnetic disc on the motor shaft · coarse", price: 3, mass: 4, kind: "encoder", rateHz: 200, noise: 0.012, outV: 5, vcc: [3.3, 5.5], look: "hall" },
  { id: "opt334", name: "Optical encoder, 334 CPR", spec: "Quadrature · fine resolution", price: 12, mass: 6, kind: "encoder", rateHz: 1000, noise: 0.003, outV: 5, vcc: [4.5, 5.5], look: "optical" },
  { id: "as5600", name: "AS5600 magnetic angle sensor", spec: "12-bit absolute · I²C", price: 5, mass: 2, kind: "encoder", rateHz: 1000, noise: 0.0015, outV: 3.3, vcc: [3.0, 5.5], look: "magnetic" },
];

export const IMUS: Sensor[] = [
  { id: "mpu6050", name: "MPU-6050 IMU", spec: "6-axis · 3.3 V I²C · ~200 Hz fused", price: 3, mass: 2, kind: "imu", rateHz: 200, noise: 0.004, outV: 3.3, vcc: [3.3, 5.5], look: "mpu" },
  { id: "bno055", name: "BNO055 absolute orientation", spec: "9-axis on-chip fusion · 100 Hz", price: 30, mass: 3, kind: "imu", rateHz: 100, noise: 0.0015, outV: 3.3, vcc: [3.3, 5.5], look: "bno" },
  { id: "icm42688", name: "ICM-42688-P IMU", spec: "6-axis · SPI · 1 kHz, low noise", price: 12, mass: 2, kind: "imu", rateHz: 1000, noise: 0.0008, outV: 3.3, vcc: [1.7, 3.6], look: "icm" },
];

export const ALTIMETERS: Sensor[] = [
  { id: "hcsr04", name: "HC-SR04 ultrasonic", spec: "2 cm–4 m · 40 Hz · 5 V echo", price: 2, mass: 9, kind: "altimeter", rateHz: 40, noise: 0.01, outV: 5, vcc: [4.5, 5.5], rangeMax: 4, look: "sonar" },
  { id: "vl53l1x", name: "VL53L1X time-of-flight", spec: "4 cm–4 m · 50 Hz · I²C", price: 12, mass: 2, kind: "altimeter", rateHz: 50, noise: 0.005, outV: 3.3, vcc: [2.6, 5.5], rangeMax: 4, look: "tof" },
  { id: "bmp388", name: "BMP388 barometer", spec: "Any height · 100 Hz · ±8 cm noise", price: 10, mass: 1, kind: "altimeter", rateHz: 100, noise: 0.08, outV: 3.3, vcc: [1.7, 3.6], rangeMax: 1000, look: "baro" },
];

export const HC_SR04 = ALTIMETERS[0];

// Safety parts RoboCraft adds on its own.
export const AUTO_PARTS = {
  fuse: { name: "Inline blade fuse", price: 2, mass: 8 },
  switch: { name: "Rocker power switch (10 A)", price: 1, mass: 6 },
  bulkCap: { name: "1000 µF 16 V bulk capacitor", price: 0.5, mass: 2 },
  noiseCaps: { name: "2 × 100 nF motor noise capacitors", price: 0.2, mass: 0 },
  levelShifter: { name: "4-ch logic level converter (BSS138)", price: 3, mass: 2 },
  buck: { name: "LM2596 buck converter → 5 V", price: 3, mass: 12 },
} as const;
