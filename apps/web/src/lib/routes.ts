import type { LucideIcon } from "lucide-react";
import { BellRing, ChartColumn, FlaskConical, House, PlayCircle, ScanEye, Users } from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Show the count of unresolved review requests next to this entry. */
  badge?: "attention";
};
export type NavSection = { title: string; items: NavItem[] };

/** Only routes that exist. */
export const NAV: NavSection[] = [
  {
    title: "Monitor",
    items: [
      { href: "/", label: "Home", icon: House },
      { href: "/patients", label: "Live Monitoring", icon: Users },
      { href: "/attention", label: "Attention Needed", icon: BellRing, badge: "attention" },
      { href: "/vision", label: "VIGIL Vision", icon: ScanEye },
    ],
  },
  {
    title: "Demo & insights",
    items: [
      { href: "/demo", label: "Watch VIGIL in Action", icon: PlayCircle },
      { href: "/simulation", label: "Simulation Lab", icon: FlaskConical },
      { href: "/insights", label: "Insights & Replay", icon: ChartColumn },
    ],
  },
];

const META: [string, { title: string; subtitle: string }][] = [
  ["/patients/", { title: "Patient timeline", subtitle: "What changed since triage, and why" }],
  ["/patients", { title: "Live Monitoring", subtitle: "Every patient waiting, with data freshness" }],
  ["/attention", { title: "Attention Needed", subtitle: "Review requests and reassessment queue" }],
  ["/vision", { title: "VIGIL Vision", subtitle: "On-device movement observations from a camera" }],
  ["/demo", { title: "Watch VIGIL in Action", subtitle: "A guided, reproducible walkthrough" }],
  ["/simulation", { title: "Simulation Lab", subtitle: "Drive the scenario and watch events arrive" }],
  ["/insights", { title: "Insights & Replay", subtitle: "Three monitoring strategies on the same event stream" }],
];

export function pageMeta(pathname: string): { title: string; subtitle: string } {
  for (const [prefix, meta] of META) if (pathname.startsWith(prefix)) return meta;
  return { title: "Who needs attention", subtitle: "Emergency department waiting room" };
}

export function isActive(href: string, pathname: string | null): boolean {
  if (pathname === null) return false;
  if (href === "/") return pathname === "/";
  if (href === "/patients") return pathname === "/patients" || pathname.startsWith("/patients/");
  return pathname.startsWith(href);
}
