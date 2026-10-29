// Firmware for an AI-designed machine, generated from the design itself: the pins come from its
// wiring (the controller-side pin names of every connection), the motion from its program, and the
// logic from its sensor signals and rules (with the same hysteresis the simulation uses). Servo
// joints go through a PCA9685 if the design has one, otherwise straight to PWM pins.
import { catalogOf, type Assembly, type PartSpec } from "./assembly";

const ident = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "_").replace(/^(\d)/, "_$1").toUpperCase() || "PART";

/** The controller-side pin wired to a part (first connection between them). */
function pinTo(a: Assembly, ctrl: PartSpec, partId: string): string | undefined {
  for (const c of a.connections) {
    if (c.from === ctrl.id && c.to === partId) return c.fromPin;
    if (c.to === ctrl.id && c.from === partId) return c.toPin;
  }
  return undefined;
}

/** Arduino pin token for a pin name: "D7" → 7, "A0" → A0, "GPIO13" → 13, else the name. */
function pinToken(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const n = name.trim().toUpperCase();
  let m = /^(?:D|GPIO|IO|PIN)?(\d{1,2})$/.exec(n);
  if (m) return m[1];
  m = /^A(\d)$/.exec(n);
  if (m) return `A${m[1]}`;
  return undefined;
}

export function machineFirmware(a: Assembly): { text: string; filename: string; board: string } {
  const ctrl = a.parts.find((p) => catalogOf(p)?.category === "controller");
  const board = ctrl ? (catalogOf(ctrl)?.name ?? ctrl.name) : "Arduino Uno";
  const esp = /esp32/i.test(board);
  const pca = a.parts.find((p) => p.catalogId === "pca9685");
  const lines: string[] = [];
  const decl: string[] = [];
  const setup: string[] = [];
  const loop: string[] = [];
  const includes = new Set<string>();
  const unwired: string[] = [];
  let nextPin = esp ? 13 : 2;
  const freePin = () => String(nextPin++);
  const pinFor = (p: PartSpec, analog = false) => {
    const t = ctrl ? pinToken(pinTo(a, ctrl, p.id)) : undefined;
    if (t) return t;
    unwired.push(p.name);
    return analog ? (esp ? "34" : "A0") : freePin();
  };

  // ---- servo joints and the motion program
  const servoJoints = a.joints.filter((j) => {
    const act = a.parts.find((p) => p.id === j.actuator);
    return act && ["servo", "kit"].includes(catalogOf(act)?.category ?? "") && (j.kind === "rotate" || j.kind === "articulate");
  });
  if (servoJoints.length) {
    if (pca) {
      includes.add("#include <Wire.h>").add("#include <Adafruit_PWMServoDriver.h>");
      decl.push("Adafruit_PWMServoDriver pwm;  // PCA9685 servo driver on I2C");
      setup.push("  pwm.begin();", "  pwm.setOscillatorFrequency(27000000);", "  pwm.setPWMFreq(50);");
    } else {
      includes.add(esp ? "#include <ESP32Servo.h>" : "#include <Servo.h>");
    }
    servoJoints.forEach((j, i) => {
      const act = a.parts.find((p) => p.id === j.actuator)!;
      const name = ident(j.id);
      if (pca) decl.push(`const int CH_${name} = ${i};  // ${act.name} (PCA9685 channel)`);
      else {
        decl.push(`Servo servo_${name};  // ${act.name}`);
        setup.push(`  servo_${name}.attach(${pinFor(act)});`);
      }
    });
    decl.push(`float angle[${servoJoints.length}];`);
    lines.push(
      "",
      "// Move a servo joint, in degrees from its centre (calibrate centre and direction on the real build).",
      "void setJoint(int i, float deg) {",
      "  angle[i] = deg;",
      pca ? "  pwm.writeMicroseconds(i, 1500 + constrain(deg, -90, 90) * 1000.0 / 90.0);" : `  switch (i) {\n${servoJoints.map((j, i) => `    case ${i}: servo_${ident(j.id)}.write(90 + constrain(deg, -90, 90)); break;`).join("\n")}\n  }`,
      "}",
      "",
      "// Ease every listed joint to its target over ms (like the simulation's motion profile).",
      "void moveTo(const float* target, const bool* use, unsigned long ms) {",
      `  float from[${servoJoints.length}];`,
      `  for (int i = 0; i < ${servoJoints.length}; i++) from[i] = angle[i];`,
      "  const int frames = max(1UL, ms / 20);",
      "  for (int f = 1; f <= frames; f++) {",
      "    float u = (float)f / frames;",
      "    u = u * u * (3 - 2 * u);",
      `    for (int i = 0; i < ${servoJoints.length}; i++) if (use[i]) setJoint(i, from[i] + (target[i] - from[i]) * u);`,
      "    delay(20);",
      "    senseAndReact();",
      "  }",
      "}",
    );
    const program = a.program.map((step) => {
      const target = servoJoints.map((j) => step.targets.find((t) => t.joint === j.id));
      return `  { // ${step.label}\n    const float t[] = {${target.map((t) => (t ? (t.value * (servoJoints.find((x) => x.id === t.joint)!.kind === "articulate" ? 90 : 1)).toFixed(1) : "0")).join(", ")}};\n    const bool u[] = {${target.map((t) => (t ? "true" : "false")).join(", ")}};\n    moveTo(t, u, ${Math.round(step.duration * 1000)});\n  }`;
    });
    if (program.length) loop.push("  // The motion program", ...program);
  }

  // ---- sensors, rules and outputs
  const outputs = new Map<string, string>();
  for (const s of a.signals) {
    const sensor = a.parts.find((p) => p.id === s.sensor);
    if (!sensor) continue;
    const pin = pinFor(sensor, true);
    decl.push(`const int PIN_${ident(s.id)} = ${pin};  // ${sensor.name}`);
    lines.push(
      "",
      `// ${s.name} in ${s.unit || "units"}: maps the raw reading to ${s.min}–${s.max}. Calibrate both ends on the real sensor.`,
      `float read_${ident(s.id).toLowerCase()}() {`,
      `  float raw = analogRead(PIN_${ident(s.id)}) / ${esp ? "4095.0" : "1023.0"};`,
      `  return ${s.min} + raw * (${s.max} - ${s.min});`,
      "}",
    );
  }
  for (const r of a.rules)
    for (const o of r.outputs) {
      const part = a.parts.find((p) => p.id === o.part);
      if (!part || outputs.has(part.id) || o.action === "display") continue;
      const pin = pinFor(part);
      outputs.set(part.id, pin);
      decl.push(`const int PIN_${ident(part.id)} = ${pin};  // ${part.name}`);
      setup.push(`  pinMode(PIN_${ident(part.id)}, OUTPUT);`);
    }
  const lcd = a.parts.find((p) => p.catalogId === "lcd1602-i2c");
  if (lcd) {
    includes.add("#include <Wire.h>").add("#include <LiquidCrystal_I2C.h>");
    decl.push("LiquidCrystal_I2C lcd(0x27, 16, 2);  // LCD 16x2 on I2C");
    setup.push("  lcd.init();", "  lcd.backlight();");
  }
  if (a.rules.length) {
    decl.push(`bool active[${a.rules.length}];`);
    const body = a.rules.map((r, i) => {
      const read = `read_${ident(r.signal).toLowerCase()}()`;
      const enter = r.op === "<" ? `v < ${r.value}` : `v > ${r.value}`;
      const stay = r.op === "<" ? `v < ${r.value + r.hysteresis}` : `v > ${r.value - r.hysteresis}`;
      const outs = r.outputs
        .map((o) => {
          const id = ident(o.part);
          if (o.action === "display") return lcd ? `    if (active[${i}]) { lcd.setCursor(0, 0); lcd.print(${JSON.stringify(o.text.split("\\n")[0].replace(/\{\w+\}/g, "").slice(0, 16))}); }` : "";
          if (o.action === "beep") return `    digitalWrite(PIN_${id}, active[${i}] && (millis() / 500) % 2 ? HIGH : LOW);  // beep`;
          return `    digitalWrite(PIN_${id}, active[${i}] ? HIGH : LOW);`;
        })
        .filter(Boolean)
        .join("\n");
      return `  {\n    float v = ${read};\n    // ${r.signal} ${r.op} ${r.value}, released ${r.hysteresis} past it (hysteresis, as simulated)\n    active[${i}] = active[${i}] ? (${stay}) : (${enter});\n${outs}\n  }`;
    });
    lines.push("", "// The controller's rules, checked continuously (also while joints are moving).", "void senseAndReact() {", ...body, "}");
  } else lines.push("", "void senseAndReact() {}");
  if (!loop.length) loop.push("  senseAndReact();", "  delay(50);");
  else loop.push("  delay(1000);");

  const text = [
    `// ${a.title}: firmware generated by RoboCraft from the design (${board}).`,
    "// Pins follow the design's wiring; motions follow its program; logic follows its rules.",
    unwired.length ? `// NOTE: no wire to the controller for ${[...new Set(unwired)].join(", ")}: free pins were assigned; wire them or edit the pins.` : "// Every pin below comes from a connection in the design.",
    "",
    ...includes,
    "",
    ...decl,
    ...lines,
    "",
    "void setup() {",
    `  Serial.begin(115200);`,
    ...setup,
    "}",
    "",
    "void loop() {",
    ...loop,
    "}",
    "",
  ].join("\n");
  return { text, filename: `${a.title.replace(/\W+/g, "_").toLowerCase()}.ino`, board };
}
