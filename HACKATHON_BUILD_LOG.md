# RoboCraft: hackathon build log

Meta Global AI Developer Hackathon, Push the Frontier track. Building period: **Oct 27 – Nov 4, 2026**.

Everything below comes from this repository's git history (`git log --date=iso`). Commit timestamps were never rewritten. Times are the author's local time (UTC+1).

## What existed before kickoff

The author states that nothing predates the hackathon: the first commit is **Oct 27, 20:16**, and there are no earlier commits in this repository.

One note for reviewers: that first commit is large. It contains the Control Lab, the C++ PlantSim engine, and a FastAPI backend that its commit message calls "the original studio from the MVP". Judges reading the history may ask about it, so it's stated here rather than left to be discovered.

## Build log

| Date | Commit | Feature | Meta model / tool | Verification |
|---|---|---|---|---|
| Oct 27 20:16 | `79edc33` | Control Lab: hardware builds from real parts, C++17 PlantSim engine compiled to WebAssembly, live 3D rigs, validation, firmware | n/a (an earlier Claude-based modeller, replaced on Oct 28) | Engine: native build with 21 analytic checks |
| Oct 28 11:27 | `1e2a923` `0fe62b2` `808beb2` | Smooth 3D playback, motion programs; Vercel deployment as one project | n/a | Deployed |
| Oct 28 13:07 | `dcf4a57` | Onboarding and Simple mode | n/a | Manual |
| Oct 28 19:48 | `a259cbd` | **Control Lab AI moved to Meta Muse Spark** (plant modelling, explanations) | Muse Spark 1.3 (Chat Completions, strict JSON schema) | Live calls recorded in the usage log |
| Oct 28 21:54 | `bfd0cb8` | Live agent trace (a recorded Muse Spark run checked by the WASM engine), daily spend cap | Muse Spark 1.3 | Replayed run, engine-checked in the browser |
| Oct 28 23:35 | `d13d41f` | AI-engineered machines: feasibility review, 3D assembly design, part editing, **video → model with SAM 3.1** | Muse Spark 1.3, **SAM 3.1** | Unit tests; live tracking call |
| Oct 29 08:39 – 10:06 | `b3bd148` `1c8afe9` `9f08981` `1de6c5e` | Machines built only from real buyable parts; every actuator simulated; machine-specific coach and checks | Muse Spark 1.3 | Unit tests |
| Oct 29 18:15 | `0a7f8a8` | **Create: describe any robot → Muse Spark designs it → Rapier rigid-body + cloth physics with IK task planning.** Muse Spark vision reads phone video. | Muse Spark 1.3 (text + vision), SAM 3.1 | Unit tests (kinematics, IK, simulation); live humanoid, biped, drone and dog designs |
| Oct 29 20:07 | `64b207a` | Any AI design → Control Lab with real actuators sized by measured load | n/a (deterministic converter) | Unit tests |
| Oct 29 23:19 – Oct 30 00:10 | `c22709b` `1e5a24f` `8afe369` `b4237f2` | Landing page, README, banner | Film made with Muse Wonder and Muse Image (outside the app) | n/a |
| Oct 30 06:41 | `2b8e71e` | Create onboarding, ready-made robots (real Muse Spark designs shipped as examples) | Muse Spark 1.3 (designs) | Unit test: every example loads as a working design |
| Oct 30 20:26 | `eed7d46` | Vercel Analytics | n/a | Page view confirmed on the live site |
| Oct 31 | *(uncommitted when written)* | **Muse Wonder engineering agent**: a closed loop of plan → simulate → diagnose → revise → re-simulate, using Model API tool calling against RoboCraft's deterministic physics and engineering tools | **Muse Wonder 1.0** (Chat Completions tool calling) | 6 new tests: the loop runs end to end on the real physics with a scripted model (2 errors / 2 overloaded joints → 0 / 0, verdict computed from the simulation), is bounded, rejects bad arguments, and keeps the best measured design. 135/135 tests pass. |

## Muse Code

Muse Code was **not** used in this build. The development work above was done by the author with Claude Code. Nothing here should be read as Muse Code output.
