import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("Arabic UI text", () => {
  it("has no English words in user-facing strings", () => {
    const src = readFileSync(path.resolve(__dirname, "../src/i18n/ar.ts"), "utf8");
    // Collect string literal contents (quotes and template literals).
    const strings = [...src.matchAll(/"([^"\n]*)"|`([^`]*)`/g)].map((m) => (m[1] ?? m[2]).replace(/\$\{[^}]*\}/g, ""));
    const allowed = /^(ar-EG|numeric|long|short|2-digit|—|…|)$/;
    const offenders = strings.filter((s) => !allowed.test(s) && /[A-Za-z]{2,}/.test(s));
    expect(offenders).toEqual([]);
  });
});
