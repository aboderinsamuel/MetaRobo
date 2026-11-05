// The four built-in machines. Each preset is a default hardware build (lib/lab/hardware), so its
// model comes from real part datasheets. The offline modeler picks one of these by keyword when no
// AI key is configured.
import { defaultBuild, deriveHardware } from "./hardware/build";
import { pickRig } from "./rig";
import type { LabModel, RigKind } from "./types";

const fromHardware = (kind: RigKind) => () => deriveHardware(defaultBuild(kind)).model;

export interface Preset {
  id: string;
  name: string;
  blurb: string;
  prompt: string;
  rig: RigKind;
  build: () => LabModel;
}

export const PRESETS: Preset[] = [
  {
    id: "rover",
    name: "Rover drive",
    blurb: "N20 motors · speed loop · ramp",
    rig: "rover",
    prompt: "A small two-wheel-drive rover with N20 gearmotors and an ESP32. Cruise at 0.5 m/s and keep that speed when it drives up a ramp.",
    build: fromHardware("rover"),
  },
  {
    id: "arm",
    name: "Robot arm joint",
    blurb: "Pick & place · PD · payload",
    rig: "arm",
    prompt: "A 3-axis robot arm with a gearmotor in the shoulder. Pick up a 50 g part and lift it 60 degrees onto a shelf without overshooting.",
    build: fromHardware("arm"),
  },
  {
    id: "balancer",
    name: "Self-balancing robot",
    blurb: "Unstable · 4 states · LQR",
    rig: "balancer",
    prompt: "A two-wheeled self-balancing robot with the body's centre of mass 15 cm above the axle. Keep it upright and drive it 30 cm forward.",
    build: fromHardware("balancer"),
  },
  {
    id: "drone",
    name: "Drone altitude hold",
    blurb: "10\" quad · PID · down-gust",
    rig: "drone",
    prompt: "A camera quadcopter carrying a 300 g gimbal that should climb 1 m and hold altitude, even when a gust pushes it down.",
    build: fromHardware("drone"),
  },
];

/** The preset whose hardware rig is closest to the description. Always returns one of the four. */
export function matchPreset(text: string): { preset: Preset; confident: boolean } {
  const kind = pickRig(text);
  const preset = PRESETS.find((p) => p.rig === kind) ?? PRESETS[0];
  return { preset, confident: kind !== "rover" || /rover|car|vehicle|wheel|drive|motor|speed|conveyor|cart/i.test(text) };
}

export function presetById(id: string | null | undefined): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}
