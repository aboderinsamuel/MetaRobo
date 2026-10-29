import { notFound } from "next/navigation";
import MachinePreview from "./MachinePreview";

// Development-only harness: renders a fixed test assembly through the real machine renderer, so the
// 3D can be checked without a paid Muse Spark call. Not available in production.
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <MachinePreview />;
}
