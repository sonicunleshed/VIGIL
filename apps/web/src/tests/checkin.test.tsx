import type { CheckinSessionOut } from "@vigil/contracts";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CheckinView } from "@/components/checkin/CheckinView";
import { QrCode } from "@/components/ui/QrCode";
import {
  buildReport,
  CHECKIN_TAG_LABEL,
  checkinLink,
  newEventId,
  orderTags,
  reminderDue,
  tagLabel,
  tokenFromHash,
} from "@/lib/checkin";
import { buildTimelineEntries } from "@/lib/timeline";

const TOKEN = "abcDEF123_-abcDEF123_-abcDEF123_-abcdef12";
const SESSION: CheckinSessionOut = {
  patient_id: "P007",
  display_code: "WR-07",
  expires_at: "2026-01-15T18:00:00Z",
  structured_tags: ["bleeding", "breathing_harder", "feeling_better", "other", "pain_worse"],
  now: "2026-01-15T14:00:00Z",
  remind_every_minutes: 30,
  remind_at: "2026-01-15T14:30:00Z",
};
const at = (now: string, over: Partial<CheckinSessionOut> = {}): CheckinSessionOut => ({ ...SESSION, now, ...over });

describe("check-in reminders", () => {
  it("is due once the simulation clock reaches the server's reminder time", () => {
    expect(reminderDue(at("2026-01-15T14:29:59Z"), null)).toBe(false);
    expect(reminderDue(at("2026-01-15T14:30:00Z"), null)).toBe(true);
  });

  it("'Nothing new' postpones the next ask by one interval from the dismissal", () => {
    const dismissed = "2026-01-15T14:31:00Z";
    expect(reminderDue(at("2026-01-15T15:00:59Z"), dismissed)).toBe(false);
    expect(reminderDue(at("2026-01-15T15:01:00Z"), dismissed)).toBe(true);
  });

  it("a later report moves the reminder past an older dismissal", () => {
    const s = at("2026-01-15T15:05:00Z", { remind_at: "2026-01-15T15:20:00Z" });
    expect(reminderDue(s, "2026-01-15T14:31:00Z")).toBe(false);
  });
});

describe("check-in helpers", () => {
  it("has patient wording for every tag the API accepts", () => {
    const apiTags = [
      "pain_worse",
      "breathing_harder",
      "feeling_faint",
      "new_confusion",
      "chest_discomfort",
      "bleeding",
      "nausea_vomiting",
      "feeling_better",
      "other",
    ];
    expect(Object.keys(CHECKIN_TAG_LABEL).sort()).toEqual([...apiTags].sort());
    expect(tagLabel("brand_new_tag")).toBe("brand new tag");
  });

  it("orders tags for display and puts unknown ones last", () => {
    expect(orderTags(["zz_new", "feeling_better", "breathing_harder", "pain_worse"])).toEqual([
      "pain_worse",
      "breathing_harder",
      "feeling_better",
      "zz_new",
    ]);
  });

  it("keeps the code in the URL fragment and reads it back", () => {
    const link = checkinLink("http://192.168.1.20:3000/", TOKEN);
    expect(link).toBe(`http://192.168.1.20:3000/checkin#${TOKEN}`);
    expect(tokenFromHash(new URL(link).hash)).toBe(TOKEN);
    expect(tokenFromHash("")).toBeNull();
    expect(tokenFromHash("#short")).toBeNull();
    expect(tokenFromHash("#<script>")).toBeNull();
  });

  it("makes v4 UUIDs without a secure context", () => {
    const ids = new Set(Array.from({ length: 50 }, newEventId));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("builds a report with the check-in source and no client timestamp", () => {
    const r = buildReport("e1", "P007", new Set(["other", "breathing_harder"]), "  ", false);
    expect(r).toEqual({
      event_id: "e1",
      patient_id: "P007",
      structured_tags: ["breathing_harder", "other"],
      urgent_help_requested: false,
      source: "patient_checkin",
    });
    expect(buildReport("e2", "P007", [], " dizzy ", true)).toMatchObject({ free_text: "dizzy", urgent_help_requested: true });
  });

  it("labels phone reports on the staff timeline", () => {
    const report = (source: string) => ({
      item_type: "symptom_report" as const,
      at: "2026-01-15T14:00:00Z",
      symptom_report: {
        id: source,
        patient_id: "P007",
        reported_at: "2026-01-15T14:00:00Z",
        received_at: "2026-01-15T14:00:00Z",
        free_text: null,
        structured_tags: ["bleeding"],
        urgent_help_requested: false,
        source,
      },
    });
    const entries = buildTimelineEntries({
      patient_id: "P007",
      as_of: "2026-01-15T14:00:00Z",
      items: [report("patient_checkin"), report("scenario")],
    });
    const flags = Object.fromEntries(entries.map((e) => [e.key, e.flags]));
    expect(flags).toEqual({ "rep-patient_checkin": ["sent from patient's phone"], "rep-scenario": [] });
  });
});

describe("check-in proxy", () => {
  it("forwards only check-in calls that carry a code, without copying the code into the URL", async () => {
    const { default: config } = await import("../../next.config");
    const rewrites = (await config.rewrites?.()) as { source: string; destination: string; has?: { type: string; value?: string }[] }[];
    expect(rewrites.map((r) => r.source).sort()).toEqual(["/api/checkin/session", "/api/symptom-reports"]);
    for (const r of rewrites) {
      const [header] = r.has ?? [];
      expect(header?.type).toBe("header");
      // A missing value pattern, or a named group, makes Next append the header to the query.
      expect(header?.value).toBeTruthy();
      expect(header?.value).not.toContain("(?<");
      expect(new RegExp(`^${header?.value}$`).test(TOKEN)).toBe(true);
      expect(r.destination).not.toContain("?");
    }
  });
});

describe("QrCode", () => {
  afterEach(cleanup);

  it("draws a scannable black-on-white symbol with a quiet zone", () => {
    render(<QrCode value="http://192.168.1.20:3000/checkin#abc" label="Check-in QR code for WR-07" />);
    const svg = screen.getByRole("img", { name: "Check-in QR code for WR-07" });
    const [, , w] = (svg.getAttribute("viewBox") ?? "").split(" ").map(Number);
    expect(w).toBeGreaterThanOrEqual(21 + 8);
    expect(svg.querySelector("rect")?.getAttribute("fill")).toBe("#ffffff");
    expect(svg.querySelector("path")?.getAttribute("d")).toMatch(/^M4 4h1v1h-1z/);
  });
});

describe("CheckinView", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  const json = (status: number, body: unknown = {}) =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    window.location.hash = TOKEN;
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.location.hash = "";
  });

  const sentBodies = () =>
    fetchSpy.mock.calls
      .filter(([url]) => url === "/api/symptom-reports")
      .map(([, init]) => JSON.parse((init as RequestInit).body as string) as Record<string, unknown>);

  it("sends the chosen tags with the code and shows only what was sent", async () => {
    fetchSpy.mockImplementation((url: string) => (url === "/api/checkin/session" ? json(200, SESSION) : json(201)));
    render(<CheckinView />);
    expect(await screen.findByText("WR-07")).toBeTruthy();
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["X-Checkin-Token"]).toBe(TOKEN);

    const send = screen.getByRole("button", { name: "Send to the nurse" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Harder to breathe" }));
    expect(screen.getByRole("button", { name: "Harder to breathe" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(send);

    expect(await screen.findByText("Sent to the nursing team")).toBeTruthy();
    const [body] = sentBodies();
    expect(body).toMatchObject({
      patient_id: "P007",
      structured_tags: ["breathing_harder"],
      urgent_help_requested: false,
      source: "patient_checkin",
    });
    expect(body).not.toHaveProperty("reported_at");
    expect(screen.getByText("Harder to breathe")).toBeTruthy();
    expect(screen.queryByText(/stable|safe|priority/i)).toBeNull();
  });

  it("asks for staff help in one tap", async () => {
    fetchSpy.mockImplementation((url: string) => (url === "/api/checkin/session" ? json(200, SESSION) : json(201)));
    render(<CheckinView />);
    fireEvent.click(await screen.findByRole("button", { name: "Get staff help now" }));
    expect(await screen.findByText("You asked for staff help now")).toBeTruthy();
    expect(sentBodies()[0]).toMatchObject({ urgent_help_requested: true, structured_tags: [] });
  });

  it("retries a failed send with the same event id", async () => {
    let attempts = 0;
    fetchSpy.mockImplementation((url: string) => {
      if (url === "/api/checkin/session") return json(200, SESSION);
      attempts += 1;
      return attempts === 1 ? Promise.reject(new TypeError("offline")) : json(201);
    });
    render(<CheckinView />);
    fireEvent.click(await screen.findByRole("button", { name: "Bleeding" }));
    fireEvent.click(screen.getByRole("button", { name: "Send to the nurse" }));
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await screen.findByText("Sent to the nursing team");
    const [first, second] = sentBodies();
    expect(second.event_id).toBe(first.event_id);
  });

  it("tells the patient to ask staff when the code no longer works", async () => {
    fetchSpy.mockImplementation(() => json(401, { detail: "check-in code is not active" }));
    render(<CheckinView />);
    expect(await screen.findByText("This check-in code isn’t working")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send to the nurse" })).toBeNull();
  });

  it("stops offering resend when the code is rate limited", async () => {
    fetchSpy.mockImplementation((url: string) => (url === "/api/checkin/session" ? json(200, SESSION) : json(429)));
    render(<CheckinView />);
    fireEvent.click(await screen.findByRole("button", { name: "Pain is worse" }));
    fireEvent.click(screen.getByRole("button", { name: "Send to the nurse" }));
    expect(await screen.findByText("Several updates already sent")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("shows a prompt to scan when there is no code in the link", async () => {
    window.location.hash = "";
    render(<CheckinView />);
    await act(async () => {});
    await waitFor(() => expect(screen.getByText("This check-in code isn’t working")).toBeTruthy());
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  describe("reminders", () => {
    let current: CheckinSessionOut;
    let revoked: boolean;
    let vibrateSpy: ReturnType<typeof vi.fn>;
    let notes: number;

    class FakeAudioContext {
      currentTime = 0;
      destination = {};
      resume = () => Promise.resolve();
      createOscillator() {
        return { type: "", frequency: { value: 0 }, connect: (n: unknown) => n, start: () => (notes += 1), stop: () => {} };
      }
      createGain() {
        return { gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} }, connect: (n: unknown) => n };
      }
    }

    // The page also polls every 20 s; coming back to the tab triggers the same refresh at once.
    const poll = async (now: string, over: Partial<CheckinSessionOut> = {}) => {
      current = at(now, over);
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
    };
    const banner = () => screen.queryByText("Time for a quick check-in");

    beforeEach(() => {
      document.title = "Waiting room check-in";
      current = SESSION;
      revoked = false;
      notes = 0;
      vibrateSpy = vi.fn();
      Object.defineProperty(navigator, "vibrate", { configurable: true, value: vibrateSpy });
      Object.defineProperty(window, "AudioContext", { configurable: true, value: FakeAudioContext });
      fetchSpy.mockImplementation((url: string) => {
        if (revoked) return json(401);
        if (url === "/api/checkin/session") return json(200, current);
        current = at(current.now, { remind_at: "2026-01-15T15:00:00Z" }); // the report resets the timer
        return json(201);
      });
    });
    afterEach(() => {
      Reflect.deleteProperty(navigator, "vibrate");
      Reflect.deleteProperty(window, "AudioContext");
      document.title = "";
    });

    it("asks when the server says so, and 'Nothing new' sends nothing", async () => {
      render(<CheckinView />);
      await screen.findByText("WR-07");
      expect(banner()).toBeNull();

      await poll("2026-01-15T14:30:00Z");
      expect(banner()).toBeTruthy();
      expect(vibrateSpy).toHaveBeenCalledTimes(1);
      expect(document.title).toBe("(1) Waiting room check-in");

      fireEvent.click(screen.getByRole("button", { name: "Nothing new" }));
      expect(banner()).toBeNull();
      expect(document.title).toBe("Waiting room check-in");
      expect(sentBodies()).toEqual([]);

      await poll("2026-01-15T14:59:00Z");
      expect(banner()).toBeNull();
      await poll("2026-01-15T15:00:00Z");
      expect(banner()).toBeTruthy();
      expect(vibrateSpy).toHaveBeenCalledTimes(2);
    });

    it("counts an update as the answer", async () => {
      current = at("2026-01-15T14:30:00Z");
      render(<CheckinView />);
      fireEvent.click(await screen.findByRole("button", { name: "Bleeding" }));
      expect(banner()).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Send to the nurse" }));
      await screen.findByText("Sent to the nursing team");
      expect(banner()).toBeNull();
    });

    it("plays a chime only after the patient turns sound on", async () => {
      current = at("2026-01-15T14:30:00Z");
      render(<CheckinView />);
      await screen.findByText("Time for a quick check-in");
      expect(notes).toBe(0); // sound is off by default

      fireEvent.click(screen.getByRole("button", { name: "Nothing new" }));
      const toggle = screen.getByRole("switch", { name: /Remind me with a sound/ }) as HTMLInputElement;
      fireEvent.click(toggle);
      expect(toggle.checked).toBe(true);
      expect(notes).toBe(2); // a preview, so they know it works

      await poll("2026-01-15T15:00:00Z");
      expect(banner()).toBeTruthy();
      expect(notes).toBe(4);
    });

    it("notices on the next poll when staff cancel the code", async () => {
      render(<CheckinView />);
      await screen.findByText("WR-07");
      revoked = true;
      await poll("2026-01-15T14:10:00Z");
      expect(screen.getByText("This check-in code isn’t working")).toBeTruthy();
      expect(screen.queryByRole("switch")).toBeNull();
    });
  });
});
