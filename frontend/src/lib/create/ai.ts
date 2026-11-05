// Muse Spark as the designer. It designs the robot the user describes from scratch: proportions,
// shells, joints, hands, materials, the environment and an executable task. Nothing is picked
// from a template. The app then validates it, builds the geometry and physics, and simulates it.
//
// Also: revising an existing design from a plain-language change (ids kept stable so versions
// compare), and reading a scene from video keyframes with Muse Spark vision.
import { z } from "zod";
import { metaJson, type JsonResult } from "@/lib/meta/client";
import { hardwareGuide } from "@/lib/lab/assembly";
import { CATALOG } from "@/lib/lab/catalog/parts";
import type { CallUsage } from "@/lib/lab/types";
import { DesignOut, MATERIALS, sanitizeDesign, type Design } from "./design";

const ACTUATORS = CATALOG.filter((c) => c.actuator || c.category === "controller" || c.category === "sensor" || c.category === "power")
  .map((c) => `${c.id} (${c.name}${c.actuator ? `, ${(c.actuator.stallKgcm * 0.098).toFixed(2)} N·m` : ""})`)
  .join("; ");

export const DESIGNER_GUIDE = `You are the lead industrial designer and mechanical engineer at a robotics studio. Design exactly the machine the user describes, as a convincing, buildable product: the right proportions, real mechanisms, finished surfaces. You are not limited to any template or parts kit; you compose the robot from geometric primitives the way a CAD designer would.

COORDINATES: metres, y up, floor at y = 0. The robot starts at the origin facing +z (its front, face and work area are towards +z; its left is +x). Every node's position is its joint pivot relative to its parent's pivot; rotations are degrees X, Y, Z relative to the parent. A node's shape is placed by offset/orient relative to its own pivot: e.g. an upper arm pivots at the shoulder, so its shape's offset is [0, -length/2, 0] when it hangs down.

BUILD QUALITY (this is what makes it look real):
- Structure + covers: a structural link per segment (brushed_aluminium / carbon_fiber / painted_metal) with shells over it (gloss_plastic, soft_touch or painted_metal with bevel, or lathe profiles for rounded forms). Use lathe for heads, domes, torsos, cans and smooth limbs; extrude for brackets, plates, fingers and panels with real outlines; box with bevel for housings; tube for cables, hoses and handles.
- Every shape is centred on its offset, lathes included: a lathe profile 0.44 m tall that should start at its pivot gets offset [0, 0.22, 0].
- Orientation: cylinders, capsules and lathes run along their local y; set orient to turn them (orient [0, 0, 90] → along x, [90, 0, 0] → along z): wheels, portholes, round doors, drums' axes and joint housings must point the right way.
- A cylindrical joint_housing (actuator) at every joint, its axis along the joint axis, sized to its torque (humanoid shoulder ≈ Ø0.09 m, elbow Ø0.07, wrist Ø0.045, finger Ø0.012).
- Details that sell it: a face screen or visor (screen material, emissive eyes), camera / depth-sensor modules, cable runs (tube), rubber foot pads and finger pads, vents, panel seams, an accent colour.
- A coherent palette: 2-3 main colours plus dark joints and one accent. Materials: ${MATERIALS.join(", ")}.
- Realistic sizes: an adult humanoid 1.55-1.80 m, shoulder width ≈ 0.42 m, upper arm 0.28 m, forearm 0.26 m, hand 0.18 m, thigh 0.42 m, shin 0.40 m. Industrial arms, rovers, quadrupeds and appliances at their real-world sizes.
- 60-120 nodes for a humanoid (counting a mirrored limb once), 20-60 for simpler machines. Detail is what makes it read as real.

REFERENCE BUILD (how a convincing 1.65 m service humanoid is layered; adapt the idea to whatever you design, don't copy it):
- Pelvis: a bevelled box (painted_metal, dark) at y ≈ 0.95 with a soft_touch belt (torus). Waist pitch + waist yaw joints with visible housings.
- Torso: a gloss_plastic lathe shell, e.g. points [[0.11,0],[0.16,0.07],[0.175,0.24],[0.16,0.36],[0.1,0.44]] (radius, height), over a darker structural core; a chest plate (extrude) standing slightly proud of the shell's front; a battery pack (bevelled box) on the back; shoulder yokes.
- Head: a lathe shell like [[0,0],[0.08,0.01],[0.105,0.07],[0.1,0.15],[0.06,0.2],[0,0.21]]; a visor (bevelled box, screen material) placed ON the front surface (its z offset = the head's radius there, so it isn't buried inside); two emissive eyes just in front of the visor; ear sensor pods (cylinders along x); a camera module on top.
- Arms: shoulder pitch and roll housings (cylinders along their axes), an upper-arm structure (carbon_fiber or brushed_aluminium capsule) inside a tapered gloss shell (lathe), elbow housing, forearm shell, wrist pitch / roll housings, a soft_touch palm (bevelled box) with four fingers of three phalanges (capsules ≈ 0.018 m thick with rubber pads) and an opposable thumb on the palm's side; a cable (tube) along the arm.
- Legs: hip housings, thigh structure + tapered shell, a knee housing with a knee cap (flattened sphere), shin shell, ankle pitch / roll housings, a foot (bevelled box) with a rubber sole and a toe cap.
- Every shell is a little larger than the structure it covers and every joint shows its housing; that layering, plus a consistent palette, is what makes it look engineered. Arms, rovers, drones and appliances get the same care: housings, covers, fasteners-scale details, cables, sensors.

JOINTS: revolute (axis + limits in degrees) or prismatic (metres). Use real ranges (elbow 0..145, knee 0..140, shoulder pitch -180..60). Every actuated joint names a real actuator: a catalogue id from [${ACTUATORS}] or "need:<real product>" (e.g. "need:CubeMars AK70-10", "need:Unitree Go1 joint motor", "need:Dynamixel XM540-W270"), its rated torque in N·m (force in N for prismatic) and its speed. Size actuators to their loads: the simulation checks torque against your ratings. Required torque ≈ 9.81 × mass carried (kg) × lever (m) × 2 for margin. As a guide, a 1.6 m, 50-70 kg humanoid needs roughly hips 80-150 N·m, knees 100-200, ankles 60-120, waist 40-80, shoulders 25-60, elbows 15-30, wrists 3-8 (quasi-direct-drive or harmonic-drive actuators, not hobby servos); a desk robot under 1 kg uses hobby / smart servos (0.2-2 N·m). Quote rated (continuous) torque, not stall.
Arms: shoulder pitch (axis x), shoulder roll (z), upper-arm yaw (y), elbow (x), wrist pitch (x) and wrist roll (y) give a dexterous arm. Legs: hip pitch/roll/yaw, knee, ankle pitch/roll.

HANDS AND GRIPPERS: an effector is a palm (role palm) with fingers (role finger) as its children; each finger joint closes towards its max. Humanoid hands: a thumb and 3-4 fingers, each 2-3 phalanges (extrude or capsule, rubber/silicone_skin pads). Grippers: two or three fingers or parallel jaws. The effector tip is the point between the fingertips, in the palm's frame. Give a realistic payload.

MIRRORING: design the left arm / leg once with ids starting "l_" and set mirror: true on its first node (e.g. l_shoulder); the right side is generated. Name left parts "Left …". Left is +x.

MOBILITY: fixed, wheels, legs, tracks or flying, with a realistic speed (humanoid walk 0.3-0.6 m/s, drone 1-5 m/s). Drones are "flying": they take off, cruise and hover over what they work on; give propellers revolute joints about their vertical axis and ids containing "prop" so they spin in flight. A fixed robot's work objects must sit within 80% of its arm's reach of its base. For legs, list the gait: hip pitch ±18-25°, knee ±25-35° (phase offset 0.25), opposite leg phase +0.5.

SCENE: build the environment the task needs, at real sizes and laid out like a real room: furniture and appliances as static objects composed of several shapes (a washing machine: a white box body, a drum inside its front opening, a round glass door as a child object hinged on a vertical axis with its pivot at the hinge edge, a control panel); containers as bin (baskets, boxes, trays) or drum shapes; things the robot moves as rigid objects with real masses; garments, towels and sheets as cloth with their flat size (t-shirt ≈ 0.5 × 0.7 m) dropped a few cm above where they lie. Put work surfaces at real heights (table 0.75 m, counter 0.9 m). Leave walking space (≥ 0.6 m) between stations. Legged robots crouch to reach low things, but nothing the robot must reach should be lower than 0.25 m unless it has the legs to get down there. Colours matter when the task is about them.

GROUNDED AND PLAUSIBLE: it must work the way a real machine would. Its base stands on the floor, or sits upright on top of a surface or mount that exists in the scene (clamped onto a desk top, bolted to a stand); never floating, never hanging off an edge, never upside down unless it is a real ceiling-mounted design with its mount in the scene. Its work is in front of it (+z), within comfortable reach, at a height it can get to. Pick the simplest machine a real engineer would build for the job (pressing a game controller's buttons: a small desk arm or a button-pressing rig beside the controller, not a humanoid). Proportions follow real products. Arms hang clear of the body: shoulders wider than the hips, so the hands never sit inside the thighs or hips.

TASK: an executable plan, 8-40 steps, using only these actions with ids from your design: move_to (always with the target object you're going to; the robot stands in front of it, facing it), reach, grasp, lift, place, release, fold, open, close, pose, wait. Pick and place is reach → grasp → lift → place → release. Move to a station before working there. Open a door before putting things through it. Handle each item explicitly (no "repeat"). Labels describe the action in plain words. Durations realistic (1-4 s per motion).

NOTES: honest engineering caveats: what would be hard to build, what the simulation can't show. No marketing.

REAL HARDWARE: everything you design is built with real, buyable parts inside it, so name real actuators (with their real ratings) on every joint and a real controller, power source and sensors. The body you design is the robot's real exterior (printed, moulded or machined shells over the real parts), so keep it as realistic as the product would be.

HARDWARE ENGINE (hardware): if the robot is a wheeled car / rover, a single powered arm joint, a two-wheel self-balancer or a multirotor, also pick its drivetrain electronics from this list (kind, then one part id per slot, matched to each other, plus geometry / mass / mission values in SI units within the ranges). Any other robot: kind "none".
${hardwareGuide()}`;

// Low reasoning effort first: most of a design's wait is the model thinking before it writes, and
// both Muse Spark and Muse Wonder design well at low effort (the physics checks the result anyway).
const DESIGN_ATTEMPTS = [
  { maxTokens: 40000, effort: "low" as const },
  { maxTokens: 40000, effort: "minimal" as const },
];
const REVISE_ATTEMPTS = [
  { maxTokens: 40000, effort: "low" as const },
  { maxTokens: 40000, effort: "minimal" as const },
];

function callUsage(r: JsonResult<unknown>): CallUsage {
  return { model: r.model, cached: r.cached, tokens: r.usage.inputTokens + r.usage.outputTokens, costUsd: r.usage.costUsd };
}

async function withRetry<T>(attempts: number, fn: (attempt: number) => Promise<T>): Promise<T> {
  let error: unknown;
  for (let a = 0; a < attempts; a++) {
    try {
      return await fn(a);
    } catch (err) {
      error = err;
    }
  }
  throw error;
}

/** Design a new machine from a description (and, optionally, what Muse Spark saw in a video). */
export async function designFromPrompt(prompt: string, observed?: string, model?: string): Promise<{ design: Design; usage: CallUsage }> {
  return withRetry(DESIGN_ATTEMPTS.length, async (a) => {
    const res = await metaJson({
      schema: DesignOut,
      schemaName: "robot_design",
      system: DESIGNER_GUIDE,
      user: [`Design this: ${prompt}`, observed ? `\nWhat the camera saw (use it for the scene layout, sizes and the robot's form):\n${observed}` : ""].join(""),
      ...DESIGN_ATTEMPTS[a],
      model,
    });
    return { design: sanitizeDesign(res.data, 1), usage: callUsage(res) };
  });
}

/** Revise a design from a plain-language change; ids stay stable so versions can be compared. */
export async function reviseDesign(current: Design, change: string, history: string[], model?: string): Promise<{ design: Design; usage: CallUsage }> {
  const { version, ...ai } = current;
  return withRetry(REVISE_ATTEMPTS.length, async (a) => {
    const res = await metaJson({
      schema: DesignOut,
      schemaName: "robot_design_revision",
      system: `${DESIGNER_GUIDE}\n\nREVISING: you are given the current design as JSON. Apply the requested change and return the COMPLETE revised design. Keep every node, object and step that the change doesn't affect exactly as it is, with the same ids. If the change adds things (an environment, a second arm, a new task), integrate them properly: positions, joints, task steps.`,
      user: [history.length ? `Earlier changes, oldest first:\n${history.map((h) => `- ${h}`).join("\n")}\n` : "", `Current design:\n${JSON.stringify(ai)}\n\nChange: ${change}`].join("\n"),
      ...REVISE_ATTEMPTS[a],
      model,
    });
    return { design: sanitizeDesign(res.data, version + 1), usage: callUsage(res) };
  });
}

// ------------------------------------------------------------------------------ vision

export const SceneOut = z.object({
  summary: z.string().describe("One or two sentences: what the video shows"),
  robot: z.object({
    present: z.boolean(),
    kind: z.string().describe("e.g. 'two-finger desk arm', 'wheeled rover', 'humanoid'; '' if none"),
    description: z.string().describe("Its form: segments, joints, materials, colours, approximate sizes in metres"),
    movingParts: z.array(z.object({ part: z.string(), motion: z.string().describe("how it moves: axis, range, speed, as observed") })),
  }),
  objects: z.array(
    z.object({
      name: z.string(),
      kind: z.enum(["furniture", "container", "object", "cloth", "appliance", "other"]),
      sizeM: z.array(z.number()).describe("[w, h, d] estimated in metres using the scale references"),
      where: z.string().describe("Position relative to the robot / other objects"),
      color: z.string().describe("#rrggbb"),
    }),
  ),
  scaleReferences: z.array(z.object({ object: z.string(), knownSizeM: z.number(), note: z.string() })).describe("Objects of known size used to judge scale (a sheet of A4, a soda can, a door)"),
  trackPrompt: z.string().describe("A short noun phrase SAM 3.1 should track to follow the robot's moving part, e.g. 'robot gripper'"),
  suggestedPrompt: z.string().describe("A design prompt that recreates this robot and scene, with sizes"),
});
export type SceneObservation = z.infer<typeof SceneOut>;

/** Muse Spark vision: read keyframes from a video into a structured scene description. */
export async function readScene(images: string[], note: string): Promise<{ scene: SceneObservation; usage: CallUsage }> {
  const res = await metaJson({
    schema: SceneOut,
    schemaName: "video_scene",
    system: "You are a robotics engineer reading a phone video of a robot and its surroundings. The images are keyframes in time order. Identify the robot, its moving parts and how they move between frames, and every object relevant to its task. Estimate real sizes in metres from objects of known size. Be precise and honest about uncertainty.",
    user: `Keyframes from the video, in order.${note ? ` The user says: ${note}` : ""}`,
    images: images.slice(0, 12),
    maxTokens: 8000,
    effort: "low",
  });
  return { scene: res.data, usage: callUsage(res) };
}
