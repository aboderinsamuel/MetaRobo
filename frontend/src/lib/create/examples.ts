// Ready-made robots for Create: real Muse Spark designs, shipped as static files in
// public/examples. Anyone can open one instantly, with no AI call, so a first visit (or a demo
// with live AI paused) still lands on a working robot in its world.
import { sanitizeDesign, type Design, type DesignAi } from "./design";

export interface Example {
  id: string;
  title: string;
  /** what it does, in a few words */
  blurb: string;
  /** the request it was designed from, shown in the project history */
  prompt: string;
}

export const EXAMPLES: Example[] = [
  {
    id: "laundry-humanoid",
    title: "Laundry humanoid",
    blurb: "Sorts clothes, loads the washer, folds a shirt",
    prompt: "A realistic home humanoid robot that collects dirty clothes, sorts them by colour, loads a front-loading washing machine, then folds a clean shirt on a table",
  },
  {
    id: "robot-dog",
    title: "Pocket robot dog",
    blurb: "Trots across the room to fetch a ball",
    prompt: "A small realistic robotic dog that walks across the room and fetches a ball",
  },
  {
    id: "desk-buddy",
    title: "Desk buddy",
    blurb: "Waves hello and hands you a pen",
    prompt: "A friendly desk companion robot with a round screen face and two small arms that waves and hands you a pen",
  },
  {
    id: "water-carrier",
    title: "Water carrier",
    blurb: "Grips a bucket and carries it across the yard",
    prompt: "A wheeled robot with two arms that picks up a bucket of water by its handle and carries it to the garden",
  },
];

export async function loadExample(id: string): Promise<Design> {
  const res = await fetch(`/examples/${id}.json`);
  if (!res.ok) throw new Error(`Couldn't load the example (HTTP ${res.status}).`);
  return sanitizeDesign((await res.json()) as DesignAi);
}
