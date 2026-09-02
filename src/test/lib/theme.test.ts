import { describe, expect, it } from "vitest";
import { toneForDeadline, toneForResult, type Tone } from "@/lib/theme";
import type { DeadlineStatus } from "@/types";

// Driven off an exhaustive record rather than a hand-written list: adding a
// sixth DeadlineStatus without deciding its tone is a type error here, which is
// the point. Without this the new member would silently fall through to "idle"
// and render as a neutral card.
const EXPECTED: Record<DeadlineStatus, Tone> = {
  red: "bad",
  yellow: "warn",
  green: "ok",
  no_data: "idle",
  no_next_date: "idle",
};

describe("toneForDeadline", () => {
  it.each(Object.keys(EXPECTED) as DeadlineStatus[])("maps %s to its tone", (status) => {
    expect(toneForDeadline(status)).toBe(EXPECTED[status]);
  });

  it("never routes a real deadline state to idle", () => {
    expect(toneForDeadline("red")).not.toBe("idle");
    expect(toneForDeadline("yellow")).not.toBe("idle");
    expect(toneForDeadline("green")).not.toBe("idle");
  });
});

describe("toneForResult", () => {
  it("maps Passed to ok", () => {
    expect(toneForResult("Passed")).toBe("ok");
  });

  it("maps Failed to bad", () => {
    expect(toneForResult("Failed")).toBe("bad");
  });

  it("maps null to idle", () => {
    expect(toneForResult(null)).toBe("idle");
  });

  it("maps an unrecognised result to idle rather than to a status color", () => {
    expect(toneForResult("Pending")).toBe("idle");
  });
});
