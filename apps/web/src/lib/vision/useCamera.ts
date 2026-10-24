"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type CameraStatus =
  | "idle"
  | "requesting"
  | "live"
  | "denied"
  | "unavailable"
  | "disconnected"
  | "error";

export type CameraState = {
  status: CameraStatus;
  message: string | null;
  devices: MediaDeviceInfo[];
  deviceId: string | null;
  label: string | null;
};

const INITIAL: CameraState = { status: "idle", message: null, devices: [], deviceId: null, label: null };

function describeError(err: unknown): Pick<CameraState, "status" | "message"> {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return {
      status: "denied",
      message:
        "Camera permission was denied. Allow camera access for this site in the browser's address bar or site settings, then press Start again.",
    };
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return { status: "unavailable", message: "No camera was found. Connect a camera (or enable Continuity Camera) and try again." };
  }
  if (name === "NotReadableError") {
    return { status: "error", message: "The camera is in use by another application. Close it there and try again." };
  }
  return { status: "error", message: err instanceof Error ? err.message : String(err) };
}

/**
 * Camera access that only starts on an explicit call (a user click) and always releases the
 * device: on stop(), on unmount, when the page is hidden/closed, and if the track ends.
 */
export function useCamera() {
  const [state, setState] = useState<CameraState>(INITIAL);
  const streamRef = useRef<MediaStream | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);

  const release = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    streamRef.current = null;
    setStream(null);
  }, []);

  const stop = useCallback(() => {
    release();
    setState((s) => ({ ...s, status: "idle", message: null }));
  }, [release]);

  const start = useCallback(
    async (deviceId?: string | null) => {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setState((s) => ({
          ...s,
          status: "unavailable",
          message: "This browser cannot access a camera here. Use a current browser on localhost or HTTPS.",
        }));
        return;
      }
      release();
      setState((s) => ({ ...s, status: "requesting", message: null }));
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: deviceId ? { deviceId: { exact: deviceId } } : { width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        const track = media.getVideoTracks()[0];
        track.onended = () => {
          streamRef.current = null;
          setStream(null);
          setState((s) => ({ ...s, status: "disconnected", message: "The camera disconnected. Tracking has stopped." }));
        };
        streamRef.current = media;
        setStream(media);
        const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
        setState({
          status: "live",
          message: null,
          devices,
          deviceId: track.getSettings().deviceId ?? deviceId ?? null,
          label: track.label || "Camera",
        });
      } catch (err) {
        release();
        setState((s) => ({ ...s, ...describeError(err) }));
      }
    },
    [release],
  );

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden" && streamRef.current) stop();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", stop);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", stop);
      release(); // unmount / navigation away
    };
  }, [release, stop]);

  return { ...state, stream, start, stop };
}
