// Light patterns for LED strings, strips and single LEDs. One definition, used three ways: the 3D
// view lights each LED from it, and the Arduino / Verilog / VHDL generators (firmware.ts) implement
// exactly the same maths, so what you see in the simulation is what the generated code does.
//
// Every pattern repeats every `periodS` seconds. "Channels" are what the controller can actually
// switch: every pixel on an addressable (WS2812) string, or a few MOSFET-switched strands on a
// plain string. LED i follows channel i % channels.

export const LIGHT_PATTERNS = ["steady", "blink", "alternate", "chase", "twinkle", "fade", "rainbow"] as const;
export type LightPattern = (typeof LIGHT_PATTERNS)[number];

export interface LightSpec {
  /** id of the LED / LED string part */
  part: string;
  pattern: LightPattern;
  /** seconds for one full cycle of the pattern */
  periodS: number;
  /** #rrggbb, LED i takes colors[i % colors.length] (rainbow ignores them) */
  colors: string[];
  /** "always": runs whenever the controller is powered; "rules": only while a rule switches it on */
  trigger: "always" | "rules";
  /** Plain (non-addressable) strings: how many separately switched strands (1-16), one MOSFET /
   * pin each. Addressable strings ignore it: every pixel is its own channel. */
  channels: number;
}

/** How many channels the controller really switches for this light. */
export function channelsOf(spec: Pick<LightSpec, "channels">, leds: { count: number; addressable: boolean } | undefined): number {
  if (!leds) return 1;
  return leds.addressable ? leds.count : Math.max(1, Math.min(16, Math.round(spec.channels || 1), leds.count));
}

export const PATTERN_INFO: Record<LightPattern, string> = {
  steady: "all on",
  blink: "all on, then all off",
  alternate: "odd and even LEDs swap",
  chase: "a group of lit LEDs runs along the string",
  twinkle: "random LEDs sparkle (16-bit LFSR, same sequence as the code)",
  fade: "all LEDs breathe up and down",
  rainbow: "colours flow along the string (addressable LEDs only)",
};

/** 16-bit Galois LFSR, taps 0xB400, seed 0xACE1: identical in the Arduino and HDL code. */
const LFSR_SEED = 0xace1;
const lfsrCache: number[] = [LFSR_SEED];
export function lfsrAt(step: number): number {
  const s = Math.max(0, Math.floor(step)) % 65535;
  while (lfsrCache.length <= s) {
    const v = lfsrCache[lfsrCache.length - 1];
    lfsrCache.push((v >> 1) ^ (v & 1 ? 0xb400 : 0));
  }
  return lfsrCache[s];
}

/** The chase's lit tail: 3 LEDs on longer strings, 1 on a handful of channels. */
export const chaseTail = (channels: number) => (channels >= 10 ? 3 : 1);

/** Twinkle re-rolls 4 times per period. */
export const TWINKLE_STEPS = 4;

/**
 * Brightness 0..1 of channel c (of `channels`) at time t seconds, exactly as the generated code
 * computes it.
 */
export function channelLevel(pattern: LightPattern, periodS: number, c: number, channels: number, t: number): number {
  const period = Math.max(0.05, periodS);
  const phase = (((t % period) + period) % period) / period;
  switch (pattern) {
    case "steady":
    case "rainbow":
      return 1;
    case "blink":
      return phase < 0.5 ? 1 : 0;
    case "alternate":
      return c % 2 === 0 === phase < 0.5 ? 1 : 0;
    case "chase": {
      const head = Math.floor(phase * channels) % channels;
      const d = (((head - c) % channels) + channels) % channels;
      return d < chaseTail(channels) ? 1 : 0;
    }
    case "twinkle": {
      const step = Math.floor(t / (period / TWINKLE_STEPS));
      return (lfsrAt(step + Math.floor(c / 16)) >> c % 16) & 1;
    }
    case "fade":
      // Triangle wave: what a PWM counter ramping up and down produces.
      return 1 - Math.abs(2 * phase - 1);
  }
}

function hueToRgb(h: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h * 6) % 6;
    return Math.max(0, Math.min(1, Math.abs(k - 3) - 1));
  };
  return [f(5), f(3), f(1)];
}

function hexRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [1, 0.85, 0.6];
  const v = parseInt(m[1], 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

/** Colour (0..1 rgb, already scaled by brightness) of LED i of `count` at time t. */
export function ledColor(spec: Pick<LightSpec, "pattern" | "periodS" | "colors">, i: number, count: number, channels: number, t: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const ch = Math.max(1, channels);
  const c = i % ch;
  const level = channelLevel(spec.pattern, spec.periodS, c, ch, t);
  let rgb: [number, number, number];
  if (spec.pattern === "rainbow" && ch > 1) {
    const period = Math.max(0.05, spec.periodS);
    rgb = hueToRgb((((c / ch + t / period) % 1) + 1) % 1);
  } else {
    rgb = hexRgb(spec.colors.length ? spec.colors[c % spec.colors.length] : "#ffd9a0");
  }
  out[0] = rgb[0] * level;
  out[1] = rgb[1] * level;
  out[2] = rgb[2] * level;
  return out;
}
