import { Analytics } from "@vercel/analytics/next";
import type { Metadata } from "next";
import { Figtree, Geist_Mono, Silkscreen } from "next/font/google";
import "./globals.css";
import { THEME_SCRIPT } from "@/lib/themeScript";

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

const SITE = "https://robocraftlabs.vercel.app";
const TITLE = "RoboCraft: describe a robot, see if it works";
const DESCRIPTION = "Describe any robot in a sentence. Meta Muse Spark engineers the body, joints and task; RoboCraft builds it in 3D with real motors, boards and batteries inside, then physics checks every part and every step.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: TITLE, template: "%s · RoboCraft" },
  description: DESCRIPTION,
  applicationName: "RoboCraft",
  keywords: ["AI robot design", "robotics simulation", "Meta Muse Spark", "SAM 3.1", "physics simulation", "WebAssembly", "robot engineering"],
  openGraph: { type: "website", url: SITE, siteName: "RoboCraft", title: TITLE, description: DESCRIPTION, images: [{ url: "/og.png", width: 1200, height: 630, alt: "RoboCraft: describe a robot, see if it works" }] },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: ["/og.png"] },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${geistMono.variable} ${pixel.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col font-sans">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
