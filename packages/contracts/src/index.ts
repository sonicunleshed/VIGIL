// Friendly aliases over the generated OpenAPI types. Regenerate with `pnpm contracts:gen`.
import type { components, paths } from "./api";

export type { components, paths };

type Schemas = components["schemas"];

export type PatientsOut = Schemas["PatientsOut"];
export type PatientSummary = Schemas["PatientSummary"];
export type PatientDetail = Schemas["PatientDetail"];
export type LatestValue = Schemas["LatestValue"];
export type TimelineOut = Schemas["TimelineOut"];
export type ObservationOut = Schemas["ObservationOut"];
export type SymptomReportOut = Schemas["SymptomReportOut"];
export type AlertOut = Schemas["AlertOut"];
export type AlertsOut = Schemas["AlertsOut"];
export type AlertActionIn = Schemas["AlertActionIn"];
export type ObservationIn = Schemas["ObservationIn"];
export type SymptomReportIn = Schemas["SymptomReportIn"];
export type SimulationStateOut = Schemas["SimulationStateOut"];
export type StepResult = Schemas["StepResult"];
export type ScenariosOut = Schemas["ScenariosOut"];
export type HealthOut = Schemas["HealthOut"];
export type ObservationKind = Schemas["ObservationKind"];

/** Server-sent event names emitted by GET /api/events/stream. */
export type StreamEventType =
  | "hello"
  | "observation"
  | "symptom_report"
  | "alert_created" // emitted once detectors exist (Phase 3)
  | "alert_updated"
  | "simulation"
  | "reset"
  | "resync";

export const DISCLAIMER = "SIMULATION / NOT FOR CLINICAL USE";
