-- Restore nullability on `insurance_entries.insurer` and `inspection_entries.result`.
--
-- This reverses 20260528000002 and 20260528000003, which made both columns
-- NOT NULL. Those migrations outran the product: every piece of evidence in the
-- app says both fields are optional.
--
--   - src/components/entries/InsuranceEntryForm.tsx sends `insurer: null` when
--     the field is left blank — there is no required-field guard on it.
--   - src/components/entries/InspectionEntryForm.tsx defaults `result` to null
--     and offers "Not recorded" as an explicit choice in the select.
--   - src/components/entries/InsuranceEntryList.tsx renders the insurer line
--     conditionally, i.e. it was written expecting the value to be absent.
--   - The zod schemas at the API edge accept null for both.
--
-- So the NOT NULL constraints turned a supported user action into a 500: the
-- form submits, zod passes, and the insert fails at the floor with raw Postgres
-- constraint text. Widening the column is the side to fix — tightening the
-- forms would remove behaviour the product deliberately offers.
--
-- Safe on existing data: this widens the contract, so no existing row can
-- violate it. Note the asymmetry for later — re-tightening would require
-- backfilling every null first, which is why the reasoning is recorded here
-- rather than left to be re-derived.

ALTER TABLE public.insurance_entries ALTER COLUMN insurer DROP NOT NULL;
ALTER TABLE public.inspection_entries ALTER COLUMN result DROP NOT NULL;
