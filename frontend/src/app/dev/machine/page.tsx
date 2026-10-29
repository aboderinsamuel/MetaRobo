import { notFound } from "next/navigation";
import MachinePreview from "./MachinePreview";

// Development-only harness: renders a fixed test assembly through the real machine renderer, so the
// 3D can be checked without a paid Muse Spark call. Not available in production. ?f=plant picks the
// plant-waterer fixture.
export default async function Page({ searchParams }: { searchParams: Promise<{ f?: string; t?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const { f, t } = await searchParams;
  return <MachinePreview which={f === "plant" ? "plant" : "waver"} freeze={t !== undefined ? Number(t) : undefined} />;
}
