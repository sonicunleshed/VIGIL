/** All times are displayed in UTC, the simulation clock's zone. */

/** Formats an age in seconds as "4m ago" / "1h 12m ago". Unknown stays explicit. */
export function formatAge(seconds: number | null | undefined): string {
  if (seconds == null) return "never observed";
  const minutes = Math.max(0, Math.floor(seconds / 60));
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`;
}

export function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null) return "—";
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function formatClock(iso: string | number, withSeconds = false): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" } : {}),
    timeZone: "UTC",
  });
}

export function secondsBetween(laterIso: string, earlierIso: string): number {
  return (Date.parse(laterIso) - Date.parse(earlierIso)) / 1000;
}

export function formatSigned(n: number, digits = 0): string {
  const v = n.toFixed(digits);
  return n > 0 ? `+${v}` : v;
}
