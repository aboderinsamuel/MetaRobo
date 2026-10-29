import type { Metadata } from "next";
import Workspace from "@/components/create/Workspace";
import { sanitizeDesign } from "@/lib/create/design";
import { ARM_FIXTURE } from "../../../tests/fixtures/createFixtures";

export const metadata: Metadata = {
  title: "Create · RoboCraft",
  description: "Describe a robot and its task. Meta Muse Spark designs it; RoboCraft builds it in 3D and simulates it with real physics.",
};

// ?fixture=arm opens a hand-written test design (development only), so the 3D and physics can be
// checked without a paid Muse Spark call.
export default async function Page({ searchParams }: { searchParams: Promise<{ fixture?: string }> }) {
  const { fixture } = await searchParams;
  const initial = process.env.NODE_ENV !== "production" && fixture === "arm" ? sanitizeDesign(ARM_FIXTURE) : undefined;
  return <Workspace initial={initial} />;
}
