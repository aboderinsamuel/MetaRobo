import type { Metadata } from "next";
import { Figtree, Geist_Mono, Silkscreen } from "next/font/google";
import "./globals.css";

const sans = Figtree({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const pixel = Silkscreen({
  variable: "--font-pixel",
  weight: "400",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "RoboCraft - describe a machine, get a controller",
  description:
    "Describe a physical system in plain words or upload step data. RoboCraft builds the model, designs a PID or state-feedback controller, simulates it in a C++/WebAssembly engine and explains how to fix it.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${geistMono.variable} ${pixel.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
