/**
 * Every notice a rule rings in the bell carries its title and message in the
 * app's eight languages: the engine writes each reader's notice in her own
 * language (Adminium 0.3.35), so a missing one would fall back to another.
 *
 * That the reader gets hers is proved against an install (`proofs/crm-rules`).
 */

import { describe, expect, it } from "vitest";

import manifest from "../../whole/manifest.json";

const LOCALES = ["en-US", "de-DE", "fr-FR", "da-DK", "cs-CZ", "ar-EG", "zh-CN", "zh-TW"];

interface Notice {
  rule: string;
  title: unknown;
  body: unknown;
}

function notices(): Notice[] {
  const found: Notice[] = [];
  const walk = (rule: string, node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    const step = node as Record<string, unknown>;
    if (step["kind"] === "notification") found.push({ rule, title: step["title"], body: step["body"] });
    for (const value of Object.values(step)) walk(rule, value);
  };
  for (const rule of (manifest as unknown as { automations: { key: string; graph: unknown }[] }).automations) walk(rule.key, rule.graph);
  return found;
}

describe("the rules' notices", () => {
  it("are there to read: at least one notice step per rule that tells somebody", () => {
    expect(notices().length).toBeGreaterThanOrEqual(18);
  });

  it("give the title and the message in all eight languages, never one text for all", () => {
    for (const notice of notices()) {
      for (const part of ["title", "body"] as const) {
        const words = notice[part];
        if (words === undefined || words === null) continue;
        expect(typeof words, `${notice.rule} ${part}`).toBe("object");
        expect(Object.keys(words as Record<string, string>).sort(), `${notice.rule} ${part}`).toEqual([...LOCALES].sort());
        for (const locale of LOCALES) expect((words as Record<string, string>)[locale]?.trim(), `${notice.rule} ${part} ${locale}`).toBeTruthy();
      }
    }
  });

  it("name the same placeholders in every language as in English", () => {
    const named = (text: string): string[] => [...text.matchAll(/\{\{\s*([^}|\s]+)/g)].map((match) => match[1]!).sort();
    for (const notice of notices()) {
      for (const part of ["title", "body"] as const) {
        const words = notice[part] as Record<string, string> | undefined | null;
        if (words === undefined || words === null) continue;
        for (const locale of LOCALES) expect(named(words[locale]!), `${notice.rule} ${part} ${locale}`).toEqual(named(words["en-US"]!));
      }
    }
  });
});
