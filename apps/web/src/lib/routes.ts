import type { LucideIcon } from "lucide-react";
import { ChartColumn, LayoutDashboard, ScanEye } from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon };
export type NavSection = { title: string; items: NavItem[] };

/** Only routes that exist. Unbuilt screens are not advertised. */
export const NAV: NavSection[] = [
  {
    title: "Operations",
    items: [
      { href: "/", label: "Overview", icon: LayoutDashboard },
      { href: "/vision", label: "VIGIL Vision", icon: ScanEye },
    ],
  },
  {
    title: "Intelligence",
    items: [{ href: "/insights", label: "Insights & Replay", icon: ChartColumn }],
  },
];

export function pageMeta(pathname: string): { title: string; subtitle: string } {
  if (pathname.startsWith("/patients/")) {
    return { title: "Patient detail", subtitle: "Longitudinal observations since triage" };
  }
  if (pathname.startsWith("/vision")) {
    return { title: "VIGIL Vision", subtitle: "On-device movement observations from a camera" };
  }
  if (pathname.startsWith("/insights")) {
    return {
      title: "Insights & Replay",
      subtitle: "Three monitoring strategies on the same event stream",
    };
  }
  return { title: "Emergency Department", subtitle: "Live monitoring overview" };
}
