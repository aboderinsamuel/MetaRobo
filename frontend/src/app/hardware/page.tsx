import type { Metadata } from "next";
import HardwareStudio from "@/components/hardware/HardwareStudio";
export const metadata: Metadata = {
  title: "Hardware Studio",
  description:
    "Go from an idea to real Arduino firmware. Edit with Meta AI, compile, upload over USB, and verify flash from your browser.",
};
export default function HardwarePage() {
  return <HardwareStudio />;
}
