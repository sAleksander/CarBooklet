-- Entry INSERT policies: verify car ownership, not just row ownership.
--
-- The four policies created in 20260528000000_entries_schema.sql check only
-- `auth.uid() = user_id`. Nothing looks at `car_id`. A user could therefore
-- insert an entry carrying their own user_id but pointing at *someone else's*
-- car, and the database would accept it.
--
-- The POST routes already refuse this with a 403 (`getCarById` pre-check in
-- src/pages/api/entries/*.ts), which is why it has never been observed in the
-- product. But nothing forces a caller through those routes, and the route
-- check is not what the entries tables are protected by — the policies are.
-- Defense at the route only is defense at one door of two.
--
-- The injected row is invisible to the car's owner (RLS hides it: it carries
-- the attacker's user_id), so the victim cannot detect the pollution on their
-- own car through any query the app makes. That asymmetry is what makes this
-- worth closing at the floor rather than trusting the pre-check.
--
-- A `WITH CHECK` expression cannot be altered in place, so each policy is
-- dropped and recreated. `TO authenticated` is added per CLAUDE.md's
-- per-operation, per-role rule — the originals defaulted to `public`.
--
-- Forward-only and safe on existing data: policies gate new inserts only, so
-- no existing row can be invalidated by this. If a deployed environment might
-- already hold entries pointing at a foreign car, audit them separately —
-- this migration will not surface them.

-- ─── repair_entries ───────────────────────────────────────────────────────────

DROP POLICY "Users can insert own repair entries" ON public.repair_entries;

CREATE POLICY "Users can insert own repair entries"
  ON public.repair_entries FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.cars
      WHERE cars.id = repair_entries.car_id
        AND cars.user_id = auth.uid()
    )
  );

-- ─── oil_change_entries ───────────────────────────────────────────────────────

DROP POLICY "Users can insert own oil change entries" ON public.oil_change_entries;

CREATE POLICY "Users can insert own oil change entries"
  ON public.oil_change_entries FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.cars
      WHERE cars.id = oil_change_entries.car_id
        AND cars.user_id = auth.uid()
    )
  );

-- ─── inspection_entries ───────────────────────────────────────────────────────

DROP POLICY "Users can insert own inspection entries" ON public.inspection_entries;

CREATE POLICY "Users can insert own inspection entries"
  ON public.inspection_entries FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.cars
      WHERE cars.id = inspection_entries.car_id
        AND cars.user_id = auth.uid()
    )
  );

-- ─── insurance_entries ────────────────────────────────────────────────────────

DROP POLICY "Users can insert own insurance entries" ON public.insurance_entries;

CREATE POLICY "Users can insert own insurance entries"
  ON public.insurance_entries FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.cars
      WHERE cars.id = insurance_entries.car_id
        AND cars.user_id = auth.uid()
    )
  );
