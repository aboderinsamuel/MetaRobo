# RoboCraft

RoboCraft has two tools:

- **Control Lab** (`/lab`, new): describe a physical system in plain words, by voice, or with step-response
  data. RoboCraft builds a mathematical model, proposes a PID or state-feedback controller, simulates it in a
  C++ engine compiled to WebAssembly, explains why the response overshoots or oscillates, and iterates with
  you until it meets your specs. Then it validates the design and writes the firmware.
- **Robot builder** (`/studio/arm`, `/studio/rover`): the original MVP described further down.

## Control Lab

| Step | What happens | Where |
| --- | --- | --- |
| Describe | Text, dictation (Web Speech API) or a CSV step test (`t,u,y`) | `src/components/lab/panels.tsx` |
| Build the hardware | Every design is one of four machines (rover, 3-axis arm, self-balancing robot, quadcopter) built from real parts: motors, drivers, batteries, boards, sensors and props, plus dimensions and payload. Any description (typed, spoken or Claude-modelled) is mapped to the closest machine and sized from the words ("climb 2 m with a 200 g camera"). | `src/lib/lab/hardware/parts.ts`, `build.ts`, `src/components/lab/hwpanels.tsx` |
| Model | The plant comes from the part datasheets: motor R, Kt, Ke from stall and no-load points, inertia from masses and geometry, actuator limits from the battery minus the driver drop, sensor latency and noise from the sensor. Swap a part and the physics changes. Uploaded step data is fitted (FOPDT / second order) by the engine instead. | `src/lib/lab/hardware/build.ts`, `data.ts` |
| Control | PID (filtered derivative, anti-windup) or LQR with starting weights | `src/lib/lab/analysis.ts` |
| Simulate | PlantSim engine: RK4, dead time, saturation, noise, load steps, closed-loop poles, Bode margins, LQR, system ID | `engine/src/plantsim.cpp` |
| Watch it move | The 3D view fills the lab: the machine is drawn from the selected parts (gearmotor sizes, L298N heatsink, LiPo packs, ESP32 shield, prop sizes) and driven by the simulation with play / scrub / slow-motion. Motors glow with current, drivers heat up past their rating, wires show current flow, and parts that fail a check are outlined with a callout. Rover climbs a ramp, the arm does pick-and-place and releases the part, the balancer leans by its tilt state and falls when unstable, the drone climbs on its thrust through a down-gust. Click a part to inspect or swap it in place. A live scope (output and motor current) is docked under the view; the full scope, poles/Bode, wiring, validation and firmware are views you switch to. | `src/components/lab/HardwareView.tsx`, `hw3d/` |
| Design checks | Electrical and mechanical rules from the original studio: driver voltage and current, stall and battery current, motor over/under-volting, 5 V rail and level shifting (auto-added), fuses and noise caps (auto-added), top speed, ramp torque, traction, holding torque and max payload, tip-over, fit on the chassis, gripper clearance, lean recovery, IMU rate, thrust-to-weight, ESC cell range, prop matching, altimeter range. Live checks use the simulated motor current, saturation and loop bandwidth. Each failing check names the part and offers a one-click fix. Bill of materials with CSV export, auto-generated wiring diagram. | `src/lib/lab/hardware/build.ts` |
| Explain & iterate | Claude (or the offline advisor) explains the response from the poles, damping, margins and saturation, and proposes fixes with predicted metrics. "Iterate" applies the best fix until the specs pass; "Auto-tune" runs a simulator-in-the-loop search in a Web Worker that also keeps the motor current inside the driver's rating. | `src/app/api/lab/explain`, `src/lib/lab/advisor.ts` |
| Validate | 8 checks: stability, margins, specs, actuator limits, ±30% model error, sensor noise, load disturbance, WASM-vs-TS cross-check | `src/lib/lab/validate.ts` |
| Code | Arduino C++ for the same discrete controller | `src/lib/lab/codegen.ts` |

### Run it

```bash
cd frontend
cp .env.example .env.local     # optional: add ANTHROPIC_API_KEY for the Claude modeler/explainer
npm install
npm run dev                    # http://localhost:3000 (landing) and /lab (studio)
```

### The engine (C++ → WebAssembly)

`engine/` is a dependency-free C++17 library with a flat C ABI (`src/api.cpp`). The same source is built two ways:

```bash
npm run engine:test   # native build + 21 analytic checks; also writes engine/tests/golden.json
npm run engine:wasm   # needs Emscripten on PATH; writes frontend/public/engine/plantsim.wasm
```

Emscripten setup on Windows: clone `https://github.com/emscripten-core/emsdk`, run
`emsdk install latest` and `emsdk activate latest`, then in PowerShell run `emsdk_env.ps1` before
the build. The compiled `plantsim.wasm` (about 94 KB) is checked in, so deployments don't need Emscripten.

The browser loads `public/engine/plantsim.wasm` when it exists. If it is missing, the app uses
`src/lib/sim/core.ts`, a line-for-line TypeScript port. The badge in the lab header shows which engine runs.

### Tests

```bash
cd frontend && npm test
```

- The TypeScript engine reproduces the C++ golden data (responses to 1e-9, poles, margins).
- Analytic checks: first- and second-order responses, overshoot formula, poles, phase margin, LQR on a double
  integrator, inverted-pendulum stabilisation, and system identification.
- Every preset auto-tunes to meet its specs and passes validation with no failures.
- `tests/wasm.test.ts` loads the real `plantsim.wasm` and checks it against the TypeScript engine on
  every preset (responses within 1e-9, poles, margins).
- `tests/hardware.test.ts`: every part option derives finite physics; default builds are buildable with
  consistent wiring; wrong hardware is caught (weak shoulder motor, tipping arm, motors that don't fit,
  unreachable cruise speed, over-voltage, 6S on a 4S ESC, thrust-to-weight, altimeter range) and the suggested
  fixes resolve it; auto-tune meets the arm's specs inside the L298N's current rating; description hints.
- Descriptions map to the right hardware rig ("segway that falls over" → balancing robot, etc.).

The landing page runs the analytic suite live in the browser on whichever engine is loaded.

---

# Robot builder (MVP)

RoboCraft is a web app that walks beginners from an idea to a working robot. You shape the
robot in 3D. RoboCraft then does the maths and physics, picks the parts, wires a circuit
that won't damage the board, and writes the firmware.

This folder holds the **Phase 1 MVP** from the architecture document: two pre-rigged
templates (a **3-axis arm** and a **differential-drive rover**) running through all four
engines.

![Arm studio](docs/arm-studio.png)

| Rover driving a simulated figure-8 | Auto-generated wiring (ESP32 + level shifter added for safety) |
| --- | --- |
| ![Rover simulation](docs/rover-simulation.png) | ![Wiring diagram](docs/wiring-diagram.png) |

## What the MVP does

| Engine | Arm template | Rover template |
| --- | --- | --- |
| **Spatial** (Next.js + React Three Fiber) | Live 3D arm, sliders for every link, draggable IK target, reach envelope, centre-of-mass marker, pick-and-place playback with a carried payload | Live 3D rover (2WD + caster or 4WD), sensor stopping zone, playback of square / figure-8 / spin programs with spinning wheels |
| **Mechanical** (FastAPI + NumPy) | Standard DH model, FK, closed-form IK (elbow-up, reach-over-the-top, unreachable targets projected onto the workspace), worst-case gravity + inertia torque over a 5° sweep of the whole workspace, max payload, tip-over check with ballast suggestion, speed/acceleration-limited quintic trajectories | Drive-force budget (rolling resistance, slope, acceleration), wheel RPM, torque and power per motor, traction limit, differential-drive kinematics, exact rest-to-rest path simulation with acceleration ramps |
| **Electrical** (rule engine + PostgreSQL component library) | Servo selection with ≥10% headroom, servo masses fed back into the torque sizing until stable, dedicated servo rail, auto-added buck converter / fuse / switch / bulk capacitor, current and logic-level checks | Joint search over motor × driver × battery, L298N / TB6612FNG / MDD10A wiring, 5 V logic rail (L298N regulator or auto-added buck when a 3S pack exceeds 12 V), auto-added logic level converter for 3.3 V boards, noise capacitors, fuse sizing, runtime estimate |
| **Code generation** (Jinja2 templates) | Arduino C++ (Uno, Nano, ESP32, Pico) and MicroPython (ESP32, Pico): the same IK in firmware, serial commands, calibration constants, the same pick-and-place demo | Arduino C++ and MicroPython: driver-specific motor code, coordinated soft-start ramps, obstacle stop, the same demo programs as the simulator |

Every rule result is shown to the user as a check (pass, info, warning or error). Each
check says why it matters and what to do, and the parts RoboCraft added for safety are
labelled as auto-fixes. Designs can be saved as projects, exported as JSON, and the bill of
materials can be downloaded as CSV.

## Quick start

### Option A: Docker (PostgreSQL + API + web app)

```bash
cd robocraft
docker compose up --build
# open http://localhost:3000   (API docs: http://localhost:8000/docs)
```

### Option B: run locally (SQLite, no database server needed)

```bash
# 1. API (Python 3.11+)
cd robocraft/backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload            # http://localhost:8000/docs

# 2. Web app (Node 20+), in a second terminal
cd robocraft/frontend
npm install
npm run dev                              # http://localhost:3000
```

The web app proxies `/api/*` to the backend (`BACKEND_URL`, default
`http://127.0.0.1:8000`), so the browser never needs CORS. Set `DATABASE_URL` (for example
`postgresql+psycopg://user:pass@host/db`) to use PostgreSQL instead of the default
`sqlite:///./robocraft.db`.

### Option C: host it on Vercel (one project, two services)

`vercel.json` at the repository root deploys both halves as **one Vercel project** with two
[services](https://vercel.com/docs/services) on one domain:

| Path | Service | What it is |
| --- | --- | --- |
| `/api/lab/*` | `frontend` | The Control Lab's own routes (Claude modelling and explanations) |
| `/api/*` | `backend` | FastAPI engines for the studio (`backend/`) |
| everything else | `frontend` | Next.js web app (`frontend/`) |

The browser calls `/api/...` on the same origin, so neither service calls the other server-side and
no `BACKEND_URL` is needed on Vercel.

1. On vercel.com choose *Add New → Project*, import this repository and leave the **Root
   Directory** at the repository root. Vercel reads `vercel.json` and builds both services.
2. Optional: under *Storage*, create a **Neon (Postgres)** database and connect it, which sets
   `DATABASE_URL` so saved projects persist. Without it the API uses a throw-away SQLite file in
   `/tmp`.
3. Optional: add `ANTHROPIC_API_KEY` to turn on Claude in the Control Lab. Without it the lab uses
   its offline modeller and advisor.
4. Deploy, then check `https://<project>.vercel.app/api/health` (`{"status":"ok"}`) and
   `https://<project>.vercel.app/api/lab/status`.

To run both services together locally the way Vercel routes them, use `vercel dev` from the
repository root.

Notes:

- **Who can open which URLs.** Vercel protects *preview* deployments so that only members of
  your Vercel team can open them. Production URLs are public.
- **Upload size.** The API bundle is about 130 MB (mostly NumPy), within Vercel's 225 MB
  function limit.

## Architecture

```mermaid
flowchart LR
  subgraph Browser["Browser: Next.js 16 + React Three Fiber + Tailwind"]
    UI[Parameter panel<br/>generated from /api/templates]
    V[3D viewport<br/>IK gizmo, playback]
    I[Insights: checks, mechanics,<br/>electronics, code]
  end
  UI -- "/api/* (Next rewrite)" --> API
  V --> API
  I --> API
  subgraph API["FastAPI"]
    P[pipeline.py] --> M[Mechanical engine<br/>DH / IK / torque / rover physics]
    P --> E[Electrical engine<br/>selection + rule-checked netlist]
    C[Codegen engine<br/>Jinja2 firmware] --> P
  end
  E --> DB[(PostgreSQL / SQLite<br/>components, projects)]
```

A design flows through `pipeline.py`:

1. **Mechanical** sizes torques (arm) or drive forces (rover) for the geometry and payload.
2. **Electrical** picks parts that meet those requirements. The masses of the chosen parts
   go back into step 1, because a heavier elbow servo loads the shoulder, until the
   selection stops changing. It then builds the netlist and runs the safety rules.
3. **Codegen** renders firmware from the design, the pin map chosen by the Electrical
   Engine, and the same motion maths as the simulator.

```
robocraft/
├── backend/
│   ├── app/
│   │   ├── engines/
│   │   │   ├── mechanical/   kinematics.py (batched DH, Jacobians, M(q)), arm.py, rover.py
│   │   │   ├── electrical/   selection.py, netlist.py, arm_circuit.py, rover_circuit.py
│   │   │   └── codegen/      generator.py + templates/*.j2
│   │   ├── data/components.json   component library (seeded/upserted into the DB)
│   │   ├── schemas/          design.py (parameters + UI metadata), api.py
│   │   ├── routers/          catalog.py, engines.py, projects.py
│   │   ├── pipeline.py       engine orchestration
│   │   ├── startup.py        lazy, retrying DB/catalog initialisation (serverless-safe)
│   │   └── main.py           app factory (Vercel auto-detects app/main.py)
│   └── tests/                129 tests, including compiling/running the generated firmware
├── frontend/src/
│   ├── app/                  landing page, /studio/[template]
│   ├── components/studio/    parameter & pose panels, insights tabs, wiring diagram, code viewer
│   ├── components/viewport/  Canvas, ArmModel, RoverModel
│   └── lib/                  API client, zustand store, hooks, playback interpolation
└── docker-compose.yml
```

### API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/templates` | Templates, default designs and the parameter UI spec (ranges, units, groups, options from the component library) |
| GET | `/api/components?category=` | Component library |
| POST | `/api/analyze` | Mechanical + electrical analysis of a design |
| POST | `/api/arm/pose` | FK or IK for one pose, with holding torques, centre of mass and warnings |
| POST | `/api/arm/trajectory` | Quintic, limit-respecting trajectory through waypoints (defaults to the pick-and-place demo) |
| POST | `/api/rover/simulate` | Rover motion for a preset program or custom wheel-speed steps |
| POST | `/api/codegen` | Arduino C++ / MicroPython firmware |
| GET/POST/PUT/DELETE | `/api/projects[/{id}]` | Saved designs |

Interactive docs are at `http://localhost:8000/docs`.

### Component library

The parts live in `backend/app/data/components.json` and are upserted into the `components`
table at start-up. To add a part (for example a new servo), add an entry with the same
`specs` keys as its siblings and restart. The selection logic picks it up automatically.
Ratings are typical hobby-market datasheet values; the UI tells users to check the
datasheet of the exact part they buy.

## Testing

```bash
cd backend && pytest && ruff check .
cd frontend && npm run lint && npm run typecheck && npm run build
```

The backend suite covers:

- DH forward kinematics, Jacobians and inertia against closed-form results.
- IK round trips over random poses, and torques against hand calculations.
- Max payload saturating the limiting joint, stability and ballast, and trajectory speed limits.
- Rover force budgets, and paths that close on themselves.
- Every board × driver netlist.
- Firmware parity:
  - The generated **MicroPython** runs against a fake `machine` module, and its IK must match
    the backend's.
  - The generated **Arduino C++** compiles with `g++ -Wall -Wextra -Werror` against stub
    headers for every board and driver. The arm sketch's `solveIK` runs in a harness and
    must match the backend.

## Design decisions and deviations from the architecture doc

- **Kinematics in NumPy instead of Robotics Toolbox / Pinocchio.** The templates are
  small serial chains. A batched DH implementation of about 150 lines covers the whole
  workspace sweep in about 6 ms, keeps the image small, and is easy to verify. Pinocchio
  becomes worthwhile in Phase 3 (arbitrary kinematic trees from URDF).
- **SQLAlchemy** was picked over Prisma so the ORM lives next to the Python engines. Tables
  are created at start-up (`create_all`); add Alembic once the schema starts changing.
- **Some Phase 2 rules are already in.** The MVP auto-inserts regulators, level shifters,
  fuses and capacitors, because the templates are unsafe without them. The drag-and-drop
  schematic editor is still Phase 2.
- **No user accounts yet.** Projects are stored globally. Authentication is the next backend
  item.

## Roadmap from here

- **Phase 2:** an editable schematic canvas, more boards and drivers (PCA9685, BTS7960,
  steppers with A4988), and wire gauge and connector recommendations.
- **Phase 3:** a freeform sandbox that snaps links together, exports URDF, and runs
  kinematics and dynamics on custom trees (Pinocchio). It would also add closed-loop
  control (encoders, PID) to the generated code.
- **Platform:** user accounts, shareable project links, one-click flashing through Web
  Serial.
