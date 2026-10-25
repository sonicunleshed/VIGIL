import { networkInterfaces } from "node:os";

/** This machine's IPv4 network addresses (no loopback or link-local). Server-side only. */
export function lanAddresses(): string[] {
  const found = new Set<string>();
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === "IPv4" && !a.internal && !a.address.startsWith("169.254.")) found.add(a.address);
    }
  }
  return [...found].sort();
}
