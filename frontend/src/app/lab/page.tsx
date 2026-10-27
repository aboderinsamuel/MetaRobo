import type { Metadata } from "next";
import Lab from "@/components/lab/Lab";

export const metadata: Metadata = {
  title: "Control Lab · RoboCraft",
  description: "Describe a physical system, get a model and controller, simulate it in C++/WASM and iterate with an AI control engineer.",
};

export default async function LabPage(props: PageProps<"/lab">) {
  const sp = await props.searchParams;
  const preset = typeof sp.preset === "string" ? sp.preset : undefined;
  return <Lab initialPreset={preset} />;
}
