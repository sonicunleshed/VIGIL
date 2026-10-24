import { LoaderCircle, Radio, WifiOff } from "lucide-react";
import type { ConnectionState } from "@/lib/store";

/** Never claims LIVE unless the event stream is actually connected. */
export function ConnectionStatus({ state }: { state: ConnectionState }) {
  if (state === "live") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-st-monitoring">
        <Radio aria-hidden className="size-3.5" />
        Live
      </span>
    );
  }
  if (state === "offline" || state === "reconnecting") {
    return (
      <span role="status" className="inline-flex items-center gap-1.5 text-xs font-medium text-st-urgent">
        <WifiOff aria-hidden className="size-3.5" />
        {state === "offline" ? "Disconnected" : "Reconnecting…"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-fg-3">
      <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
      Connecting…
    </span>
  );
}
