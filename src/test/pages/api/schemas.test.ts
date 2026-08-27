import { describe, it, expect } from "vitest";
import type { ZodType } from "zod";
import { carSchema } from "@/pages/api/cars/index";
import { patchSchema as carPatchSchema } from "@/pages/api/cars/[id]";
import { repairEntrySchema, repairEntryPatchSchema } from "@/pages/api/entries/repair";
import { oilChangeEntrySchema, oilChangeEntryPatchSchema } from "@/pages/api/entries/oil-change";
import { inspectionEntrySchema, inspectionEntryPatchSchema } from "@/pages/api/entries/inspection";
import { insuranceEntrySchema, insuranceEntryPatchSchema } from "@/pages/api/entries/insurance";
import { MAX_MILEAGE } from "@/lib/validators";

/**
 * The API edge as pure functions.
 *
 * These schemas are the only server-side validation between a request body and
 * the database. Pinning them here — in the Docker-free `unit` project, so the
 * pre-commit hook keeps running them — closes the loop opened by
 * `integration/validation-constraints.test.ts`: that file asserts what the
 * database refuses, this one asserts what the edge refuses, and R5's real
 * question is whether the two agree.
 *
 * They did not. Three gaps, closed in this phase and pinned below:
 *
 * | field                | edge said        | database said   | fixed on   |
 * | -------------------- | ---------------- | --------------- | ---------- |
 * | `mileage`            | `.min(0)`        | `CHECK (> 0)`   | the edge   |
 * | `insurer`            | nullable         | `NOT NULL`      | the database |
 * | inspection `result`  | nullable         | `NOT NULL`      | the database |
 *
 * The direction of each fix is not arbitrary. `mileage: 0` is meaningless, so
 * the constraint was right and the schema was wrong. `insurer` and `result` are
 * optional everywhere in the product — the forms ship them empty and the list
 * renders them conditionally — so the schemas were right and two later
 * migrations had overreached. Both used to produce a 500 from a supported user
 * action; neither can now.
 */

interface SchemaCase {
  label: string;
  schema: ZodType;
  /** A payload that must parse cleanly, used as the base for each variation. */
  valid: Record<string, unknown>;
}

const UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

const ENTRY_CREATE_SCHEMAS: SchemaCase[] = [
  {
    label: "repair (create)",
    schema: repairEntrySchema,
    valid: { car_id: UUID, conducted_at: "2026-01-01", mileage: 1000, description: "Brake pads" },
  },
  {
    label: "oil_change (create)",
    schema: oilChangeEntrySchema,
    valid: { car_id: UUID, conducted_at: "2026-01-01", mileage: 1000, oil_details: "5W-30" },
  },
  {
    label: "inspection (create)",
    schema: inspectionEntrySchema,
    valid: { car_id: UUID, conducted_at: "2026-01-01", mileage: 1000, result: "Passed" },
  },
  {
    label: "insurance (create)",
    schema: insuranceEntrySchema,
    valid: { car_id: UUID, conducted_at: "2026-01-01", mileage: 1000, insurer: "Acme", renewal_date: "2027-01-01" },
  },
];

const ENTRY_PATCH_SCHEMAS: SchemaCase[] = [
  {
    label: "repair (patch)",
    schema: repairEntryPatchSchema,
    valid: { id: UUID, conducted_at: "2026-01-01", mileage: 1000, description: "Brake pads" },
  },
  {
    label: "oil_change (patch)",
    schema: oilChangeEntryPatchSchema,
    valid: { id: UUID, conducted_at: "2026-01-01", mileage: 1000, oil_details: "5W-30" },
  },
  {
    label: "inspection (patch)",
    schema: inspectionEntryPatchSchema,
    valid: { id: UUID, conducted_at: "2026-01-01", mileage: 1000, result: "Passed" },
  },
  {
    label: "insurance (patch)",
    schema: insuranceEntryPatchSchema,
    valid: { id: UUID, conducted_at: "2026-01-01", mileage: 1000, insurer: "Acme", renewal_date: "2027-01-01" },
  },
];

const ALL_ENTRY_SCHEMAS = [...ENTRY_CREATE_SCHEMAS, ...ENTRY_PATCH_SCHEMAS];

/** First issue message, or "" when the parse succeeded. */
function firstIssue(schema: ZodType, value: unknown): string {
  const parsed = schema.safeParse(value);
  return parsed.success ? "" : parsed.error.issues[0].message;
}

describe("API edge schemas", () => {
  describe.each(ALL_ENTRY_SCHEMAS)("$label · mileage", ({ schema, valid }) => {
    it("baseline payload parses", () => {
      expect(schema.safeParse(valid).success).toBe(true);
    });

    it("rejects 0 with a readable message", () => {
      // The gap that used to reach the database: `.min(0)` let this through and
      // `CHECK (mileage > 0)` answered with a 500 carrying Postgres constraint
      // text. It is a 400 now, and the message is one a user can act on.
      const parsed = schema.safeParse({ ...valid, mileage: 0 });
      expect(parsed.success).toBe(false);
      expect(firstIssue(schema, { ...valid, mileage: 0 })).toBe("Mileage must be greater than 0");
    });

    it("rejects a negative value", () => {
      expect(schema.safeParse({ ...valid, mileage: -1 }).success).toBe(false);
    });

    it("rejects a non-integer", () => {
      expect(schema.safeParse({ ...valid, mileage: 1.5 }).success).toBe(false);
    });

    it("accepts 1 — the boundary the constraint actually draws", () => {
      expect(schema.safeParse({ ...valid, mileage: 1 }).success).toBe(true);
    });

    it("rejects a value past the column's integer range", () => {
      // The mirror of the `0` gap at the other end: `.min(1)` had no ceiling, so
      // this reached the database and came back `22003 numeric field overflow`.
      expect(firstIssue(schema, { ...valid, mileage: 99999999999 })).toBe(`Mileage must be ${MAX_MILEAGE} or less`);
    });

    it("accepts MAX_MILEAGE itself — the bound is inclusive", () => {
      // Pinning the boundary rather than a value near it: an off-by-one here
      // would reject a legal mileage, which is worse than the bug being fixed.
      expect(schema.safeParse({ ...valid, mileage: MAX_MILEAGE }).success).toBe(true);
      expect(schema.safeParse({ ...valid, mileage: MAX_MILEAGE + 1 }).success).toBe(false);
    });

    it("accepts null and omitted — mileage is optional", () => {
      expect(schema.safeParse({ ...valid, mileage: null }).success).toBe(true);

      const { mileage: _omitted, ...withoutMileage } = valid;
      expect(schema.safeParse(withoutMileage).success).toBe(true);
    });
  });

  describe.each(ALL_ENTRY_SCHEMAS)("$label · dates and ids", ({ schema, valid }) => {
    it("rejects a conducted_at that is not YYYY-MM-DD", () => {
      expect(firstIssue(schema, { ...valid, conducted_at: "01/01/2026" })).toBe("Date must be YYYY-MM-DD");
    });

    it("rejects a non-uuid identifier", () => {
      const idKey = "car_id" in valid ? "car_id" : "id";
      expect(schema.safeParse({ ...valid, [idKey]: "not-a-uuid" }).success).toBe(false);
    });

    // The shape rule above passes `2026-02-30` — four digits, two, two. Postgres
    // answers that with `22008`, i.e. a 500 for a plain client mistake. These
    // cases are the refinement that moves it to the edge.
    it.each([
      ["2026-02-30", "a day that month does not have"],
      ["2026-13-01", "a month that does not exist"],
      ["2026-00-10", "month zero"],
      ["2026-01-32", "day 32"],
      ["2026-04-31", "April 31st"],
    ])("rejects %s — %s", (date) => {
      expect(firstIssue(schema, { ...valid, conducted_at: date })).toBe("Date is not a real calendar date");
    });

    it("accepts 2028-02-29 — a real leap day", () => {
      // The case a naive refinement gets wrong in the other direction. 2028 is
      // divisible by 4 and not by 100, so February has 29 days.
      expect(schema.safeParse({ ...valid, conducted_at: "2028-02-29" }).success).toBe(true);
    });

    it("rejects 2026-02-29 — the same date in a non-leap year", () => {
      // The pair. Without this, a refinement that accepted every February 29th
      // would satisfy the case above.
      expect(firstIssue(schema, { ...valid, conducted_at: "2026-02-29" })).toBe("Date is not a real calendar date");
    });

    it("rejects 2100-02-29 — divisible by 4 but not a leap year", () => {
      // The century rule. 2100 is divisible by 4 and by 100 but not by 400, so
      // it is not a leap year — the clause a three-line leap check usually drops.
      expect(firstIssue(schema, { ...valid, conducted_at: "2100-02-29" })).toBe("Date is not a real calendar date");
    });

    it("accepts 2000-02-29 — divisible by 400, so a leap year after all", () => {
      expect(schema.safeParse({ ...valid, conducted_at: "2000-02-29" }).success).toBe(true);
    });

    it.each(["0000-01-01", "0000-02-29"])("rejects %s — Postgres has no year zero", (date) => {
      // Without a year floor these pass the calendar check (year 0 is divisible
      // by 400) and reach the database, which answers 22008 — a 500-shaped
      // surprise for what the edge should have caught.
      expect(firstIssue(schema, { ...valid, conducted_at: date })).toBe("Date is not a real calendar date");
    });

    it("reports the shape error first when the input is not a date at all", () => {
      // Zod runs .refine even when .regex fails, so a malformed value produces
      // two issues. Routes render issues[0], so the ordering is what the user
      // actually sees — and it is the reason the refinement must cope with NaN
      // rather than assume a well-formed string.
      const parsed = schema.safeParse({ ...valid, conducted_at: "01/01/2026" });

      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues[0].message).toBe("Date must be YYYY-MM-DD");
      }
    });
  });

  // The other ten date fields. `conducted_at` is covered above for all eight
  // schemas; these four are the ones no test reached before they started sharing
  // the `isoDate` helper, which is exactly why they are worth naming.
  describe.each([
    ["insurance (create) · renewal_date", insuranceEntrySchema, "renewal_date", "Renewal date must be YYYY-MM-DD"],
    ["insurance (patch) · renewal_date", insuranceEntryPatchSchema, "renewal_date", "Renewal date must be YYYY-MM-DD"],
    ["insurance (create) · policy_start_date", insuranceEntrySchema, "policy_start_date", "Date must be YYYY-MM-DD"],
    [
      "insurance (patch) · policy_start_date",
      insuranceEntryPatchSchema,
      "policy_start_date",
      "Date must be YYYY-MM-DD",
    ],
    [
      "inspection (create) · next_inspection_date",
      inspectionEntrySchema,
      "next_inspection_date",
      "Date must be YYYY-MM-DD",
    ],
    [
      "inspection (patch) · next_inspection_date",
      inspectionEntryPatchSchema,
      "next_inspection_date",
      "Date must be YYYY-MM-DD",
    ],
  ])("%s", (_label, schema, field, shapeMessage) => {
    const base = {
      id: UUID,
      car_id: UUID,
      conducted_at: "2026-01-01",
      renewal_date: "2027-01-01",
    };

    it("rejects a malformed shape with its own message", () => {
      expect(firstIssue(schema, { ...base, [field]: "01/01/2026" })).toBe(shapeMessage);
    });

    it("rejects a well-shaped date that is not real", () => {
      expect(firstIssue(schema, { ...base, [field]: "2026-02-30" })).toBe("Date is not a real calendar date");
    });

    it("accepts a real leap day", () => {
      expect(schema.safeParse({ ...base, [field]: "2028-02-29" }).success).toBe(true);
    });
  });

  describe("insurance · insurer is optional at the edge", () => {
    it.each([insuranceEntrySchema, insuranceEntryPatchSchema])("accepts null and omitted (%#)", (schema) => {
      const base = { id: UUID, car_id: UUID, conducted_at: "2026-01-01", renewal_date: "2027-01-01" };

      // The database used to disagree; 20260825000001 relaxed it. The insurance
      // form sends exactly this when the field is left blank.
      expect(schema.safeParse({ ...base, insurer: null }).success).toBe(true);
      expect(schema.safeParse(base).success).toBe(true);
    });

    it("still requires renewal_date", () => {
      const { renewal_date: _dropped, ...withoutRenewal } = {
        car_id: UUID,
        conducted_at: "2026-01-01",
        insurer: "Acme",
        renewal_date: "2027-01-01",
      };
      expect(insuranceEntrySchema.safeParse(withoutRenewal).success).toBe(false);
    });
  });

  describe("inspection · result is optional but enum-bound", () => {
    it.each([inspectionEntrySchema, inspectionEntryPatchSchema])("accepts null and omitted (%#)", (schema) => {
      const base = { id: UUID, car_id: UUID, conducted_at: "2026-01-01" };

      // "Not recorded" in the form select is this null.
      expect(schema.safeParse({ ...base, result: null }).success).toBe(true);
      expect(schema.safeParse(base).success).toBe(true);
    });

    it.each([inspectionEntrySchema, inspectionEntryPatchSchema])("rejects an out-of-enum result (%#)", (schema) => {
      const base = { id: UUID, car_id: UUID, conducted_at: "2026-01-01" };
      expect(schema.safeParse({ ...base, result: "Pending" }).success).toBe(false);
    });

    it.each([inspectionEntrySchema, inspectionEntryPatchSchema])("accepts both declared values (%#)", (schema) => {
      const base = { id: UUID, car_id: UUID, conducted_at: "2026-01-01" };
      expect(schema.safeParse({ ...base, result: "Passed" }).success).toBe(true);
      expect(schema.safeParse({ ...base, result: "Failed" }).success).toBe(true);
    });
  });

  describe("cars", () => {
    const validCar = {
      brand: "Volvo",
      model: "V60",
      production_year: "2019",
      engine_type: "diesel",
      engine_capacity: "2.0L",
      engine_power: "190hp",
    };

    it("accepts a complete payload", () => {
      expect(carSchema.safeParse(validCar).success).toBe(true);
    });

    it("rejects an out-of-enum engine_type", () => {
      // Mirrors the `22P02` the database raises for the same value — see
      // integration/validation-constraints.test.ts. Both ends now agree.
      expect(carSchema.safeParse({ ...validCar, engine_type: "steam" }).success).toBe(false);
      expect(carPatchSchema.safeParse({ engine_type: "steam" }).success).toBe(false);
    });

    it.each(["electric", "gas", "diesel", "lpg"])("accepts engine_type %s", (engineType) => {
      expect(carSchema.safeParse({ ...validCar, engine_type: engineType }).success).toBe(true);
    });

    it("requires brand and model", () => {
      expect(firstIssue(carSchema, { ...validCar, brand: "" })).toBe("Brand is required");
      expect(firstIssue(carSchema, { ...validCar, model: "" })).toBe("Model is required");
    });

    it("treats the optional car fields as optional", () => {
      expect(
        carSchema.safeParse({ ...validCar, registration_number: null, engine_code: null, vin_number: null }).success,
      ).toBe(true);
    });

    it("accepts a patch that names a single field", () => {
      // The patch schema is all-optional by construction; a one-field edit is
      // the shape the UI actually sends.
      expect(carPatchSchema.safeParse({ model: "V90" }).success).toBe(true);
    });
  });
});
