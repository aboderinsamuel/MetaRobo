// RoboCraft's constrained component library: real, off-the-shelf hobby / education hardware that a
// school or university lab can order online. Muse Spark composes every machine from these parts
// (plus a few fabricated parts that services like PCBWay make to order), so nothing it designs is
// impossible to source.
//
// Values are typical datasheet / listing figures. Where listings disagree, the conservative value is
// used (e.g. MG996R 11 kg·cm at 6 V, not the 13 kg·cm some sellers claim). Prices are rough USD.
import type { SupplierKey } from "./suppliers";

export type Category =
  | "servo"
  | "motor"
  | "stepper"
  | "controller"
  | "driver"
  | "sensor"
  | "power"
  | "structure"
  | "wheel"
  | "kit"
  | "electronics";

/** Which 3D model draws the part (see components/lab/hw3d/catalogMeshes.tsx). */
export type ModelKind =
  | "servo_micro"
  | "servo_standard"
  | "servo_bus"
  | "motor_tt"
  | "motor_n20"
  | "motor_jga25"
  | "motor_jgb37"
  | "motor_37d"
  | "stepper_nema17"
  | "stepper_28byj"
  | "board_uno"
  | "board_mega"
  | "board_nano"
  | "board_esp32"
  | "board_pico"
  | "board_pi"
  | "board_microbit"
  | "driver_l298n"
  | "driver_tb6612"
  | "driver_pca9685"
  | "driver_a4988"
  | "module_pcb"
  | "sensor_sonar"
  | "sensor_tof"
  | "sensor_imu"
  | "sensor_line"
  | "sensor_color"
  | "sensor_camera"
  | "sensor_pir"
  | "battery_18650x2"
  | "battery_18650x3"
  | "battery_lipo"
  | "battery_aa4"
  | "buck"
  | "bracket_u"
  | "bracket_l"
  | "bracket_multi"
  | "servo_horn"
  | "standoff"
  | "wheel"
  | "wheel_mecanum"
  | "wheel_omni"
  | "caster_ball"
  | "track_set"
  | "arm_kit"
  | "gripper_claw"
  | "pan_tilt"
  | "chassis_plate"
  | "breadboard"
  | "led_ring"
  | "oled"
  | "speaker"
  | "button"
  | "switch"
  | "bearing"
  | "shaft_coupler"
  | "timing_pulley"
  | "lead_screw"
  | "sensor_soil"
  | "sensor_level"
  | "sensor_dht"
  | "relay_module"
  | "pump_mini"
  | "pump_12v"
  | "solenoid_valve"
  | "buzzer"
  | "led"
  | "fan"
  | "potentiometer"
  | "lcd"
  | "pot_plant"
  | "reservoir"
  | "tube_coil";

export interface Actuator {
  kind: "servo" | "continuous_servo" | "dc" | "stepper";
  ratedV: number;
  /** Stall torque in kg·cm at ratedV (for steppers: holding torque). */
  stallKgcm: number;
  /** No-load speed: degrees per second for servos, rpm for motors and steppers. */
  speed: number;
  /** Travel range in degrees (positional servos only). */
  rangeDeg?: number;
  stallA: number;
  idleA: number;
}

export interface CatalogPart {
  id: string;
  name: string;
  category: Category;
  model: ModelKind;
  /** Bounding size in millimetres, [x, y, z] as the model is drawn (y up). */
  dims: [number, number, number];
  massG: number;
  priceUsd: number;
  spec: string;
  suppliers: SupplierKey[];
  /** What to type into a supplier's search box. */
  search: string;
  actuator?: Actuator;
  /** Supply range and what it can deliver (batteries, regulators, drivers). */
  electrical?: { vMin: number; vMax: number; maxA?: number; mAh?: number; channels?: number };
  /** Pumps and valves: flow at rated voltage (L/min) and max head (m). */
  fluid?: { flowLpm: number; headM: number };
  /** Arm kits: reach (mm), joints, end effector. */
  kit?: { reachMm: number; dof: number; effector: "gripper" | "hand" | "suction" };
  /** Source when added by web search or an upload. */
  source?: string;
}

// speed helper: "0.1 s/60°" → deg/s
const s60 = (sec: number) => Math.round(60 / sec);

const hobby: SupplierKey[] = ["robotshop", "amazon", "aliexpress"];

export const CATALOG: CatalogPart[] = [
  // ---------------------------------------------------------------- servos
  { id: "sg90", name: "SG90 micro servo (9 g)", category: "servo", model: "servo_micro", dims: [23, 22.5, 12.2], massG: 9, priceUsd: 3, spec: "1.8 kg·cm @ 4.8 V · 0.1 s/60° · 180° · plastic gears", suppliers: ["adafruit", "sparkfun", ...hobby, "lcsc"], search: "SG90 micro servo", actuator: { kind: "servo", ratedV: 4.8, stallKgcm: 1.8, speed: s60(0.1), rangeDeg: 180, stallA: 0.65, idleA: 0.01 } },
  { id: "mg90s", name: "MG90S metal-gear micro servo", category: "servo", model: "servo_micro", dims: [22.8, 22.5, 12.2], massG: 13.4, priceUsd: 5, spec: "2.2 kg·cm @ 6 V · 0.08 s/60° · 180° · metal gears", suppliers: ["robotshop", ...hobby, "dfrobot"], search: "MG90S servo", actuator: { kind: "servo", ratedV: 6, stallKgcm: 2.2, speed: s60(0.08), rangeDeg: 180, stallA: 0.75, idleA: 0.01 } },
  { id: "fs90r", name: "FS90R continuous-rotation micro servo", category: "servo", model: "servo_micro", dims: [23, 22.5, 12.2], massG: 9, priceUsd: 5, spec: "1.5 kg·cm · 130 rpm @ 6 V · continuous", suppliers: ["adafruit", "pololu", ...hobby], search: "FS90R continuous servo", actuator: { kind: "continuous_servo", ratedV: 6, stallKgcm: 1.5, speed: 130, stallA: 0.8, idleA: 0.1 } },
  { id: "mg996r", name: "MG996R standard metal-gear servo", category: "servo", model: "servo_standard", dims: [40.7, 42.9, 19.7], massG: 55, priceUsd: 8, spec: "11 kg·cm @ 6 V · 0.14 s/60° · 180° · metal gears", suppliers: ["robotshop", "adafruit", ...hobby, "lcsc"], search: "MG996R servo", actuator: { kind: "servo", ratedV: 6, stallKgcm: 11, speed: s60(0.14), rangeDeg: 180, stallA: 2.5, idleA: 0.01 } },
  { id: "ds3218", name: "DS3218 20 kg digital servo", category: "servo", model: "servo_standard", dims: [40, 40.5, 20], massG: 60, priceUsd: 15, spec: "21.5 kg·cm @ 6.8 V · 0.14 s/60° · 270° · IP66", suppliers: ["amazon", "aliexpress", "robotshop"], search: "DS3218 servo", actuator: { kind: "servo", ratedV: 6.8, stallKgcm: 21.5, speed: s60(0.14), rangeDeg: 270, stallA: 3, idleA: 0.01 } },
  { id: "hs422", name: "Hitec HS-422 standard servo", category: "servo", model: "servo_standard", dims: [40.6, 36.6, 19.8], massG: 45, priceUsd: 13, spec: "4.1 kg·cm @ 6 V · 0.16 s/60° · 180°", suppliers: ["servocity", "robotshop", "sparkfun"], search: "Hitec HS-422", actuator: { kind: "servo", ratedV: 6, stallKgcm: 4.1, speed: s60(0.16), rangeDeg: 180, stallA: 1.0, idleA: 0.008 } },
  { id: "lx16a", name: "Hiwonder LX-16A serial bus servo", category: "servo", model: "servo_bus", dims: [45.2, 36.3, 24.7], massG: 54, priceUsd: 18, spec: "17 kg·cm @ 6 V · 0.19 s/60° · 240° · position feedback", suppliers: ["hiwonder", "robotshop", "amazon"], search: "Hiwonder LX-16A", actuator: { kind: "servo", ratedV: 6, stallKgcm: 17, speed: s60(0.19), rangeDeg: 240, stallA: 1.9, idleA: 0.1 } },
  { id: "sts3215", name: "Feetech STS3215 serial bus servo", category: "servo", model: "servo_bus", dims: [45.2, 35, 24.7], massG: 55, priceUsd: 16, spec: "19 kg·cm @ 7.4 V · 0.22 s/60° · 360° magnetic encoder", suppliers: ["robotshop", "seeed", "waveshare", "aliexpress"], search: "Feetech STS3215", actuator: { kind: "servo", ratedV: 7.4, stallKgcm: 19, speed: s60(0.22), rangeDeg: 360, stallA: 2.7, idleA: 0.08 } },
  { id: "dynamixel-xl430", name: "Dynamixel XL430-W250-T", category: "servo", model: "servo_bus", dims: [28.5, 46.5, 34], massG: 57, priceUsd: 50, spec: "15.3 kg·cm @ 12 V · 57 rpm · 360° · TTL bus", suppliers: ["robotshop", "digikey"], search: "Dynamixel XL430-W250-T", actuator: { kind: "servo", ratedV: 12, stallKgcm: 15.3, speed: 342, rangeDeg: 360, stallA: 1.4, idleA: 0.05 } },

  // ---------------------------------------------------------------- DC gearmotors
  { id: "tt-motor", name: "TT gear motor 1:48 (yellow)", category: "motor", model: "motor_tt", dims: [70, 22.5, 37], massG: 30, priceUsd: 3, spec: "3–6 V · 200 rpm @ 6 V · 0.8 kg·cm", suppliers: ["adafruit", "sparkfun", ...hobby], search: "TT gear motor 1:48", actuator: { kind: "dc", ratedV: 6, stallKgcm: 0.8, speed: 200, stallA: 1.5, idleA: 0.15 } },
  { id: "n20-100", name: "N20 micro metal gearmotor 100:1", category: "motor", model: "motor_n20", dims: [34, 10, 12], massG: 10, priceUsd: 6, spec: "6 V · 300 rpm · 2 kg·cm · 1.5 A stall", suppliers: ["pololu", ...hobby, "lcsc"], search: "N20 gearmotor 100:1", actuator: { kind: "dc", ratedV: 6, stallKgcm: 2, speed: 300, stallA: 1.5, idleA: 0.1 } },
  { id: "pololu-298", name: "Pololu 298:1 micro metal gearmotor HP", category: "motor", model: "motor_n20", dims: [34, 10, 12], massG: 10, priceUsd: 21, spec: "6 V · 100 rpm · 6.2 kg·cm", suppliers: ["pololu", "robotshop"], search: "Pololu 298:1 micro metal gearmotor HP", actuator: { kind: "dc", ratedV: 6, stallKgcm: 6.2, speed: 100, stallA: 1.6, idleA: 0.07 } },
  { id: "jga25-370", name: "JGA25-370 gearmotor 12 V 280 rpm", category: "motor", model: "motor_jga25", dims: [62, 25, 25], massG: 90, priceUsd: 9, spec: "12 V · 280 rpm · 4.5 kg·cm · encoder option", suppliers: [...hobby, "dfrobot"], search: "JGA25-370 12V gear motor", actuator: { kind: "dc", ratedV: 12, stallKgcm: 4.5, speed: 280, stallA: 2, idleA: 0.1 } },
  { id: "jgb37-520", name: "JGB37-520 gearmotor 12 V 110 rpm (encoder)", category: "motor", model: "motor_jgb37", dims: [75, 37, 37], massG: 160, priceUsd: 14, spec: "12 V · 110 rpm · 10 kg·cm · Hall encoder", suppliers: [...hobby, "dfrobot"], search: "JGB37-520 encoder motor", actuator: { kind: "dc", ratedV: 12, stallKgcm: 10, speed: 110, stallA: 3, idleA: 0.12 } },
  { id: "pololu-37d-50", name: "Pololu 37D 50:1 metal gearmotor (encoder)", category: "motor", model: "motor_37d", dims: [68, 37, 37], massG: 200, priceUsd: 45, spec: "12 V · 200 rpm · 21 kg·cm · 64 CPR encoder", suppliers: ["pololu", "robotshop"], search: "Pololu 37D 50:1 gearmotor encoder", actuator: { kind: "dc", ratedV: 12, stallKgcm: 21, speed: 200, stallA: 5.5, idleA: 0.2 } },

  // ---------------------------------------------------------------- steppers
  { id: "nema17", name: "NEMA 17 stepper motor (42×42×40)", category: "stepper", model: "stepper_nema17", dims: [42.3, 42.3, 40], massG: 280, priceUsd: 14, spec: "1.8°/step · 4.4 kg·cm holding · 1.5 A/phase", suppliers: ["sparkfun", "adafruit", "openbuilds", ...hobby], search: "NEMA 17 stepper motor", actuator: { kind: "stepper", ratedV: 12, stallKgcm: 4.4, speed: 600, stallA: 1.5, idleA: 0.4 } },
  { id: "28byj48", name: "28BYJ-48 geared stepper (5 V)", category: "stepper", model: "stepper_28byj", dims: [28, 19, 35], massG: 37, priceUsd: 3, spec: "5 V · 1:64 gearbox · ~15 rpm · 0.3 kg·cm", suppliers: ["adafruit", ...hobby, "lcsc"], search: "28BYJ-48 stepper ULN2003", actuator: { kind: "stepper", ratedV: 5, stallKgcm: 0.34, speed: 15, stallA: 0.24, idleA: 0.16 } },

  // ---------------------------------------------------------------- controllers
  { id: "arduino-uno", name: "Arduino Uno R3", category: "controller", model: "board_uno", dims: [68.6, 15, 53.4], massG: 25, priceUsd: 27, spec: "ATmega328P · 14 digital I/O · 6 PWM · 5 V logic", suppliers: ["arduino", "sparkfun", "adafruit", "digikey"], search: "Arduino Uno R3", electrical: { vMin: 7, vMax: 12 } },
  { id: "arduino-mega", name: "Arduino Mega 2560 Rev3", category: "controller", model: "board_mega", dims: [101.5, 15, 53.3], massG: 37, priceUsd: 48, spec: "ATmega2560 · 54 digital I/O · 15 PWM · 4 UARTs", suppliers: ["arduino", "sparkfun", "adafruit", "digikey"], search: "Arduino Mega 2560 Rev3", electrical: { vMin: 7, vMax: 12 } },
  { id: "arduino-nano", name: "Arduino Nano", category: "controller", model: "board_nano", dims: [45, 8, 18], massG: 7, priceUsd: 22, spec: "ATmega328P · 22 I/O · breadboard-friendly", suppliers: ["arduino", "sparkfun", "digikey"], search: "Arduino Nano", electrical: { vMin: 7, vMax: 12 } },
  { id: "esp32-devkitc", name: "ESP32 DevKitC", category: "controller", model: "board_esp32", dims: [55, 8, 28], massG: 10, priceUsd: 10, spec: "Dual-core 240 MHz · Wi-Fi + Bluetooth · 3.3 V logic", suppliers: ["adafruit", "sparkfun", "digikey", "lcsc"], search: "ESP32 DevKitC", electrical: { vMin: 5, vMax: 5 } },
  { id: "rpi-pico", name: "Raspberry Pi Pico", category: "controller", model: "board_pico", dims: [51, 4, 21], massG: 3, priceUsd: 4, spec: "RP2040 · 26 GPIO · 3.3 V logic", suppliers: ["raspberrypi", "adafruit", "sparkfun", "digikey"], search: "Raspberry Pi Pico", electrical: { vMin: 1.8, vMax: 5.5 } },
  { id: "rpi-4b", name: "Raspberry Pi 4 Model B (4 GB)", category: "controller", model: "board_pi", dims: [85, 17, 56], massG: 46, priceUsd: 55, spec: "Quad-core 1.5 GHz · camera/USB/Wi-Fi · Linux · 5 V 3 A", suppliers: ["raspberrypi", "adafruit", "sparkfun", "digikey"], search: "Raspberry Pi 4 Model B 4GB", electrical: { vMin: 5, vMax: 5, maxA: 3 } },
  { id: "rpi-5", name: "Raspberry Pi 5 (4 GB)", category: "controller", model: "board_pi", dims: [85, 19, 56], massG: 48, priceUsd: 60, spec: "Quad-core 2.4 GHz · 2 camera ports · 5 V 5 A", suppliers: ["raspberrypi", "adafruit", "digikey"], search: "Raspberry Pi 5 4GB", electrical: { vMin: 5, vMax: 5, maxA: 5 } },
  { id: "microbit-v2", name: "BBC micro:bit V2", category: "controller", model: "board_microbit", dims: [52, 11, 42], massG: 9, priceUsd: 18, spec: "nRF52833 · LED matrix · buttons · speaker · for schools", suppliers: ["sparkfun", "adafruit", "digikey"], search: "micro:bit V2", electrical: { vMin: 3, vMax: 3.3 } },

  // ---------------------------------------------------------------- drivers
  { id: "pca9685", name: "PCA9685 16-channel PWM servo driver", category: "driver", model: "driver_pca9685", dims: [62, 12, 25], massG: 9, priceUsd: 15, spec: "16 servos over I²C · external servo power", suppliers: ["adafruit", "sparkfun", ...hobby], search: "PCA9685 16 channel servo driver", electrical: { vMin: 2.3, vMax: 6, channels: 16 } },
  { id: "l298n", name: "L298N dual H-bridge module", category: "driver", model: "driver_l298n", dims: [43, 27, 43], massG: 26, priceUsd: 4, spec: "5–35 V · 2 A/channel · 2 V drop", suppliers: [...hobby, "dfrobot"], search: "L298N motor driver module", electrical: { vMin: 5, vMax: 35, maxA: 2, channels: 2 } },
  { id: "tb6612", name: "TB6612FNG dual motor driver", category: "driver", model: "driver_tb6612", dims: [20, 3, 20], massG: 3, priceUsd: 5, spec: "4.5–13.5 V · 1.2 A/channel · MOSFET", suppliers: ["sparkfun", "pololu", "adafruit"], search: "TB6612FNG motor driver", electrical: { vMin: 4.5, vMax: 13.5, maxA: 1.2, channels: 2 } },
  { id: "drv8833", name: "DRV8833 dual motor driver", category: "driver", model: "driver_tb6612", dims: [18, 3, 13], massG: 2, priceUsd: 5, spec: "2.7–10.8 V · 1.2 A/channel", suppliers: ["pololu", "adafruit"], search: "DRV8833 motor driver", electrical: { vMin: 2.7, vMax: 10.8, maxA: 1.2, channels: 2 } },
  { id: "a4988", name: "A4988 stepper driver", category: "driver", model: "driver_a4988", dims: [20, 10, 15], massG: 2, priceUsd: 4, spec: "8–35 V · 1 A/phase (2 A cooled) · 1/16 microstep", suppliers: ["pololu", "sparkfun", ...hobby], search: "A4988 stepper driver", electrical: { vMin: 8, vMax: 35, maxA: 1.5, channels: 1 } },
  { id: "uln2003", name: "ULN2003 stepper driver board", category: "driver", model: "module_pcb", dims: [35, 12, 32], massG: 7, priceUsd: 2, spec: "For 28BYJ-48 · 5–12 V", suppliers: [...hobby], search: "ULN2003 driver board", electrical: { vMin: 5, vMax: 12, maxA: 0.5, channels: 1 } },
  { id: "motor-shield-v2", name: "Adafruit Motor Shield V2", category: "driver", model: "module_pcb", dims: [69, 12, 53], massG: 30, priceUsd: 20, spec: "4 DC or 2 stepper + 2 servo · 1.2 A/ch", suppliers: ["adafruit", "digikey"], search: "Adafruit Motor Shield V2", electrical: { vMin: 4.5, vMax: 13.5, maxA: 1.2, channels: 4 } },

  // ---------------------------------------------------------------- sensors
  { id: "hc-sr04", name: "HC-SR04 ultrasonic distance sensor", category: "sensor", model: "sensor_sonar", dims: [45, 15, 20], massG: 9, priceUsd: 2, spec: "2 cm–4 m · 15° cone · 5 V", suppliers: ["sparkfun", "adafruit", ...hobby], search: "HC-SR04 ultrasonic" },
  { id: "vl53l0x", name: "VL53L0X time-of-flight distance sensor", category: "sensor", model: "sensor_tof", dims: [18, 3, 13], massG: 1, priceUsd: 10, spec: "Up to 2 m · I²C · laser", suppliers: ["adafruit", "pololu", "sparkfun"], search: "VL53L0X breakout" },
  { id: "mpu6050", name: "MPU-6050 IMU (GY-521)", category: "sensor", model: "sensor_imu", dims: [21, 3, 16], massG: 2, priceUsd: 3, spec: "6-axis accel + gyro · I²C", suppliers: ["adafruit", "sparkfun", ...hobby], search: "MPU-6050 GY-521" },
  { id: "bno055", name: "BNO055 9-DOF orientation sensor", category: "sensor", model: "sensor_imu", dims: [27, 4, 20], massG: 3, priceUsd: 35, spec: "Absolute orientation · on-chip fusion", suppliers: ["adafruit", "digikey"], search: "BNO055 breakout" },
  { id: "line-array", name: "5-channel IR line-tracking sensor array", category: "sensor", model: "sensor_line", dims: [60, 5, 15], massG: 6, priceUsd: 6, spec: "TCRT5000 × 5 · digital/analog out", suppliers: [...hobby, "dfrobot"], search: "5 channel line tracking sensor TCRT5000" },
  { id: "tcs34725", name: "TCS34725 colour sensor", category: "sensor", model: "sensor_color", dims: [20, 3, 20], massG: 2, priceUsd: 8, spec: "RGB + clear · white LED · I²C", suppliers: ["adafruit", "digikey"], search: "TCS34725 color sensor" },
  { id: "pi-camera-3", name: "Raspberry Pi Camera Module 3", category: "sensor", model: "sensor_camera", dims: [25, 12, 24], massG: 4, priceUsd: 25, spec: "12 MP · autofocus · CSI ribbon", suppliers: ["raspberrypi", "adafruit", "sparkfun"], search: "Raspberry Pi Camera Module 3" },
  { id: "usb-webcam", name: "USB webcam (Logitech C270)", category: "sensor", model: "sensor_camera", dims: [72, 30, 30], massG: 75, priceUsd: 25, spec: "720p 30 fps · USB · OpenCV-ready", suppliers: ["amazon"], search: "Logitech C270 webcam" },
  { id: "pir-hcsr501", name: "HC-SR501 PIR motion sensor", category: "sensor", model: "sensor_pir", dims: [32, 25, 24], massG: 6, priceUsd: 2, spec: "Up to 7 m · adjustable delay", suppliers: ["adafruit", ...hobby], search: "HC-SR501 PIR" },
  { id: "as5600", name: "AS5600 magnetic angle encoder", category: "sensor", model: "module_pcb", dims: [23, 3, 23], massG: 2, priceUsd: 5, spec: "12-bit absolute angle · I²C", suppliers: [...hobby, "lcsc"], search: "AS5600 encoder module" },
  { id: "limit-switch", name: "Micro limit switch with lever", category: "sensor", model: "button", dims: [20, 10, 6.5], massG: 2, priceUsd: 1, spec: "End stop · NO/NC", suppliers: ["sparkfun", "adafruit", ...hobby], search: "micro limit switch lever" },
  { id: "hx711-loadcell", name: "Load cell 5 kg + HX711 amplifier", category: "sensor", model: "module_pcb", dims: [80, 12.7, 12.7], massG: 30, priceUsd: 10, spec: "Weighing · 24-bit ADC", suppliers: ["sparkfun", ...hobby], search: "5kg load cell HX711" },

  // ---------------------------------------------------------------- power
  { id: "batt-18650x2", name: "2× 18650 holder + cells (7.4 V)", category: "power", model: "battery_18650x2", dims: [77, 21, 41], massG: 105, priceUsd: 15, spec: "7.4 V nominal · 2600 mAh · ~5 A", suppliers: ["adafruit", ...hobby], search: "2x 18650 battery holder", electrical: { vMin: 6, vMax: 8.4, maxA: 5, mAh: 2600 } },
  { id: "batt-18650x3", name: "3× 18650 holder + cells (11.1 V)", category: "power", model: "battery_18650x3", dims: [77, 21, 61], massG: 150, priceUsd: 20, spec: "11.1 V nominal · 2600 mAh · ~5 A", suppliers: [...hobby], search: "3x 18650 battery holder", electrical: { vMin: 9, vMax: 12.6, maxA: 5, mAh: 2600 } },
  { id: "lipo-2s-2200", name: "2S LiPo 2200 mAh 25C", category: "power", model: "battery_lipo", dims: [105, 19, 34], massG: 120, priceUsd: 18, spec: "7.4 V · 2200 mAh · 55 A burst · XT60", suppliers: ["robotshop", "amazon"], search: "2S LiPo 2200mAh", electrical: { vMin: 6.4, vMax: 8.4, maxA: 55, mAh: 2200 } },
  { id: "lipo-3s-2200", name: "3S LiPo 2200 mAh 25C", category: "power", model: "battery_lipo", dims: [105, 25, 34], massG: 180, priceUsd: 24, spec: "11.1 V · 2200 mAh · 55 A burst · XT60", suppliers: ["robotshop", "amazon"], search: "3S LiPo 2200mAh", electrical: { vMin: 9.6, vMax: 12.6, maxA: 55, mAh: 2200 } },
  { id: "batt-aa4", name: "4× AA battery holder (NiMH)", category: "power", model: "battery_aa4", dims: [62, 15, 58], massG: 110, priceUsd: 8, spec: "4.8 V · 2000 mAh · ~3 A", suppliers: ["adafruit", "sparkfun", ...hobby], search: "4xAA battery holder", electrical: { vMin: 4, vMax: 5.6, maxA: 3, mAh: 2000 } },
  { id: "buck-lm2596", name: "LM2596 buck converter", category: "power", model: "buck", dims: [43, 14, 21], massG: 12, priceUsd: 3, spec: "4–40 V in · 1.25–37 V out · 3 A max (2 A continuous)", suppliers: [...hobby, "lcsc"], search: "LM2596 buck converter module", electrical: { vMin: 4, vMax: 40, maxA: 2 } },
  { id: "ubec-5a", name: "5 V 5 A UBEC (servo power)", category: "power", model: "buck", dims: [45, 10, 20], massG: 15, priceUsd: 8, spec: "6–23 V in · 5–6 V out · 5 A continuous", suppliers: ["robotshop", "amazon"], search: "5A UBEC 5V 6V", electrical: { vMin: 6, vMax: 23, maxA: 5 } },
  { id: "psu-12v-5a", name: "12 V 5 A desktop power adapter", category: "power", model: "module_pcb", dims: [110, 32, 50], massG: 250, priceUsd: 15, spec: "Mains → 12 V 5 A · 5.5 mm barrel", suppliers: ["adafruit", "amazon"], search: "12V 5A power adapter", electrical: { vMin: 12, vMax: 12, maxA: 5 } },

  // ---------------------------------------------------------------- structure
  { id: "bracket-u-servo", name: "Aluminium U-shaped servo bracket", category: "structure", model: "bracket_u", dims: [57, 45, 25], massG: 12, priceUsd: 3, spec: "For standard servos · 2 mm Al · M3 holes", suppliers: [...hobby, "hiwonder"], search: "servo U bracket aluminum" },
  { id: "bracket-multi-servo", name: "Multi-function servo bracket", category: "structure", model: "bracket_multi", dims: [57, 45, 25], massG: 11, priceUsd: 3, spec: "Holds a standard servo · joint mount", suppliers: [...hobby, "hiwonder"], search: "multi functional servo bracket" },
  { id: "bracket-l-servo", name: "L-shaped servo bracket", category: "structure", model: "bracket_l", dims: [45, 40, 25], massG: 8, priceUsd: 2, spec: "90° joint · 2 mm Al", suppliers: [...hobby], search: "L shaped servo bracket" },
  { id: "bracket-u-micro", name: "Micro servo U-bracket (SG90 / MG90S)", category: "structure", model: "bracket_u", dims: [32, 28, 14], massG: 4, priceUsd: 2, spec: "For 9 g micro servos · 1.5 mm Al", suppliers: [...hobby], search: "SG90 servo bracket" },
  { id: "horn-micro-21t", name: "Micro servo horn (21T, SG90 / MG90S)", category: "structure", model: "servo_horn", dims: [20, 2, 20], massG: 1, priceUsd: 0.5, spec: "21-tooth spline · for 9 g micro servos", suppliers: ["adafruit", ...hobby], search: "SG90 servo horn" },
  { id: "horn-metal-25t", name: "25T aluminium servo horn (round)", category: "structure", model: "servo_horn", dims: [24, 4, 24], massG: 4, priceUsd: 2, spec: "25-tooth spline · for MG996R / DS3218", suppliers: [...hobby, "servocity"], search: "25T metal servo horn" },
  { id: "standoff-m3-20", name: "M3 brass standoff 20 mm", category: "structure", model: "standoff", dims: [5, 20, 5], massG: 1.5, priceUsd: 0.2, spec: "M3 female-female · hex 5 mm", suppliers: ["adafruit", "lcsc", ...hobby], search: "M3 brass standoff 20mm" },
  { id: "standoff-m3-40", name: "M3 brass standoff 40 mm", category: "structure", model: "standoff", dims: [5, 40, 5], massG: 3, priceUsd: 0.3, spec: "M3 female-female · hex 5 mm", suppliers: ["lcsc", ...hobby], search: "M3 brass standoff 40mm" },
  { id: "bearing-608", name: "608ZZ ball bearing", category: "structure", model: "bearing", dims: [22, 7, 22], massG: 12, priceUsd: 0.6, spec: "8 mm bore · 22 mm OD · skate bearing", suppliers: ["openbuilds", "lcsc", ...hobby], search: "608ZZ bearing" },
  { id: "coupler-5-8", name: "Flexible shaft coupler 5–8 mm", category: "structure", model: "shaft_coupler", dims: [19, 25, 19], massG: 8, priceUsd: 2, spec: "NEMA 17 to 8 mm lead screw", suppliers: ["openbuilds", ...hobby], search: "flexible coupler 5mm 8mm" },
  { id: "gt2-pulley-20t", name: "GT2 20T timing pulley (5 mm bore)", category: "structure", model: "timing_pulley", dims: [16, 16, 16], massG: 6, priceUsd: 2, spec: "For GT2 6 mm belt · NEMA 17", suppliers: ["openbuilds", "adafruit", ...hobby], search: "GT2 20 tooth pulley 5mm" },
  { id: "lead-screw-t8-300", name: "T8 lead screw 300 mm + brass nut", category: "structure", model: "lead_screw", dims: [8, 300, 8], massG: 110, priceUsd: 10, spec: "8 mm/rev · linear axis", suppliers: ["openbuilds", ...hobby], search: "T8 lead screw 300mm" },
  { id: "chassis-2wd-acrylic", name: "2WD acrylic robot chassis plate", category: "structure", model: "chassis_plate", dims: [210, 3, 150], massG: 120, priceUsd: 12, spec: "3 mm acrylic · TT motor mounts · caster mount", suppliers: ["robotshop", ...hobby], search: "2WD smart robot car chassis kit" },
  { id: "chassis-4wd-acrylic", name: "4WD acrylic robot chassis (2 decks)", category: "structure", model: "chassis_plate", dims: [255, 3, 150], massG: 260, priceUsd: 20, spec: "Two 3 mm decks · 4× TT motor mounts", suppliers: ["robotshop", ...hobby], search: "4WD robot car chassis kit" },

  // ---------------------------------------------------------------- wheels & tracks
  { id: "wheel-tt-65", name: "65 mm rubber wheel for TT motor", category: "wheel", model: "wheel", dims: [65, 65, 27], massG: 30, priceUsd: 2, spec: "65 × 27 mm · TT D-shaft hub", suppliers: ["adafruit", "sparkfun", ...hobby], search: "65mm wheel TT motor" },
  { id: "wheel-pololu-90", name: "Pololu 90 × 10 mm wheel", category: "wheel", model: "wheel", dims: [90, 90, 10], massG: 22, priceUsd: 8, spec: "For micro metal gearmotors (3 mm D-shaft)", suppliers: ["pololu", "robotshop"], search: "Pololu wheel 90x10mm" },
  { id: "wheel-80-6mm", name: "80 mm rubber wheel (6 mm hub)", category: "wheel", model: "wheel", dims: [80, 80, 32], massG: 70, priceUsd: 6, spec: "For JGA25 / 37D motors", suppliers: [...hobby, "servocity"], search: "80mm rubber wheel 6mm hub" },
  { id: "wheel-mecanum-60", name: "60 mm mecanum wheel (set of 4)", category: "wheel", model: "wheel_mecanum", dims: [60, 60, 32], massG: 45, priceUsd: 25, spec: "Omnidirectional · for TT / 4 mm shafts", suppliers: ["robotshop", ...hobby], search: "60mm mecanum wheel set" },
  { id: "wheel-omni-58", name: "58 mm omni wheel", category: "wheel", model: "wheel_omni", dims: [58, 58, 24], massG: 40, priceUsd: 8, spec: "Free rollers · holonomic drives", suppliers: ["robotshop", ...hobby], search: "58mm omni wheel" },
  { id: "caster-ball", name: "Ball caster (metal ball)", category: "wheel", model: "caster_ball", dims: [30, 20, 30], massG: 15, priceUsd: 3, spec: "3/4\" ball · third contact point", suppliers: ["pololu", "sparkfun", ...hobby], search: "ball caster robot" },
  { id: "track-set", name: "Rubber track set (tank chassis)", category: "wheel", model: "track_set", dims: [200, 50, 40], massG: 220, priceUsd: 30, spec: "Pair of tracks + sprockets", suppliers: [...hobby, "dfrobot"], search: "robot tank track chassis kit" },

  // ---------------------------------------------------------------- kits
  { id: "xarm-6dof", name: "Hiwonder xArm 6-DOF robotic arm kit", category: "kit", model: "arm_kit", dims: [140, 400, 140], massG: 1100, priceUsd: 290, spec: "6 bus servos · 360 mm reach · 500 g payload · gripper", suppliers: ["hiwonder", "robotshop", "amazon"], search: "Hiwonder xArm 6DOF", kit: { reachMm: 360, dof: 6, effector: "gripper" } },
  { id: "mearm", name: "MeArm robot arm kit", category: "kit", model: "arm_kit", dims: [120, 250, 120], massG: 220, priceUsd: 45, spec: "4 × SG90 · laser-cut acrylic · 150 mm reach · education", suppliers: ["robotshop", "amazon"], search: "MeArm robot arm kit", kit: { reachMm: 150, dof: 4, effector: "gripper" } },
  { id: "mycobot-280", name: "Elephant Robotics myCobot 280", category: "kit", model: "arm_kit", dims: [130, 330, 130], massG: 850, priceUsd: 650, spec: "6-DOF · 280 mm reach · 250 g payload", suppliers: ["robotshop", "amazon"], search: "myCobot 280", kit: { reachMm: 280, dof: 6, effector: "gripper" } },
  { id: "hand-kit-5f", name: "Hiwonder 5-finger bionic hand kit", category: "kit", model: "arm_kit", dims: [100, 220, 60], massG: 300, priceUsd: 120, spec: "5 servos · humanoid hand", suppliers: ["hiwonder", "amazon"], search: "Hiwonder bionic hand", kit: { reachMm: 180, dof: 4, effector: "hand" } },
  { id: "gripper-claw-mg996", name: "Metal gripper claw (MG996R)", category: "kit", model: "gripper_claw", dims: [110, 90, 40], massG: 120, priceUsd: 15, spec: "55 mm opening · servo included", suppliers: [...hobby, "hiwonder"], search: "metal robot gripper claw MG996R" },
  { id: "pan-tilt-sg90", name: "Pan-tilt bracket kit (2× SG90)", category: "kit", model: "pan_tilt", dims: [40, 60, 40], massG: 40, priceUsd: 8, spec: "For cameras and sensors", suppliers: ["adafruit", ...hobby], search: "pan tilt kit SG90" },

  // ---------------------------------------------------------------- electronics
  { id: "breadboard-400", name: "Half-size breadboard (400 tie points)", category: "electronics", model: "breadboard", dims: [82, 9, 55], massG: 30, priceUsd: 4, spec: "Solderless prototyping", suppliers: ["adafruit", "sparkfun", ...hobby], search: "half size breadboard" },
  { id: "neopixel-ring-16", name: "NeoPixel ring, 16 RGB LEDs", category: "electronics", model: "led_ring", dims: [44, 3, 44], massG: 3, priceUsd: 10, spec: "WS2812B · 5 V · one data pin", suppliers: ["adafruit", "digikey"], search: "NeoPixel ring 16" },
  { id: "oled-128x64", name: "0.96\" OLED display 128×64", category: "electronics", model: "oled", dims: [27, 4, 27], massG: 3, priceUsd: 6, spec: "SSD1306 · I²C", suppliers: ["adafruit", "sparkfun", ...hobby], search: "SSD1306 OLED 128x64" },
  { id: "speaker-8ohm", name: "8 Ω 0.5 W speaker (28 mm)", category: "electronics", model: "speaker", dims: [28, 10, 28], massG: 5, priceUsd: 2, spec: "With MAX98357 or a buzzer driver", suppliers: ["adafruit", ...hobby], search: "28mm 8 ohm speaker" },
  { id: "button-12mm", name: "12 mm tactile push button", category: "electronics", model: "button", dims: [12, 8, 12], massG: 1, priceUsd: 0.3, spec: "Momentary · through-hole", suppliers: ["sparkfun", "adafruit", "lcsc"], search: "12mm tactile button" },
  { id: "estop-22mm", name: "22 mm emergency-stop button", category: "electronics", model: "button", dims: [40, 45, 40], massG: 60, priceUsd: 6, spec: "Latching · NC contact", suppliers: ["amazon", "aliexpress"], search: "22mm emergency stop button" },
  { id: "rocker-switch", name: "Rocker power switch", category: "electronics", model: "switch", dims: [21, 15, 15], massG: 3, priceUsd: 1, spec: "6 A · panel mount", suppliers: ["sparkfun", "adafruit", ...hobby], search: "rocker switch panel mount" },

  // ---------------------------------------------------------------- sensing, plants & automation
  { id: "soil-cap-v12", name: "Capacitive soil moisture sensor v1.2", category: "sensor", model: "sensor_soil", dims: [23, 98, 4], massG: 3, priceUsd: 3, spec: "3.3–5 V · analog out · no exposed metal, so it doesn't corrode", suppliers: ["dfrobot", "adafruit", ...hobby], search: "capacitive soil moisture sensor v1.2" },
  { id: "soil-yl69", name: "YL-69 resistive soil probe + comparator", category: "sensor", model: "sensor_soil", dims: [20, 60, 2], massG: 4, priceUsd: 1.5, spec: "Analog + digital out · corrodes over weeks", suppliers: [...hobby, "lcsc"], search: "YL-69 soil moisture sensor" },
  { id: "water-level", name: "Water level sensor strip", category: "sensor", model: "sensor_level", dims: [20, 62, 2], massG: 3, priceUsd: 1.5, spec: "Analog · 0–40 mm depth", suppliers: [...hobby], search: "water level sensor arduino" },
  { id: "float-switch", name: "Vertical float switch", category: "sensor", model: "sensor_level", dims: [24, 52, 24], massG: 12, priceUsd: 3, spec: "Tank low/high level · reed switch", suppliers: ["adafruit", ...hobby], search: "float switch water level" },
  { id: "dht22", name: "DHT22 temperature & humidity sensor", category: "sensor", model: "sensor_dht", dims: [15.1, 25, 7.7], massG: 2.4, priceUsd: 5, spec: "−40–80 °C ±0.5 · 0–100 % RH ±2 %", suppliers: ["adafruit", "sparkfun", ...hobby], search: "DHT22 AM2302" },
  { id: "bme280", name: "BME280 temperature / humidity / pressure", category: "sensor", model: "module_pcb", dims: [13, 3, 10], massG: 1, priceUsd: 8, spec: "I²C · ±1 °C · ±3 % RH", suppliers: ["adafruit", "sparkfun"], search: "BME280 breakout" },
  { id: "ldr-module", name: "Light sensor (LDR) module", category: "sensor", model: "module_pcb", dims: [32, 6, 14], massG: 2, priceUsd: 1, spec: "Analog + digital out", suppliers: [...hobby], search: "LDR photoresistor module" },
  { id: "potentiometer-10k", name: "10 kΩ potentiometer with knob", category: "electronics", model: "potentiometer", dims: [17, 20, 17], massG: 4, priceUsd: 0.6, spec: "Linear · set a threshold by hand", suppliers: ["sparkfun", "adafruit", ...hobby], search: "10k potentiometer knob" },
  { id: "relay-1ch", name: "1-channel 5 V relay module (SRD-05VDC)", category: "driver", model: "relay_module", dims: [50, 19, 26], massG: 15, priceUsd: 2, spec: "5 V coil · 10 A contacts · opto-isolated", suppliers: ["sparkfun", ...hobby, "lcsc"], search: "1 channel 5V relay module", electrical: { vMin: 5, vMax: 5, maxA: 10, channels: 1 } },
  { id: "relay-2ch", name: "2-channel 5 V relay module", category: "driver", model: "relay_module", dims: [50, 19, 38], massG: 25, priceUsd: 3, spec: "5 V coils · 10 A contacts", suppliers: [...hobby, "lcsc"], search: "2 channel 5V relay module", electrical: { vMin: 5, vMax: 5, maxA: 10, channels: 2 } },
  { id: "mosfet-module", name: "Logic-level MOSFET switch module", category: "driver", model: "module_pcb", dims: [34, 12, 20], massG: 5, priceUsd: 2, spec: "Switch pumps / LEDs / fans from a 3.3–5 V pin · 5 A", suppliers: ["sparkfun", ...hobby], search: "MOSFET switch module arduino", electrical: { vMin: 3, vMax: 24, maxA: 5, channels: 1 } },
  { id: "pump-mini-5v", name: "Mini submersible pump 3–5 V", category: "motor", model: "pump_mini", dims: [45, 30, 24], massG: 28, priceUsd: 3, spec: "3–5 V · 100–200 mA · ~1.2 L/min · 6 mm tube", suppliers: ["adafruit", ...hobby], search: "mini submersible water pump 5V", actuator: { kind: "dc", ratedV: 5, stallKgcm: 0.05, speed: 2500, stallA: 0.25, idleA: 0.13 }, fluid: { flowLpm: 1.2, headM: 0.8 } },
  { id: "pump-12v-r385", name: "R385 12 V diaphragm pump", category: "motor", model: "pump_12v", dims: [90, 40, 40], massG: 120, priceUsd: 6, spec: "12 V · 0.5–0.8 A · ~2 L/min · self-priming", suppliers: [...hobby], search: "R385 diaphragm pump 12V", actuator: { kind: "dc", ratedV: 12, stallKgcm: 0.3, speed: 3000, stallA: 1, idleA: 0.5 }, fluid: { flowLpm: 2, headM: 2 } },
  { id: "solenoid-12v", name: "12 V solenoid water valve (1/2 inch)", category: "driver", model: "solenoid_valve", dims: [85, 60, 45], massG: 120, priceUsd: 8, spec: "12 V · 0.5 A · normally closed · 0.02–0.8 MPa", suppliers: ["adafruit", ...hobby], search: "12V solenoid valve 1/2 inch", fluid: { flowLpm: 6, headM: 0 } },
  { id: "tube-silicone-6mm", name: "Silicone tubing 6 mm ID (1 m)", category: "structure", model: "tube_coil", dims: [60, 10, 60], massG: 30, priceUsd: 2, spec: "Food-safe · fits mini pumps", suppliers: ["adafruit", ...hobby], search: "silicone tubing 6mm ID" },
  { id: "buzzer-active", name: "Active piezo buzzer 5 V (12 mm)", category: "electronics", model: "buzzer", dims: [12, 9.5, 12], massG: 2, priceUsd: 0.5, spec: "85 dB @ 10 cm · 2.3 kHz · beeps when powered", suppliers: ["adafruit", "sparkfun", ...hobby], search: "active buzzer 5V 12mm" },
  { id: "buzzer-passive", name: "Passive piezo buzzer (12 mm)", category: "electronics", model: "buzzer", dims: [12, 8, 12], massG: 2, priceUsd: 0.4, spec: "Plays tones / melodies from PWM", suppliers: ["adafruit", ...hobby], search: "passive piezo buzzer" },
  { id: "led-5mm", name: "5 mm LED + 220 Ω resistor", category: "electronics", model: "led", dims: [5, 9, 5], massG: 0.3, priceUsd: 0.1, spec: "Status light · 20 mA", suppliers: ["sparkfun", "adafruit", "lcsc"], search: "5mm LED" },
  { id: "led-rgb", name: "5 mm RGB LED (common cathode)", category: "electronics", model: "led", dims: [5, 9, 5], massG: 0.4, priceUsd: 0.3, spec: "Any colour · 3 PWM pins", suppliers: ["sparkfun", "adafruit"], search: "RGB LED common cathode 5mm" },
  { id: "fan-5v-40", name: "40 mm 5 V fan", category: "motor", model: "fan", dims: [40, 10, 40], massG: 12, priceUsd: 3, spec: "5 V · 0.1 A · 6000 rpm", suppliers: ["adafruit", ...hobby], search: "40mm 5V fan", actuator: { kind: "dc", ratedV: 5, stallKgcm: 0.02, speed: 6000, stallA: 0.15, idleA: 0.08 } },
  { id: "lcd1602-i2c", name: "LCD 16×2 with I²C backpack", category: "electronics", model: "lcd", dims: [80, 13, 36], massG: 35, priceUsd: 6, spec: "Shows readings and messages", suppliers: ["adafruit", "sparkfun", ...hobby], search: "LCD 1602 I2C" },
  { id: "usb-5v-2a", name: "USB 5 V 2 A wall adapter + cable", category: "power", model: "module_pcb", dims: [45, 25, 40], massG: 60, priceUsd: 6, spec: "5 V · 2 A · mains powered", suppliers: ["adafruit", "amazon"], search: "5V 2A USB power adapter", electrical: { vMin: 5, vMax: 5, maxA: 2 } },
  { id: "jumper-kit", name: "Jumper wire kit (M-M / M-F / F-F)", category: "electronics", model: "module_pcb", dims: [60, 10, 40], massG: 40, priceUsd: 6, spec: "120 × 20 cm Dupont wires", suppliers: ["adafruit", "sparkfun", ...hobby], search: "jumper wire kit dupont" },
  { id: "pot-12cm", name: "Plant pot 12 cm with drainage", category: "structure", model: "pot_plant", dims: [125, 110, 125], massG: 90, priceUsd: 3, spec: "Plastic · holds ~0.9 L of soil", suppliers: ["amazon"], search: "12cm plastic plant pot" },
  { id: "reservoir-1l", name: "Water reservoir 1 L (food-safe box)", category: "structure", model: "reservoir", dims: [130, 90, 130], massG: 80, priceUsd: 4, spec: "1 L · lid with tube hole", suppliers: ["amazon"], search: "1 liter food container" },
];

export const CATALOG_BY_ID = new Map(CATALOG.map((p) => [p.id, p]));

// ---------------------------------------------------------------- fabricated parts
// Custom parts a student can actually get made: laser cut, 3D printed or cut from stock. Anything that
// isn't a catalogue part must be one of these, with a real process and material.

export const FAB_KINDS = ["plate", "printed", "extrusion", "rod"] as const;
export type FabKind = (typeof FAB_KINDS)[number];

export const FAB_MATERIALS: Record<FabKind, string[]> = {
  plate: ["acrylic", "plywood", "aluminium", "carbon_fiber"],
  printed: ["pla", "petg", "tpu"],
  extrusion: ["aluminium"],
  rod: ["steel", "aluminium", "carbon_fiber"],
};

/** g/cm³ */
const DENSITY: Record<string, number> = { acrylic: 1.19, plywood: 0.6, aluminium: 2.7, carbon_fiber: 1.6, pla: 1.24, petg: 1.27, tpu: 1.21, steel: 7.85 };

export interface FabSpec {
  kind: FabKind;
  /** metres: plate [w, thickness, d]; printed [x, y, z]; extrusion [profile, length, -]; rod [diameter, length, -] */
  size: [number, number, number];
  material: string;
}

/** Clamps a fabricated part to what the process can make, and describes how it's made. */
export function fabricate(f: FabSpec): { size: [number, number, number]; material: string; massG: number; priceUsd: number; spec: string; process: string } {
  const mats = FAB_MATERIALS[f.kind];
  const material = mats.includes(f.material) ? f.material : mats[0];
  const c = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));
  let size: [number, number, number];
  let vol: number; // cm³
  let process: string;
  let priceUsd: number;
  switch (f.kind) {
    case "plate": {
      const t = [0.002, 0.003, 0.004, 0.005, 0.006].reduce((a, b) => (Math.abs(b - f.size[1]) < Math.abs(a - f.size[1]) ? b : a));
      size = [c(f.size[0], 0.01, 0.6), t, c(f.size[2], 0.01, 0.6)];
      vol = size[0] * size[2] * t * 1e6;
      process = material === "aluminium" ? "CNC / laser cut sheet" : "Laser cut";
      priceUsd = 3 + vol * (material === "aluminium" ? 0.06 : 0.02);
      break;
    }
    case "printed": {
      size = [c(f.size[0], 0.005, 0.25), c(f.size[1], 0.005, 0.25), c(f.size[2], 0.005, 0.25)];
      const [x, y, z] = size;
      if (Math.min(x, y, z) > 0.012) {
        // An enclosure is printed as a thin-walled shell (2.5 mm walls incl. ribs), not a solid block.
        vol = 2 * (x * y + y * z + x * z) * 0.0025 * 1e6;
        process = "FDM 3D print, 2.5 mm walls (shell)";
      } else {
        // Links, brackets and small fittings: 4 perimeters + 40 % infill ≈ 55 % solid.
        vol = x * y * z * 1e6 * 0.55;
        process = "FDM 3D print, 40 % infill";
      }
      priceUsd = 2 + vol * 0.08;
      break;
    }
    case "extrusion":
      size = [0.02, c(f.size[1], 0.05, 1.5), 0.02];
      vol = size[1] * 100 * 1.6; // 2020 profile ≈ 1.6 cm² of aluminium
      process = "2020 V-slot extrusion, cut to length";
      priceUsd = 2 + size[1] * 10;
      break;
    default:
      size = [c(f.size[0], 0.003, 0.02), c(f.size[1], 0.02, 1), c(f.size[0], 0.003, 0.02)];
      vol = Math.PI * (size[0] * 50) ** 2 * size[1] * 100;
      process = "Stock rod, cut to length";
      priceUsd = 2 + size[1] * 6;
  }
  const massG = Math.round(vol * (DENSITY[material] ?? 1) * 10) / 10;
  const mm = (v: number) => Math.round(v * 1000);
  const spec =
    f.kind === "plate"
      ? `${mm(size[1])} mm ${material} sheet, ${mm(size[0])} × ${mm(size[2])} mm · ${process}`
      : f.kind === "printed"
        ? `${material.toUpperCase()} part ${mm(size[0])} × ${mm(size[1])} × ${mm(size[2])} mm · ${process}`
        : f.kind === "extrusion"
          ? `${process}: ${mm(size[1])} mm`
          : `Ø${mm(size[0])} mm ${material} rod, ${mm(size[1])} mm · ${process}`;
  return { size, material, massG, priceUsd: Math.round(priceUsd * 100) / 100, spec, process };
}

/** The catalogue as compact lines for Muse Spark's prompt. */
export function catalogForPrompt(parts: CatalogPart[] = CATALOG): string {
  return parts
    .map((p) => {
      const a = p.actuator;
      const act = a ? ` | ${a.kind}, ${a.stallKgcm} kg·cm, ${a.kind === "servo" ? `${a.speed}°/s` : `${a.speed} rpm`}` : "";
      const kit = p.kit ? ` | ${p.kit.dof}-DOF, reach ${p.kit.reachMm} mm, ${p.kit.effector}` : "";
      return `${p.id} | ${p.name} | ${p.dims.join("×")} mm | ${p.massG} g | $${p.priceUsd}${act}${kit}`;
    })
    .join("\n");
}
