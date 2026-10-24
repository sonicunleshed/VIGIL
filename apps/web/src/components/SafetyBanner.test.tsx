import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { formatAge } from "@/lib/format";
import { SafetyBanner } from "./SafetyBanner";

describe("SafetyBanner", () => {
  it("shows the simulation disclaimer as text", () => {
    render(<SafetyBanner />);
    const region = screen.getByRole("region", { name: "Safety notice" });
    expect(region.textContent).toContain("SIMULATION / NOT FOR CLINICAL USE");
  });
});

describe("formatAge", () => {
  it("never renders missing data as a value", () => {
    expect(formatAge(null)).toBe("never observed");
    expect(formatAge(undefined)).toBe("never observed");
  });
  it("formats minutes and hours", () => {
    expect(formatAge(59)).toBe("0m ago");
    expect(formatAge(125 * 60)).toBe("2h 5m ago");
  });
});
