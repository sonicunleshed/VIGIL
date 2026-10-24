import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/vision/usePoseTracker", () => ({
  MODEL_VERSION: "test-model",
  usePoseTracker: () => ({
    model: { status: "not_loaded" },
    stats: { fps: 0, status: "waiting", posture: "unknown", motion: 0, people: 0 },
    events: [],
    clearEvents: () => {},
  }),
}));

vi.mock("@/lib/store", () => ({
  useVigil: () => ({
    patients: [
      { id: "P003", display_code: "WR-03", complaint: "nausea" },
      { id: "P004", display_code: "WR-04", complaint: "headache" },
    ],
  }),
}));

import { VisionView } from "@/components/vision/VisionView";

type FakeTrack = { stop: ReturnType<typeof vi.fn>; onended: (() => void) | null; label: string; getSettings: () => { deviceId: string } };

function fakeStream() {
  const track: FakeTrack = { stop: vi.fn(), onended: null, label: "FaceTime HD Camera", getSettings: () => ({ deviceId: "cam-1" }) };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
  return { stream, track };
}

let getUserMedia: ReturnType<typeof vi.fn>;
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  getUserMedia = vi.fn();
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia,
      enumerateDevices: vi.fn().mockResolvedValue([{ kind: "videoinput", deviceId: "cam-1", label: "FaceTime HD Camera" }]),
    },
  });
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const startButton = () => screen.getByRole("button", { name: /start camera/i });
const giveConsent = () => fireEvent.click(screen.getByRole("checkbox"));

async function startLive() {
  const fake = fakeStream();
  getUserMedia.mockResolvedValue(fake.stream);
  render(<VisionView />);
  giveConsent();
  await act(async () => {
    fireEvent.click(startButton());
  });
  return fake;
}

describe("VIGIL Vision camera lifecycle", () => {
  it("never requests the camera until consent is given and Start is pressed", () => {
    render(<VisionView />);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(startButton()).toHaveProperty("disabled", true);
    expect(screen.getByText("No camera connected")).toBeTruthy();
    giveConsent();
    expect(startButton()).toHaveProperty("disabled", false);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("starts video-only on click and shows the live camera", async () => {
    await startLive();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia.mock.calls[0][0]).toMatchObject({ audio: false });
    expect(screen.getByText("FaceTime HD Camera")).toBeTruthy();
    expect(screen.getByRole("button", { name: /stop camera/i })).toBeTruthy();
  });

  it("stops every track on Stop", async () => {
    const { track } = await startLive();
    fireEvent.click(screen.getByRole("button", { name: /stop camera/i }));
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Not started")).toBeTruthy();
  });

  it("stops the camera when the page unmounts (navigation away)", async () => {
    const { track } = await startLive();
    cleanup();
    expect(track.stop).toHaveBeenCalled();
  });

  it("stops the camera when the tab is hidden", async () => {
    const { track } = await startLive();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(track.stop).toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });

  it("explains a denied permission and never shows a live state", async () => {
    getUserMedia.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    render(<VisionView />);
    giveConsent();
    await act(async () => {
      fireEvent.click(startButton());
    });
    expect(screen.getByText("Permission denied")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/allow camera access/i);
    expect(screen.queryByRole("button", { name: /stop camera/i })).toBeNull();
  });

  it("reports a disconnected camera instead of pretending to track", async () => {
    const { track } = await startLive();
    act(() => track.onended?.());
    expect(screen.getByText("Disconnected")).toBeTruthy();
    expect(screen.getByText("Not tracking")).toBeTruthy();
  });

  it("explains when the browser has no camera API", async () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    render(<VisionView />);
    giveConsent();
    await act(async () => {
      fireEvent.click(startButton());
    });
    expect(screen.getByText("No camera available")).toBeTruthy();
  });

  it("makes no network calls (Phase C keeps everything in the browser)", async () => {
    await startLive();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("needs a live camera and a staff-chosen patient before anything can be sent", async () => {
    await startLive();
    const send = screen.getByRole("button", { name: /send to timeline/i });
    expect(send).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText(/patient on camera/i), { target: { value: "P003" } });
    expect(screen.getByRole("button", { name: /send to timeline/i })).toHaveProperty("disabled", false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("binds a session on Send and stops it when the camera stops", async () => {
    fetchSpy.mockImplementation(async (url: string) => {
      const body = url.endsWith("/stop")
        ? { id: "s1", status: "stopped" }
        : { id: "s1-0000-0000", patient_id: "P003", token: "tok", status: "active" };
      return new Response(JSON.stringify(body), { status: url.endsWith("/stop") ? 200 : 201 });
    });
    await startLive();
    fireEvent.change(screen.getByLabelText(/patient on camera/i), { target: { value: "P003" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send to timeline/i }));
    });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/vision\/sessions$/);
    expect(JSON.parse(String(init.body))).toMatchObject({ patient_id: "P003", consent_acknowledged: true });
    expect(screen.getByText(/observations go to WR-03/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /stop camera/i }));
    });
    const stopCall = fetchSpy.mock.calls.find(([u]) => String(u).endsWith("/stop")) as [string, RequestInit];
    expect(stopCall).toBeTruthy();
    expect((stopCall[1].headers as Record<string, string>)["X-Vision-Token"]).toBe("tok");
  });

  it("changing the patient turns sending off until staff re-enable it", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ id: "s1-0000-0000", patient_id: "P003", token: "tok", status: "active" }), { status: 201 }),
    );
    await startLive();
    fireEvent.change(screen.getByLabelText(/patient on camera/i), { target: { value: "P003" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send to timeline/i }));
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/patient on camera/i), { target: { value: "P004" } });
    });
    expect(screen.getByRole("button", { name: /send to timeline/i })).toBeTruthy();
    expect(screen.getByText("Observations stay in this browser")).toBeTruthy();
  });
});
