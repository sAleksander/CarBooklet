import { describe, it, expect } from "vitest";
import en from "@/i18n/locales/en.json";
import pl from "@/i18n/locales/pl.json";

/**
 * The gate that stops a half-translated key from shipping.
 *
 * Every island bundles both locales (`src/i18n/config.ts:10-13`), and a key
 * present in one file and absent from the other does not fail a build, a type
 * check, or a lint — i18next simply renders the key path back to the user. That
 * is a silent failure with a visible symptom, and until this test there was
 * nothing anywhere in `src/`, `e2e/`, `integration/`, `scripts/` or `.github/`
 * that would catch it.
 *
 * Comparison is on *base* keys, with CLDR plural suffixes stripped, because the
 * two files are legitimately different sizes: English needs `_one`/`_other` for
 * `auth.passwordCharactersNeeded` while Polish needs `_one`/`_few`/`_many`.
 * Comparing raw key sets would fail on correct Polish, which is exactly the
 * wrong thing to teach a future contributor about plurals.
 */

interface Tree {
  [key: string]: string | Tree;
}

/** Dot-path every leaf, so `{a:{b:"x"}}` becomes `["a.b"]`. */
function flatten(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === "object" ? flatten(value, `${prefix}${key}.`) : [`${prefix}${key}`],
  );
}

/**
 * The six CLDR plural categories i18next appends. Anchored to the end and
 * applied once — a key is allowed to *contain* `_one`, only not to end in it.
 */
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

const baseKey = (key: string) => key.replace(PLURAL_SUFFIX, "");

const baseKeys = (tree: Tree) => new Set(flatten(tree).map(baseKey));

function leaves(tree: Tree, prefix = ""): [string, unknown][] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === "object" ? leaves(value, `${prefix}${key}.`) : [[`${prefix}${key}`, value] as [string, unknown]],
  );
}

const EN = en as Tree;
const PL = pl as Tree;

describe("locale parity", () => {
  it("covers the same base keys in both locales", () => {
    const enKeys = baseKeys(EN);
    const plKeys = baseKeys(PL);

    const missingFromPl = [...enKeys].filter((key) => !plKeys.has(key)).sort();
    const missingFromEn = [...plKeys].filter((key) => !enKeys.has(key)).sort();

    // Asserted as arrays rather than set sizes so a failure names the offending
    // keys instead of reporting "expected 192 to be 191".
    expect(missingFromPl, "keys in en.json with no pl.json counterpart").toEqual([]);
    expect(missingFromEn, "keys in pl.json with no en.json counterpart").toEqual([]);
  });

  it("allows Polish to carry plural forms English does not", () => {
    // Guards the stripping itself: if `PLURAL_SUFFIX` ever stopped matching, the
    // test above would start failing on correct Polish and someone would delete
    // the Polish forms to make it green.
    const raw = (tree: Tree) => new Set(flatten(tree));
    expect(raw(PL).has("auth.passwordCharactersNeeded_few")).toBe(true);
    expect(raw(EN).has("auth.passwordCharactersNeeded_few")).toBe(false);
    expect(baseKeys(EN).has("auth.passwordCharactersNeeded")).toBe(true);
    expect(baseKeys(PL).has("auth.passwordCharactersNeeded")).toBe(true);
  });

  it("agrees on which leaves are deliberately blank", () => {
    // Not "never empty": `entries.placeholders.nextInspectionDate` and
    // `.policyStart` are blank in both files on purpose — a date input takes no
    // placeholder. What must never happen is a key with copy in one locale and
    // a blank in the other, which renders an empty label to half the users.
    const value = (tree: Tree, key: string) =>
      key.split(".").reduce<string | Tree | undefined>((node, part) => {
        if (typeof node !== "object") return undefined;
        return node[part];
      }, tree);

    const mismatched = flatten(EN)
      .filter((key) => {
        const enValue = value(EN, key);
        const plValue = value(PL, key);
        if (typeof enValue !== "string" || typeof plValue !== "string") return false;
        return (enValue.trim() === "") !== (plValue.trim() === "");
      })
      .sort();

    expect(mismatched, "keys blank in one locale but not the other").toEqual([]);
  });

  it("has a string at every leaf", () => {
    for (const [locale, tree] of [
      ["en", EN],
      ["pl", PL],
    ] as const) {
      const bad = leaves(tree)
        .filter(([, leaf]) => typeof leaf !== "string")
        .map(([key]) => key);
      expect(bad, `non-string values in ${locale}.json`).toEqual([]);
    }
  });
});
