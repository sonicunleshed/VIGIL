import { create } from "qrcode";
import { useMemo } from "react";

const QUIET_ZONE = 4; // modules of white border scanners expect

/** QR code drawn locally as SVG. Always black on white, whatever the theme, so phones can scan it. */
export function QrCode({ value, label, size = 208 }: { value: string; label: string; size?: number }) {
  const { d, n } = useMemo(() => {
    const { modules } = create(value, { errorCorrectionLevel: "M" });
    let path = "";
    for (let row = 0; row < modules.size; row++) {
      for (let col = 0; col < modules.size; col++) {
        if (modules.get(row, col)) path += `M${col + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`;
      }
    }
    return { d: path, n: modules.size + 2 * QUIET_ZONE };
  }, [value]);

  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${n} ${n}`} width={size} height={size} shapeRendering="crispEdges">
      <rect width={n} height={n} fill="#ffffff" />
      <path d={d} fill="#000000" />
    </svg>
  );
}
