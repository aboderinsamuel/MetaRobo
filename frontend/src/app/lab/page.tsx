import type { Metadata } from "next";
import Lab from "@/components/lab/Lab";

export const metadata: Metadata = {
  title: "Control Lab",
  description: "Build a robot from real parts, watch it move in 3D, and let Robo help you fix it. Simple mode for beginners, Pro mode for engineers.",
};

export default async function LabPage(props: PageProps<"/lab">) {
  const sp = await props.searchParams;
  const preset = typeof sp.preset === "string" ? sp.preset : undefined;
  return <Lab initialPreset={preset} onboard={sp.onboard === "1"} fromCreate={sp.from === "create"} />;
}
