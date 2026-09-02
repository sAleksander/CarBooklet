import { describe, it, expect } from "vitest";
import { safeReferer } from "@/lib/safe-redirect";

const APP = new URL("https://app.example/api/theme/light");

function withReferer(value: string | null): Request {
  const headers = new Headers();
  if (value !== null) headers.set("Referer", value);
  return new Request(APP, { method: "POST", headers });
}

describe("safeReferer", () => {
  it("returns the path of a same-origin Referer", () => {
    expect(safeReferer(withReferer("https://app.example/entries"), APP)).toBe("/entries");
  });

  it("preserves the query string and hash of a same-origin Referer", () => {
    expect(safeReferer(withReferer("https://app.example/entries?type=repair#top"), APP)).toBe(
      "/entries?type=repair#top",
    );
  });

  it("falls back when the Referer is a different origin", () => {
    expect(safeReferer(withReferer("https://evil.example/phish"), APP)).toBe("/dashboard");
  });

  it("falls back when the Referer is the same host on a different scheme or port", () => {
    expect(safeReferer(withReferer("http://app.example/entries"), APP)).toBe("/dashboard");
    expect(safeReferer(withReferer("https://app.example:8443/entries"), APP)).toBe("/dashboard");
  });

  it("falls back when the Referer header is absent", () => {
    expect(safeReferer(withReferer(null), APP)).toBe("/dashboard");
  });

  it("falls back when the Referer is unparseable", () => {
    expect(safeReferer(withReferer("http://"), APP)).toBe("/dashboard");
  });

  it("honours a caller-supplied fallback", () => {
    expect(safeReferer(withReferer("https://evil.example/"), APP, "/")).toBe("/");
  });
});
