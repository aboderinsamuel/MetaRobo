export const HEARTBEAT = `// RoboCraft · physical proof · Uno R3
// Two short pulses, then a pause. No external parts.
void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
  Serial.begin(9600);
}
void loop() {
  Serial.println("ROBOCRAFT heartbeat: two pulses");
  for (int pulse = 0; pulse < 2; pulse++) {
    digitalWrite(LED_BUILTIN, HIGH);
    delay(150);
    digitalWrite(LED_BUILTIN, LOW);
    delay(150);
  }
  delay(1200);
}
`;
export type Recipe = {
  id: string;
  name: string;
  group: string;
  description: string;
  parts: string;
  wiring: [string, string][];
  note: string;
  code: string;
};
export const RECIPES: Recipe[] = [
  {
    id: "heartbeat",
    name: "Board heartbeat",
    group: "Start here",
    description: "Your first physical proof. Two amber pulses, one quiet pause.",
    parts: "Uno R3 + USB data cable",
    wiring: [
      ["USB-B", "Computer USB"],
      ["D13 / L LED", "Already wired on your Uno"],
    ],
    note: "No breadboard needed. Watch the amber L LED, not the green power light.",
    code: HEARTBEAT,
  },
  {
    id: "led",
    name: "Breadboard LED",
    group: "Light",
    description: "Make a real LED breathe with PWM.",
    parts: "LED · 220 Ω resistor · breadboard · jumper wires",
    wiring: [
      ["D9", "220 Ω resistor → LED anode (+)"],
      ["LED cathode (−)", "GND"],
    ],
    note: "Unplug USB before wiring. The resistor limits LED current. Breadboard rows connect internally; the center gap separates them.",
    code: `void setup() { pinMode(9, OUTPUT); }
void loop() {
  for (int v = 0; v <= 255; v++) { analogWrite(9, v); delay(6); }
  for (int v = 255; v >= 0; v--) { analogWrite(9, v); delay(6); }
}
`,
  },
  {
    id: "button",
    name: "Push-button light",
    group: "Input",
    description: "Press a button to light the onboard LED.",
    parts: "Push button · breadboard · jumper wires",
    wiring: [
      ["D2", "One side of push button"],
      ["GND", "Opposite switch contact"],
    ],
    note: "Uses the Uno's internal pull-up. A pressed button reads LOW. Check which contacts your button joins.",
    code: `void setup() {
  pinMode(2, INPUT_PULLUP);
  pinMode(LED_BUILTIN, OUTPUT);
}
void loop() { digitalWrite(LED_BUILTIN, digitalRead(2) == LOW); }
`,
  },
  {
    id: "pot",
    name: "Analog explorer",
    group: "Input",
    description: "Turn a knob and read live values over USB.",
    parts: "10 kΩ potentiometer · breadboard · wires",
    wiring: [
      ["Pot outer pins", "5V and GND"],
      ["Pot center wiper", "A0"],
    ],
    note: "Open the serial monitor at 9600 baud. A0 reads 0–1023; never apply more than 5V.",
    code: `void setup() { Serial.begin(9600); }
void loop() {
  Serial.println(analogRead(A0));
  delay(100);
}
`,
  },
  {
    id: "buzzer",
    name: "Tiny melody",
    group: "Sound",
    description: "Play three notes with a passive piezo buzzer.",
    parts: "Passive piezo buzzer · wires",
    wiring: [
      ["Piezo +", "D8"],
      ["Piezo −", "GND"],
    ],
    note: "Use a low-current passive piezo, not a speaker or high-current buzzer. tone() uses Timer2.",
    code: `void setup() { pinMode(8, OUTPUT); }
void loop() {
  tone(8, 262, 150); delay(200);
  tone(8, 330, 150); delay(200);
  tone(8, 392, 300); delay(1000);
}
`,
  },
  {
    id: "servo",
    name: "Servo sweep",
    group: "Motion",
    description: "Move a hobby servo through a gentle 60° arc.",
    parts: "SG90 servo · regulated external 5V supply · wires",
    wiring: [
      ["Servo signal (orange)", "D9"],
      ["Servo red", "External regulated 5V"],
      ["Servo brown + supply GND", "Uno GND (common ground)"],
    ],
    note: "Power the servo separately. Keep its mechanism unloaded; do not connect external 5V to the Uno 5V pin while USB is attached.",
    code: `#include <Servo.h>
Servo arm;
void setup() { arm.attach(9); arm.write(90); }
void loop() {
  for (int angle = 60; angle <= 120; angle++) { arm.write(angle); delay(25); }
  for (int angle = 120; angle >= 60; angle--) { arm.write(angle); delay(25); }
}
`,
  },
  {
    id: "distance",
    name: "Distance radar",
    group: "Sensor",
    description: "Read an HC-SR04 ultrasonic sensor in centimeters.",
    parts: "HC-SR04 · breadboard · wires",
    wiring: [
      ["VCC / GND", "5V / GND"],
      ["TRIG", "D7"],
      ["ECHO", "D6"],
    ],
    note: "This wiring is for a 5V Uno. A 3.3V board needs level shifting on ECHO.",
    code: `void setup() {
  pinMode(7, OUTPUT); pinMode(6, INPUT); Serial.begin(9600);
}
void loop() {
  digitalWrite(7, LOW); delayMicroseconds(2);
  digitalWrite(7, HIGH); delayMicroseconds(10); digitalWrite(7, LOW);
  unsigned long us = pulseIn(6, HIGH, 30000);
  if (us) Serial.println(us * 0.0343 / 2.0);
  else Serial.println("out of range");
  delay(100);
}
`,
  },
  {
    id: "lcd",
    name: "Hello, LCD",
    group: "Display",
    description: "Write your first message on a 16×2 character display.",
    parts: "HD44780 16×2 parallel LCD · 10 kΩ pot · 220 Ω resistor",
    wiring: [
      ["LCD VSS, RW, K", "GND"],
      ["LCD VDD", "5V"],
      ["LCD VO", "Pot wiper; outer pins to 5V/GND"],
      ["LCD RS, E", "D12, D11"],
      ["LCD D4, D5, D6, D7", "D5, D4, D3, D2"],
      ["LCD A", "5V through 220 Ω resistor"],
    ],
    note: "For a parallel HD44780 display, not an I²C backpack. Check your module's pin labels and backlight rating.",
    code: `#include <LiquidCrystal.h>
LiquidCrystal lcd(12, 11, 5, 4, 3, 2);
void setup() { lcd.begin(16, 2); lcd.print("Hello, RoboCraft!"); }
void loop() { lcd.setCursor(0, 1); lcd.print(millis() / 1000); }
`,
  },
  {
    id: "light",
    name: "Light sensor",
    group: "Sensor",
    description: "Measure the room's light with a simple voltage divider.",
    parts: "Photoresistor · 10 kΩ resistor · breadboard",
    wiring: [
      ["Photoresistor leg 1", "5V"],
      ["Photoresistor leg 2", "A0 and 10 kΩ resistor"],
      ["Other resistor leg", "GND"],
    ],
    note: "Readings are relative light levels, not calibrated lux. Open the serial monitor at 9600 baud.",
    code: `void setup() { Serial.begin(9600); }
void loop() { Serial.println(analogRead(A0)); delay(150); }
`,
  },
  {
    id: "stepper",
    name: "Stepper quarter turn",
    group: "Motion",
    description: "Turn a 28BYJ-48 through its ULN2003 driver.",
    parts: "28BYJ-48 · ULN2003 board · external regulated 5V",
    wiring: [
      ["ULN2003 IN1, IN2, IN3, IN4", "D8, D9, D10, D11"],
      ["Driver + / −", "External 5V / GND"],
      ["Driver GND", "Uno GND"],
      ["Motor connector", "ULN2003 motor socket"],
    ],
    note: "Never power a motor from an I/O pin. This example uses 2048 full steps/revolution; gear ratios vary. Disconnect power before wiring.",
    code: `#include <Stepper.h>
Stepper motor(2048, 8, 10, 9, 11);
void setup() { motor.setSpeed(8); }
void loop() { motor.step(512); delay(1000); motor.step(-512); delay(1000); }
`,
  },
];
export const HDL_START = `// FPGA draft only — cannot run on an Arduino Uno.
// Set CLOCK_HZ to your FPGA oscillator and assign led in its constraints file.
module heartbeat #(parameter CLOCK_HZ = 50000000)(
  input wire clk, input wire reset, output reg led
);
  reg [31:0] count;
  always @(posedge clk) begin
    if (reset) begin count <= 0; led <= 0; end
    else if (count == CLOCK_HZ / 2 - 1) begin count <= 0; led <= ~led; end
    else count <= count + 1;
  end
endmodule
`;
export const VHDL_START = `-- FPGA draft only. Assign pins in your FPGA toolchain.
library ieee;
use ieee.std_logic_1164.all;
entity heartbeat is
  generic (CLOCK_HZ : positive := 50000000);
  port (clk, reset : in std_logic; led : out std_logic);
end entity;
architecture rtl of heartbeat is
  signal count : natural range 0 to CLOCK_HZ / 2 - 1 := 0;
  signal state : std_logic := '0';
begin
  led <= state;
  process(clk) begin
    if rising_edge(clk) then
      if reset = '1' then count <= 0; state <= '0';
      elsif count = CLOCK_HZ / 2 - 1 then count <= 0; state <= not state;
      else count <= count + 1;
      end if;
    end if;
  end process;
end architecture;
`;
