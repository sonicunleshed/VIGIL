/**
 * Patient check-in: the phone page and the staff QR card share these helpers.
 *
 * The phone talks to the API through this web server (same origin, see the rewrites in
 * next.config.ts), because a phone cannot reach the API on the laptop's localhost. Every
 * request carries the check-in code; the code itself travels in the URL fragment, which
 * browsers never send to a server.
 */
import type { CheckinSessionOut, SymptomReportIngestResult } from "@vigil/contracts";
import { ApiError } from "@/lib/api/client";

export const CHECKIN_SOURCE = "patient_checkin";
export const CHECKIN_HEADER = "X-Checkin-Token";
export const NOTE_MAX = 280;
/** How often the open page asks the server for the simulation clock and the next reminder. */
export const POLL_MS = 20_000;

/** Patient-facing wording for report tags, in display order. Plain language, no clinical terms. */
export const CHECKIN_TAG_LABEL: Record<string, string> = {
  pain_worse: "Pain is worse",
  breathing_harder: "Harder to breathe",
  chest_discomfort: "Chest pain or discomfort",
  feeling_faint: "Feeling faint or dizzy",
  new_confusion: "New confusion",
  bleeding: "Bleeding",
  nausea_vomiting: "Nausea or vomiting",
  other: "Something else",
  feeling_better: "Feeling better",
};

const ORDER = Object.keys(CHECKIN_TAG_LABEL);

export function tagLabel(tag: string): string {
  return CHECKIN_TAG_LABEL[tag] ?? tag.replaceAll("_", " ");
}

/** The server's tag list in display order; tags this page has no wording for go last. */
export function orderTags(tags: string[]): string[] {
  const rank = (t: string) => (ORDER.includes(t) ? ORDER.indexOf(t) : ORDER.length);
  return [...tags].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

export function checkinLink(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/checkin#${token}`;
}

export function tokenFromHash(hash: string): string | null {
  const token = hash.replace(/^#/, "").trim();
  return /^[A-Za-z0-9_-]{20,}$/.test(token) ? token : null;
}

/**
 * Whether the page should ask the patient now. The server says when, on the simulation clock.
 * "Nothing new" is remembered on the phone only and postpones the next ask by one interval.
 */
export function reminderDue(session: CheckinSessionOut, dismissedAt: string | null): boolean {
  const now = Date.parse(session.now);
  const snoozedUntil = dismissedAt ? Date.parse(dismissedAt) + session.remind_every_minutes * 60_000 : -Infinity;
  return now >= Math.max(Date.parse(session.remind_at), snoozedUntil);
}

/** UUID v4. `crypto.randomUUID` needs a secure context, which a phone on plain-HTTP LAN is not. */
export function newEventId(): string {
  if (typeof crypto.randomUUID === "function" && globalThis.isSecureContext) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export type CheckinReport = {
  event_id: string;
  patient_id: string;
  structured_tags: string[];
  urgent_help_requested: boolean;
  free_text?: string;
  source: typeof CHECKIN_SOURCE;
};

export function buildReport(
  eventId: string,
  patientId: string,
  tags: Iterable<string>,
  note: string,
  urgent: boolean,
): CheckinReport {
  const text = note.trim().slice(0, NOTE_MAX);
  return {
    event_id: eventId,
    patient_id: patientId,
    structured_tags: orderTags([...tags]),
    urgent_help_requested: urgent,
    ...(text ? { free_text: text } : {}),
    source: CHECKIN_SOURCE,
  };
}

async function call<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", [CHECKIN_HEADER]: token },
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "network");
  }
  if (!res.ok) throw new ApiError(res.status, res.statusText);
  return (await res.json()) as T;
}

export const checkinApi = {
  session: (token: string) => call<CheckinSessionOut>("/api/checkin/session", token),
  send: (token: string, report: CheckinReport) =>
    call<SymptomReportIngestResult>("/api/symptom-reports", token, {
      method: "POST",
      body: JSON.stringify(report),
    }),
};
