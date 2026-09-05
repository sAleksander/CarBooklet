import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runAfterResponse } from "@/lib/after-response";

/**
 * The helper that decides whether deferred work survives the response.
 *
 * Worth its own spec because both branches fail silently when wrong: forget
 * `waitUntil` in a Worker and the write is dropped with no log line at all, and
 * let a rejection escape and a diagnosable failure becomes an unhandled one
 * inside a stream handler.
 */

const CONTEXT = { route: "/api/ai/chat", method: "POST", userId: "user-1" };

function makeLocals(cfContext?: { waitUntil: (p: Promise<unknown>) => void }): App.Locals {
  return { user: null, selectedCarId: null, lang: "en", theme: "system", cfContext } as unknown as App.Locals;
}

describe("runAfterResponse", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("hands the task to waitUntil when the platform supplies it", () => {
    const waitUntil = vi.fn();

    runAfterResponse(makeLocals({ waitUntil }), Promise.resolve("done"), CONTEXT);

    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(waitUntil.mock.calls[0][0]).toBeInstanceOf(Promise);
  });

  it("hands over a promise that is already guarded, so a rejection cannot escape", async () => {
    // The distinction that matters: what reaches `waitUntil` must not be the
    // caller's raw promise, or the platform sees an unhandled rejection.
    const waitUntil = vi.fn();

    runAfterResponse(makeLocals({ waitUntil }), Promise.reject(new Error("insert failed")), CONTEXT);

    await expect(waitUntil.mock.calls[0][0] as Promise<unknown>).resolves.toBeUndefined();
  });

  it("does not throw when cfContext is absent", () => {
    expect(() => {
      runAfterResponse(makeLocals(), Promise.resolve("done"), CONTEXT);
    }).not.toThrow();
  });

  it("logs one flat object when the deferred task rejects", async () => {
    const logged = vi.mocked(console.error);

    runAfterResponse(makeLocals(), Promise.reject(new Error("insert failed")), CONTEXT);
    // Let the rejection settle through the attached catch.
    await Promise.resolve();
    await Promise.resolve();

    expect(logged).toHaveBeenCalledTimes(1);
    // One object, never a string plus a second argument — Cloudflare indexes the
    // top-level keys of a single logged object and merges nothing.
    expect(logged.mock.calls[0]).toHaveLength(1);
    expect(logged.mock.calls[0][0]).toMatchObject({
      event: "api_error",
      route: "/api/ai/chat",
      message: "insert failed",
    });
  });
});
