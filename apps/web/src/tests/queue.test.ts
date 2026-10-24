import { describe, expect, it } from "vitest";
import { buildRows, DEFAULT_FILTERS, filterAndSort } from "@/lib/queue";
import { alert, patient } from "./fixtures";

const none = { heart_rate: null, resp_rate: null, spo2: null, sbp: null, temp: null };

const patients = [
  patient("P001", { minutes_waiting: 30, initial_esi_simulated: 2 }),
  patient("P002", { minutes_waiting: 90, initial_esi_simulated: 3 }),
  patient("P003", { minutes_waiting: 60, initial_esi_simulated: 3, latest: none }),
];
const rows = buildRows(patients, [alert("a", "P002"), alert("b", "P001", { status: "resolved" })]);
const ids = (r: typeof rows) => r.map((x) => x.patient.id);

describe("patient queue", () => {
  it("derives status and active alert counts per patient", () => {
    expect(rows.map((r) => [r.patient.id, r.status, r.activeAlerts])).toEqual([
      ["P001", "monitoring", 0],
      ["P002", "reassessment_due", 1],
      ["P003", "monitoring", 0],
    ]);
  });
  it("searches by display code or id", () => {
    expect(ids(filterAndSort(rows, { ...DEFAULT_FILTERS, query: "wr-02" }))).toEqual(["P002"]);
    expect(ids(filterAndSort(rows, { ...DEFAULT_FILTERS, query: "p003" }))).toEqual(["P003"]);
  });
  it("filters by status and ESI", () => {
    expect(ids(filterAndSort(rows, { ...DEFAULT_FILTERS, status: "reassessment_due" }))).toEqual(["P002"]);
    expect(ids(filterAndSort(rows, { ...DEFAULT_FILTERS, esi: 3 }))).toEqual(["P002", "P003"]);
  });
  it("sorts by waiting time", () => {
    expect(ids(filterAndSort(rows, DEFAULT_FILTERS))).toEqual(["P002", "P003", "P001"]);
    expect(ids(filterAndSort(rows, { ...DEFAULT_FILTERS, sort: "waiting_asc" }))).toEqual(["P001", "P003", "P002"]);
  });
  it("treats never-observed as the oldest data, not the freshest", () => {
    expect(ids(filterAndSort(rows, { ...DEFAULT_FILTERS, sort: "last_obs_oldest" }))[0]).toBe("P003");
    expect(ids(filterAndSort(rows, { ...DEFAULT_FILTERS, sort: "last_obs_newest" })).at(-1)).toBe("P003");
  });
});
