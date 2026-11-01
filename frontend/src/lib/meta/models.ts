// The Meta models a user can choose between. The server only ever accepts these ids.
export const MODEL_CHOICES = [
  { id: "muse-spark-1.3", name: "Muse Spark", note: "Fast and interactive. About 4× cheaper." },
  { id: "muse-wonder-1.0", name: "Muse Wonder", note: "Deeper reasoning for long, multi-step work. Slower, about 4× the cost." },
] as const;

export type ModelChoice = (typeof MODEL_CHOICES)[number]["id"];

export function pickModel(raw: unknown, fallback: ModelChoice): ModelChoice {
  return MODEL_CHOICES.some((m) => m.id === raw) ? (raw as ModelChoice) : fallback;
}
