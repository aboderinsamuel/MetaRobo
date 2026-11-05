# Hardware Studio: deployment and bench verification

Hardware Studio lives at `/hardware`. It adds a real path from editable Arduino C++ to a USB-connected Uno R3, while keeping the existing simulator, parts catalogue, and Meta integrations.

## What actually happens

1. Pick one of ten kit recipes or send generated firmware from Control Lab → Firmware → **Open in Hardware Studio**.
2. Edit Arduino C++ yourself or ask Muse Spark / Muse Wonder to propose a complete sketch and wiring. AI changes require review and application before they replace the editor.
3. **Build sketch** produces Intel HEX for `arduino:avr:uno`. The exact bundled heartbeat source uses its checked-in, genuinely compiled image; edits never silently reuse that image.
4. Click **Connect Uno** in desktop Chrome or Edge. The browser asks which USB serial port the site may use. Permission is required; websites cannot silently claim arbitrary hardware.
5. Review the code and actual wiring; check the acknowledgement, then **Upload to Uno**. This replaces the board's current sketch.
6. The browser resets the board, checks ATmega328P signature `1E 95 0F`, writes 128-byte flash pages using STK500v1, reads every written page back, and only then reports success.
7. Observe the real hardware. The heartbeat produces two 150 ms amber flashes followed by a pause. Start the serial monitor at 9600 baud for messages sent by the sketch.

The 3D Uno and its LED are illustrative. A photo, a successful compile, and a passing mock test do not establish physical operation. Record a real upload/readback and the resulting LED pattern for the pitch video. `TX/RX` lights show communication, not a hardware test verdict.

## Support boundaries

| Surface | Supported now | Boundary |
|---|---|---|
| Browser flashing | Uno R3, ATmega328P, standard Optiboot at 115200 | Not Mega, Nano old bootloader, Uno R4, ESP32, or arbitrary USB hardware |
| Visitors | Desktop Chrome / Edge, secure HTTPS or localhost, USB data cable | Some clones need a USB driver already installed in the OS; mobile/Safari/Firefox are not the promised upload path |
| Compiler | Arduino AVR 1.8.6; core, Wire, SPI, EEPROM, Servo 1.2.2, LiquidCrystal 1.0.7, Stepper 1.1.3 | No arbitrary library installation, filesystem includes, inline assembly, or compiler flags |
| Recipes | Onboard heartbeat, LED PWM, button, potentiometer, piezo, servo, HC-SR04, parallel LCD, photoresistor, stepper/ULN2003 | Compiled examples, not a claim that every module in every kit was electrically tested |
| Breadboards | Wiring guides and resistor/power advice | Passive connections: no firmware, USB detection, or automatic wiring inspection |
| AI | Existing Meta model client, budget caps, structured output, proposal review | Requires the existing server-side Meta configuration; AI output still needs review and compilation |
| Verilog / VHDL | Separate editable drafts, AI assistance, source download | FPGA source only; no synthesis, simulation, constraint generation, bitstreams, or Uno upload |

Never drive a motor from an I/O pin. Use the appropriate driver and regulated supply, join grounds, and disconnect power before changing wires. A servo or motor supply must not back-feed the Uno USB 5V rail. For children, have an adult check wiring before powering a new circuit.

## Deploy with your existing Vercel frontend

The frontend keeps its current Next.js architecture. The root `vercel.json` now routes `/api/hardware/*` to the frontend, ahead of the general FastAPI rewrite. The bundled heartbeat JSON is included in the server function trace.

**The compiler is a separate long-running Linux service.** Vercel functions do not automatically contain the AVR compiler or its board libraries. A frontend deployment alone enables the bundled heartbeat; it does not enable arbitrary builds.

1. Build and run `compiler/compose.yml` on your compiler host. Set `COMPILER_TOKEN` to a random secret of at least 24 characters in that host's secret manager/environment. Do not commit it.

   ```sh
   docker compose -f compiler/compose.yml up --build -d
   ```

2. Put the compiler behind an HTTPS reverse proxy accessible to your frontend server. The compose port binds only to the host loopback interface. Preserve the bearer authorization header. No browser CORS access is needed.
3. Set these **server-only** frontend environment variables, then redeploy:

   ```dotenv
   ARDUINO_COMPILER_URL=https://your-private-compiler.example
   ARDUINO_COMPILER_TOKEN=the-same-secret
   ```

4. Keep your existing Meta variables (`MODEL_API_KEY`, `META_LIVE=1`, `META_DAILY_BUDGET_USD`) when enabling live AI. No keys go to the browser.
5. Open `/hardware`. The compiler status should say connected. Try **Breadboard LED → Build sketch** without connecting hardware to validate the remote compile path.

The compile worker accepts one request at a time, bounds source/log sizes, has a 90-second process-group timeout, rejects unknown targets, and removes each temporary job directory. The supplied container runs without root, with a read-only filesystem, dropped capabilities, no-new-privileges, a limited temporary filesystem, memory/CPU/process limits, and a restricted include/assembly policy. It does not execute compiled sketches on the server. Keep it isolated from application credentials and sensitive mounts. For an open public service, also configure request quotas/authentication and egress restrictions at your hosting gateway; this prototype has no durable per-user quota service. Do not expose the raw worker without its bearer credential.

## Local development

Visitors need no IDE. Maintainers need the Arduino toolchain only to run a compiler host or rebuild the bundled binary.

```sh
arduino-cli core update-index
arduino-cli core install arduino:avr@1.8.6
arduino-cli lib install Servo@1.2.2 LiquidCrystal@1.0.7 Stepper@1.1.3
```

For local trusted-source development, set `COMPILER_TOKEN`, optionally `ARDUINO_CLI` to the CLI executable, and run `node compiler/server.mjs`. Set `HOST=127.0.0.1` to keep this development process local. Point the frontend's `.env.local` at `http://127.0.0.1:8080` with the same token. Use the restricted container for hosted compilation of untrusted code.

From `frontend/`:

```sh
npm ci
npm run hardware:build-demo
npm run typecheck
npm test
npm run build
npm run dev
```

`hardware:build-demo` compiles all ten recipes using the real AVR compiler and refreshes `src/data/uno-heartbeat.json` with the HEX image, exact source SHA-256, target, and compiler log. Set `ARDUINO_CLI` if the executable is not on PATH. It never uploads to a board.

For the complete local workflow, run `npm run dev:hardware` instead of `npm run dev`. It starts a loopback-only compiler and Next.js with a fresh shared token held only in process memory. It uses `ARDUINO_CLI`, or the local `.tools/arduino-cli/arduino-cli.exe` when available. This command is for a trusted development laptop; it does not deploy the production worker. Run `node --test compiler/policy.test.mjs compiler/integration.test.mjs` from the repo root with `ARDUINO_CLI` configured to verify the service policy and an actual compile round trip.

## Bench acceptance checklist

- Open `/hardware` in desktop Chrome or Edge on HTTPS/localhost.
- Choose Board heartbeat, select the Uno USB port, build, review, and upload.
- Require **Flash verified**; then observe two short amber `L` flashes repeating. Record the board and screen together.
- Open serial at 9600. Require actual `ROBOCRAFT heartbeat: two pulses` messages.
- With the compiler configured, change the blink delay, build again, upload, and verify the changed physical timing. This establishes that source edits affect the device.
- Test unplugging mid-upload: success must not appear; reconnect and re-upload.
- Try a custom syntax error: compiler diagnostics should appear, with no USB write.
- Never use an onboard blink as evidence that motors, sensors, or an entire generated robot have been validated.

## Sources

- [Chrome Web Serial guide](https://developer.chrome.com/docs/capabilities/serial/) — permission, secure context, streams, DTR/RTS.
- [Arduino CLI commands](https://docs.arduino.cc/arduino-cli/commands) — target-specific compilation and binaries.
- [Optiboot bootloader source](https://github.com/Optiboot/optiboot/blob/master/optiboot/bootloaders/optiboot/optiboot.c) — the Uno bootloader's STK500 programming protocol.
