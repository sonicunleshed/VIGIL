import { lanAddresses } from "@/lib/lan";

/**
 * Origins a phone on the same network can use to open /checkin, for the staff QR code.
 * VIGIL_CHECKIN_ORIGIN overrides detection (e.g. a hostname or an HTTPS tunnel).
 */
export function GET(request: Request) {
  const configured = process.env.VIGIL_CHECKIN_ORIGIN?.trim();
  if (configured) return Response.json({ origins: [configured] });
  const { protocol, port } = new URL(request.url);
  const origins = lanAddresses().map((ip) => `${protocol}//${ip}${port ? `:${port}` : ""}`);
  return Response.json({ origins });
}
