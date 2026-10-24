import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { AppShell } from "@/components/layout/AppShell";
import { VigilProvider } from "@/lib/store";
import "./globals.css";

export const metadata: Metadata = {
  title: "VIGIL",
  description: "Emergency department waiting-room reassessment support.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} antialiased`}>
      <body>
        <VigilProvider>
          <AppShell>{children}</AppShell>
        </VigilProvider>
      </body>
    </html>
  );
}
