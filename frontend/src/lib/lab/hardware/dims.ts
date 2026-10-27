// Physical outlines of the parts (metres, [x, y, z] = length, height, width), shared by the 3D
// models and the fit checks, so "won't fit on the chassis" agrees with what you see.
import type { Battery, Board, Driver, GearMotor } from "./parts";

type V3 = [number, number, number];

const MOTOR: Record<GearMotor["look"], { len: number; r: number }> = {
  n20: { len: 0.034, r: 0.006 },
  tt: { len: 0.065, r: 0.011 },
  jga25: { len: 0.065, r: 0.0125 },
  jgb37: { len: 0.08, r: 0.0185 },
  "37d": { len: 0.075, r: 0.0185 },
  pg45: { len: 0.1, r: 0.0225 },
};

export const motorDims = (look: GearMotor["look"]) => MOTOR[look];

export function batteryDims(b: Battery): V3 {
  switch (b.look) {
    case "aa":
      return [0.058, 0.016, 0.062];
    case "18650":
      return b.cells && b.cells >= 6 ? [0.07, 0.04, 0.06] : [0.072, 0.02, 0.042];
    case "lipo":
      return b.cells && b.cells >= 4 ? [0.075, 0.034, 0.038] : [0.075, 0.022 + (b.cells ?? 2) * 0.004, 0.035];
    default:
      return [0.03, 0.012, 0.012];
  }
}

export function boardDims(b: Board): V3 {
  switch (b.form) {
    case "uno":
      return [0.0686, 0.012, 0.0534];
    case "nano":
      return [0.043, 0.008, 0.018];
    case "esp32":
      return [0.055, 0.008, 0.028];
    case "pico":
      return [0.051, 0.006, 0.021];
    case "teensy":
      return [0.061, 0.006, 0.018];
    default:
      return [0.036, 0.008, 0.036];
  }
}

export function driverDims(d: Driver): V3 {
  switch (d.look) {
    case "l298n":
      return [0.043, 0.027, 0.043];
    case "tb6612":
      return [0.02, 0.006, 0.02];
    case "mdd10a":
      return [0.084, 0.014, 0.062];
    case "bts7960":
      return [0.05, 0.03, 0.05];
    default:
      return [0.036, 0.006, 0.036];
  }
}

/** Gap kept between parts laid out along the rover deck. */
export const DECK_GAP = 0.006;
