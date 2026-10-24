import type { ObservationKind } from "@vigil/contracts";
import type { LucideIcon } from "lucide-react";
import { Activity, Droplets, HeartPulse, Thermometer, Wind } from "lucide-react";

export type VitalMeta = {
  kind: ObservationKind;
  label: string;
  short: string;
  unit: string;
  digits: number;
  icon: LucideIcon;
};

/** Display order for vitals tiles. The API reports systolic BP only (no diastolic). */
export const VITALS: VitalMeta[] = [
  { kind: "heart_rate", label: "Heart rate", short: "HR", unit: "bpm", digits: 0, icon: HeartPulse },
  { kind: "sbp", label: "Systolic BP", short: "SBP", unit: "mmHg", digits: 0, icon: Activity },
  { kind: "spo2", label: "SpO₂", short: "SpO₂", unit: "%", digits: 0, icon: Droplets },
  { kind: "resp_rate", label: "Respiratory rate", short: "RR", unit: "/min", digits: 0, icon: Wind },
  { kind: "temp", label: "Temperature", short: "Temp", unit: "°C", digits: 1, icon: Thermometer },
];

export const VITAL_BY_KIND = Object.fromEntries(VITALS.map((v) => [v.kind, v])) as Record<
  ObservationKind,
  VitalMeta
>;
