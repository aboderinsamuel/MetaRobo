# RoboCraft: audit, architecture and submission

## 1. Executive assessment

**What RoboCraft was:** a strong one-shot pipeline.
- Describe a robot, and Muse Spark designs it in a strict JSON schema.
- RoboCraft sanitises the design, builds it in 3D, and simulates the task with Rapier rigid bodies, cloth and IK.
- It measures joint loads against real actuator ratings.
- The Control Lab adds real parts, C++/WASM control engineering, validation and firmware.

**The biggest limitation:** the AI designed once and stopped. When the physics found a problem (an overloaded joint, a step that failed, a robot that would tip over), a human had to read the report and fix it, or press one deterministic "upsize" button. The model never saw the consequences of its own design.

**What changed:** RoboCraft now has a closed engineering loop.
- Muse Wonder plans and decides through Model API tool calling.
- RoboCraft's own simulation and engineering checks execute and measure.
- The loop is plan → simulate → diagnose → revise → re-simulate, bounded, and it keeps the best design the physics measured.
- The verdict is computed from the simulation, never from the model's claim.

**What makes it distinctive:** the AI is free to propose, and the physics decides. Every number the agent reasons about comes back from deterministic tools, and every revision becomes a version you can inspect and step back from.

## 2. Architecture

```
                   ┌──────────────── browser ─────────────────┐        ┌──── server (key stays here) ────┐
 "a desk robot     │ Create ──► /api/create ─────────────────────────► │ Muse Spark 1.3: design / revise  │
  that hands you   │   │         (strict JSON schema)                  │ (fast, one-shot, cached)         │
  a pen"           │   ▼                                               │                                  │
                   │ sanitise → 3D → Rapier + cloth + IK (worker)      │                                  │
                   │   │                                               │                                  │
                   │ Agent tab: runAgent() loop ──► /api/agent ──────► │ Muse Wonder 1.0: one tool-calling│
                   │   ▲   executes tool calls locally:                │ turn per request; fixed tool list│
                   │   │   inspect_design · run_simulation ·           │ cached by exact request, costed, │
                   │   │   revise_design (validated ops) · finish      │ daily cap, retry, timeouts       │
                   │   └── results (JSON) back to the model ◄──────────┘                                  │
                   │ best measured design → new version → 3D updates live                                │
                   │ Control Lab: real parts · C++/WASM PlantSim · validation · firmware · SAM 3.1 video │
                   └─────────────────────────────────────────────────────────────────────────────────────┘
```

**New modules:**
- `frontend/src/lib/agent/tools.ts`: deterministic tools. They give the model a description of the design, simulation results as the model sees them, a score and merit function, and a revision language with zod validation. That language has seven operations, all re-sanitised:
  - actuator swap, using datasheet ratings for library parts;
  - joint limits;
  - joint speed;
  - part resize, with children following;
  - object position;
  - object mass;
  - step offset and duration.
- `frontend/src/lib/agent/loop.ts`: the bounded agent loop. Limits are 12 turns, 6 simulations and 4 revisions. It nudges the model when it answers in text instead of a tool call, supports aborting, keeps the best measured design, and overrides the verdict when the numbers disagree with the model.
- `frontend/src/lib/agent/browser.ts`: the model proxy client and a dedicated simulation worker.
- `frontend/src/app/api/agent/route.ts`: one Muse Wonder turn. Messages are validated, and the tool list is fixed on the server.
- `frontend/src/lib/meta/client.ts`, `metaChat`: tool-calling Chat Completions with an exact-request cache, cost logging, the daily cap, and a 5xx retry.
- `frontend/src/components/create/AgentPanel.tsx`: the live trace, a before/after comparison, and the verdict.

## 3. Meta tooling audit

| Model / tool | Current usage | Responsibility | Code path | Value |
|---|---|---|---|---|
| **Muse Spark 1.3** | Live | Designs robots and their task (`robot_design`), revises them (`robot_design_revision`), models plants, designs Lab assemblies, explains controller responses, reviews feasibility, finds real parts with web search | `lib/create/ai.ts`, `lib/lab/ai.ts`, `lib/meta/client.ts` (`metaJson`, `metaWebSearch`) via `/api/create`, `/api/lab/model`, `/api/lab/explain` | **Deep / essential** |
| **Muse Spark 1.3 (vision)** | Live | Reads keyframes from a phone video: the robot, its moving parts, objects, sizes from known references (`video_scene`) | `lib/create/ai.ts` `readScene`, `/api/create/vision` | Useful |
| **Muse Wonder 1.0** | **New, live-ready** | The engineering agent: plans, calls tools, diagnoses simulation failures, revises, re-simulates | `lib/agent/*`, `/api/agent`, `metaChat` | **Deep / essential** (the closed loop exists because of it) |
| **SAM 3.1** | Live | Tracks the real robot through a video. In Create, the tracked path is overlaid on the simulated one; in the Lab, the boxes become step-response data the engine fits a plant to | `lib/meta/sam.ts`, `/api/lab/track`, `lib/lab/video.ts` | Useful. It's honest about scale: real length comes from a known object size, and there's no depth claimed from pixels. |
| **Muse Image 1.0** | Not in the app | Used to make the launch film | n/a | Unused in the product |
| **Muse Voice Transcribe 1.0** | Not used | Dictation uses the browser's Web Speech API | n/a | Unused (a candidate) |
| **Muse Code** | **Not used** | Not available in this environment; development was done with Claude Code | n/a | Unused |
| Muse Spark Open / Glimmer | Not used | Open-weight; no Model API ID | n/a | Not relevant yet (a possible future for offline control next to the robot) |

## 4. Verification

**Automated, offline:**
- 135 Vitest tests pass, 6 of them new for the agent:
  - tool definitions;
  - rejection of malformed changes and unknown tools;
  - datasheet ratings applied over model claims, with l_/r_ mirroring;
  - the closed loop end to end on the real physics with a scripted model;
  - the turn and budget limits;
  - best-design retention.
- Type-check and lint are clean.

The closed-loop test proves three real defects that the simulation found in an arm with an undersized shoulder servo:
- the shoulder pulled 2.65 N·m on a 0.5 N·m MG996R;
- the elbow pulled 0.89 on 0.75;
- it would tip over.

The agent fixed all three, and the physics confirmed it:

| | Errors | Overloaded joints | Steps | Mass |
|---|---|---|---|---|
| Before | 2 | 2 | 6/6 | 1.27 kg |
| After | 0 | 0 | 6/6 | 2.0 kg |
| Verdict | | | | **validated** |

**Manual:** the Agent tab renders in Create, `/api/agent` reports `muse-wonder-1.0` and live, and `?example=` opens a ready-made robot.

**Not yet verified:** a live Muse Wonder run. It needs your approval to spend credit. The ready-made desk buddy currently fails 5 of its 16 steps in simulation, which makes it a real first target.

## 5. Scores (internal estimate, not official)

Weights are the working matrix from the brief. Check them against the participant rulebook.

| Criterion | Before | Now | Evidence | What would raise it |
|---|---|---|---|---|
| Impact (30%) | 7 | 7.5 | Turns a sentence into a design with real parts, physics and firmware; physics-checked AI is credible for education, prototyping and makers | A real robot built from a RoboCraft bill of materials, with before/after footage |
| Meta tooling (25%) | 6.5 | 8.5 | Spark (text and vision), SAM 3.1, and now Wonder doing genuine agentic tool calling against deterministic tools | Live Wonder runs recorded in the demo; Voice Transcribe for dictation |
| Demo (25%) | 7 | 8 (once a live run is recorded) | The closed loop is visible: failures, a diagnosis, a revision, a re-simulation, before/after numbers | Film the agent fixing the desk buddy live |
| Technical depth (20%) | 8 | 8.5 | C++/WASM engine, Rapier + cloth + IK, sanitiser, bounded agent with validated ops, 135 tests | Agent benchmarks across all four examples |

## 6. Two-minute demo (only implemented features)

| Time | Screen | Say |
|---|---|---|
| 0:00 | Create, the prompt typed | "Describe a robot in one sentence." |
| 0:10 | Muse Spark's design appears in 3D and runs its task | "Muse Spark designs the whole machine: body, joints, actuators, the room, the task. Then RoboCraft simulates it with real physics." |
| 0:30 | The Task tab: 11 of 16 steps succeed, the failures listed | "The physics finds what doesn't work." |
| 0:40 | Agent tab → Run | "So Muse Wonder takes over, as an engineering agent." |
| 0:45 | Trace: inspect → simulate (baseline) → revise (the rationale cites measured numbers) → simulate | "It reads the measurements, diagnoses the cause, changes the design, and re-runs the simulation. It never grades its own work: the physics does." |
| 1:15 | Before/after card, the verdict chip, the new version in the history; the 3D robot completing the steps | "Before and after, measured. Every revision is a version you can step back from." |
| 1:30 | Open in Control Lab → X-ray → swap a part → validation → firmware | "Then real parts, real wiring, checks and firmware." |
| 1:50 | Close | "Propose with AI. Validate with physics." |

**Contingency:** every Muse Wonder turn is cached by its exact request, so a run recorded once replays for free. If the network fails during the demo, play the cached run.

## 7. Submission description

**RoboCraft:** describe a robot, and AI engineers it until the physics says it works.

**Problem:** building robots means CAD, part sheets, simulators, control maths and firmware, in separate tools. Mistakes surface on the bench, after the money is spent. Generative AI makes shapes, not machines that work.

**Solution:** RoboCraft divides the work three ways.
- **Muse Spark** designs a complete machine from one sentence: joints, real actuators, the environment and the task.
- **RoboCraft's deterministic stack** builds and simulates it: Rapier rigid bodies, cloth, inverse kinematics, actuator load checks, and a C++/WebAssembly control engine.
- **Muse Wonder**, as a tool-calling engineering agent, closes the loop: it simulates, diagnoses failures from the measurements, revises the design, and re-simulates until the physics validates it or it reports an honest limitation.

SAM 3.1 tracks the real robot on video against the simulation.

**What's innovative:** the AI is creative but never graded by itself. Every result, verdict and before/after number comes from the physics, and every revision is a version you can step back from.

**Meta AI:**
- Muse Spark 1.3: design and vision.
- Muse Wonder 1.0: the agentic engineering loop.
- SAM 3.1: video tracking.

**Measured:** in the test suite, the agent turns an arm with 2 hardware errors and 2 overloaded joints into a design with 0 and 0, verified by re-simulation. 135 automated tests cover the pipeline.

**Next:** benchmark the agent across every example design, add Muse Voice Transcribe for dictation, export URDF, and flash firmware over Web Serial.
