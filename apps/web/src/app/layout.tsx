import type { Metadata } from "next";
import { SafetyBanner } from "@/components/SafetyBanner";
import "./globals.css";

export const metadata: Metadata = {
  title: "VIGIL — Simulation",
  description:
    "Synthetic-data research demo of waiting-room reassessment support. Not for clinical use.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <SafetyBanner />
        <div className="flex-1">{children}</div>
      </body>
    </html>
  );
}
