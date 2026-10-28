# MetaRobo: Hackathon Plan

Living plan for the **Meta Global AI Developer Hackathon**. Update it as we go: tick boxes, record decisions, adjust dates.

- **Track:** Push the Frontier (robotics, understanding and controlling physical systems)
- **Building period:** Oct 27 to Nov 4, 2026
- **Submission deadline:** Wed, Nov 4, 9:00 PM ET (our target: submit by **Nov 3**)
- **Judging:** Nov 5 to 8 · **Closing ceremony:** Mon, Nov 9, 12:00 PM ET (top 5 per track)
- **Budget:** $150 Meta Model API credit (claimed). Baseten / Modal credits: apply.

---

## 1. Pitch

> **Film your robot. RoboCraft works out how it really behaves, tunes a controller, checks it in simulation, and hands you firmware that works.**

An AI agent for physical systems that gets its work checked: every suggestion from Muse Spark is run in a real physics engine (C++17 compiled to WASM) and must pass numeric checks before it is used. This ties directly to the "Agents 102: Best Practices for Verifiable Agents" session.

## 2. Stage One blocker (must fix first)

The AI layer currently runs on **Anthropic Claude** (`frontend/src/lib/lab/ai.ts`, `MODEL_ID = "claude-opus-5-5"`). Stage One is pass/fail on using Meta's models, so this has to move to **Muse Spark via the Meta Model API** before anything else.

## 3. How each Meta model fits

| Model | Job in RoboCraft | Priority |
|---|---|---|
| **Muse Spark** | Main reasoning agent: describe a robot → physics model → controller settings → read the simulation → fix → repeat | Must |
| **SAM 3.1** | Headline feature: phone video of the real robot → track it frame by frame → motion curve → fit a physics model | Must |
| **Muse Spark (vision)** | Read the scene: robot type, a known-size object for scale, which parts move | Must |
| **Muse Voice Transcribe** | "Say it" input (the landing page already shows "LISTENING") | Should |
| **Muse Spark Open** (Baseten/Modal) | Offline mode that runs on a laptop next to the robot | Nice to have |
| **Muse Code** | Use while building; mention in the README | Free win |

Skip Muse Image unless a real use appears. Bolted-on model calls hurt with judges.

## 4. How we win

1. **Real robot in the video.** Wobbly with bad tuning → film it → model learned → flash new firmware → smooth motion. Real before/after hardware footage.
2. **Show numbers.** Benchmark: how often Muse Spark's first suggestion fails its targets vs. after the check-and-fix loop. Put the table in the README.
3. **Make the agent's work visible.** Show each suggestion, simulation run, pass/fail and fix as it happens.
4. **Spell out what's new.** "Built during the hackathon" section in the README with commit dates (all commits are Oct 27 or later).
5. **Submit early** (Nov 3), then resubmit with the final video.

## 5. Schedule and checklist

### Oct 28–29: Move to Meta's models
- [x] Get Meta Model API key; confirm endpoint, model IDs, and SDK/HTTP format from the docs
- [x] Replace the Anthropic client in `frontend/src/lib/lab/ai.ts` with Muse Spark
- [x] Keep structured outputs (zod schemas) working and keep the offline fallback (`presets.ts` / `advisor.ts`)
- [x] Remove `@anthropic-ai/sdk` from `frontend/package.json`; update env var names and docs
- [x] Verify end to end in the running app

### Oct 29–30: Meta-inspired redesign (our own brand)
- [x] Check Meta's developer brand guidelines (none published → plain-text "Powered by Meta Muse"); use an official "Built with Meta" badge only if allowed, else plain-text "Powered by Meta Muse". **No Meta logo otherwise** (rights rule + impersonation risk).
- [x] Design tokens: Meta-style blue-to-violet gradient, Figtree font (dark theme only)
- [x] Signature motif: animated ∞ control loop (sense → think → act → check) with a travelling light pulse
- [x] Landing page: loop hero, "Model stack" flow diagram (Voice Transcribe → Muse Spark → SAM 3.1 → engine check → firmware) with animated connections, live agent trace, "Built during the hackathon", pricing
- [x] Lab: pipeline strip lighting up the active Meta model per step + token/cost meter
- [x] Animations with `motion`; respect reduced-motion settings

### Revenue: sponsored parts
- [ ] Sponsored placements in generated parts lists, clearly labelled, affiliate links, from a config file
- [ ] Impression and click counts
- [x] Pricing section (Free / Maker / Classroom)

### Oct 30–31: Video to physics model (SAM 3.1)
- [ ] Video upload in the lab UI (cap ~10 s)
- [ ] Muse Spark vision: identify the robot, scale reference, moving part
- [ ] SAM 3.1: segment and track the moving part (sample a few frames per second, cache results)
- [ ] Turn tracks into a motion curve (pixels → real units using scale)
- [ ] Fit a plant model in the backend; overlay measured vs. simulated response

### Nov 1: Visible agent loop + voice
- [ ] Agent loop: propose → simulate → check against specs → revise, with a live trace in the UI
- [ ] Muse Voice Transcribe for "say it" input

### Nov 2: Hardware day
- [ ] Export firmware for the chosen board
- [ ] Film "before" (bad tuning) and "after" (tuned) on the real robot

### Nov 3: Evidence and first submission
- [ ] Benchmark script + results table in the README
- [ ] README: pitch, architecture, Meta models used, "Built during the hackathon" section
- [ ] Public deploy (Vercel) and **make the GitHub repo public**
- [ ] Submit an early version on the CV platform

### Nov 4: Final video and resubmit (before 9:00 PM ET)
- [ ] Record the 3-minute video (script below)
- [ ] Check repo is public, video link works, all team members listed
- [ ] Final submission

## 6. Three-minute video script

| Time | Shot |
|---|---|
| 0:00–0:15 | Hook: the real robot wobbling with bad tuning |
| 0:15–1:30 | Film it, upload; SAM tracks it; the model is fitted; measured vs. simulated overlay |
| 1:30–2:15 | Muse Spark tunes the controller; the checks pass and fail live |
| 2:15–2:45 | Flash the firmware; the robot moves smoothly |
| 2:45–3:00 | Benchmark number + "built in 9 days" |

The video must only show work built during the hackathon.

## 7. Budget: protect the $150 credit

The goal is to finish with most of the $150 unspent. Live Meta API calls are the exception, not the default.

**Development and tests**
- Live calls are **off by default**. They only happen when an explicit flag is set (e.g. `META_LIVE=1`); otherwise every route uses the offline fallback (`presets.ts` / `advisor.ts`).
- Automated tests **never** call the API. They use recorded responses (fixtures) saved from a single live call.
- Smoke tests are one call at a time, run on purpose, never in loops or watch mode.
- Claude Code does not make live API calls without saying so first.

**Every call**
- Cache responses on disk, keyed by a hash of model + prompt + inputs. The same request never costs twice.
- Keep prompts short and set a tight `max_tokens` on every request.
- Use the smallest Muse model that does the job; save the larger one for the reasoning step.
- Cap the agent's propose-simulate-fix loop (e.g. 3 rounds), and let the physics engine do the checking for free.
- Log tokens and estimated cost for each call, with a running total.

**SAM 3.1 / video (the main cost)**
- Clips capped at ~10 s, a few frames per second, downscaled before upload.
- Cache every result. The demo video is processed once and replayed from the cache.

**Public web deploy**
- Built-in demo robots are served from cached responses: zero credit.
- Live AI only for new user input, with a per-visitor rate limit and a global daily spend cap. When the cap is hit, the app quietly falls back to offline mode instead of breaking.
- API key stays server-side only.

**Billing safety net**
- Spend notifications on the Meta billing page at $25, $50 and $100.
- Check actual spend against our log at the end of each day.

## 8. Open questions

- [ ] Judging rubric (came through as "[table]"; paste it here)
- [ ] Prize tables for our track (paste here)
- [ ] Hardware available: robot car / servo arm / Arduino / ESP32?
- [ ] Team or solo? Indie or Startup track?

## 9. Decisions log

| Date | Decision |
|---|---|
| 2026-10-28 | Track: Push the Frontier. Pitch: an AI agent for robots that gets its work checked by a physics engine. |
| 2026-10-28 | First task: replace Claude with Muse Spark (Stage One blocker). |
