import type { LucideIcon } from "lucide-react";
import {
  Bell,
  ChartColumn,
  ClipboardList,
  FlaskConical,
  History,
  LayoutDashboard,
  Users,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Not built yet: rendered as a disabled "Planned" entry, never as a working link. */
  planned?: boolean;
};

export type NavSection = { title: string; items: NavItem[] };

export const NAV: NavSection[] = [
  {
    title: "Operations",
    items: [
      { href: "/", label: "Overview", icon: LayoutDashboard },
      { href: "/patients", label: "Patients", icon: Users, planned: true },
      { href: "/alerts", label: "Alerts", icon: Bell, planned: true },
      { href: "/reassessment", label: "Reassessment", icon: ClipboardList, planned: true },
    ],
  },
  {
    title: "Intelligence",
    items: [
      { href: "/simulation", label: "Simulation Lab", icon: FlaskConical, planned: true },
      { href: "/replay", label: "Replay", icon: History, planned: true },
      { href: "/analytics", label: "Analytics", icon: ChartColumn, planned: true },
    ],
  },
];

export function pageMeta(pathname: string): { title: string; subtitle: string } {
  if (pathname.startsWith("/patients/")) {
    return { title: "Patient detail", subtitle: "Longitudinal observations since triage" };
  }
  return { title: "Emergency Department", subtitle: "Live monitoring overview" };
}
