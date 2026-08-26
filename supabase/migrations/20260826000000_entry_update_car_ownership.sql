-- Entry UPDATE policies: verify car ownership, closing the second door onto `car_id`.
--
-- 20260825000000 hardened the four `FOR INSERT` policies so an entry cannot be
-- created against someone else's car. It left the four `FOR UPDATE` policies as
-- 20260528000000 wrote them — `USING (auth.uid() = user_id)` and
-- `WITH CHECK (auth.uid() = user_id)`, neither of which looks at `car_id`.
--
-- That leaves the fix reachable around. A user inserts an entry onto their own
-- car (which the INSERT policy allows, by design) and then updates `car_id` to
-- point at a foreign car. The row that lands is byte-identical to the one the
-- INSERT policy refuses. Verified against the running stack before this
-- migration: the insert answers 403 42501, the two-step lands 200.
--
-- No application path reaches this. The PATCH routes' zod schemas accept the
-- fields they name and `car_id` is not among them, so `car_id` is only ever set
-- at create time. It is one line from any signed-in user's browser console
-- against PostgREST with their own JWT — the same threat model the INSERT
-- migration addresses, which is why it is closed at the same floor.
--
-- The predicate goes on both expressions:
--   WITH CHECK — the row *after* the update must point at a car the caller owns.
--                This is what blocks the move.
--   USING      — the row *before* must too. Redundant once INSERT is closed, but
--                it means a row that somehow points at a foreign car cannot be
--                edited further by anyone. Such a row can still be deleted; the
--                DELETE policies are unchanged and gate on `user_id` alone.
--
-- Moving an entry between two of the caller's *own* cars stays permitted — the
-- predicate only requires that the target car belong to the caller.
--
-- `ALTER POLICY` takes both expressions, so unlike 20260825000000 there is no
-- drop/recreate window and no risk of leaving a table without an UPDATE policy.
-- `TO authenticated` cannot be set in the same statement as the expressions, so
-- the role clause is a second `ALTER` per policy — role list only, expressions
-- untouched (see also: the entries SELECT/DELETE and cars policies still default
-- to `public`; harmless, since `auth.uid()` is NULL for anon and `NULL = user_id`
-- is never TRUE).
--
-- Forward-only and safe on existing data: policies gate statements, not rows, so
-- nothing already stored is invalidated by this.

-- ─── repair_entries ───────────────────────────────────────────────────────────

ALTER POLICY "Users can update own repair entries"
  ON public.repair_entries
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.cars
      WHERE cars.id = repair_entries.car_id
        AND cars.user_id = auth.uid()
    )
  )
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.cars
      WHERE cars.id = repair_entries.car_id
        AND cars.user_id = auth.uid()
    )
  );

ALTER POLICY "Users can update own repair entries"
  ON public.repair_entries TO authenticated;

-- ─── oil_change_entries ───────────────────────────────────────────────────────

ALTER POLICY "Users can update own oil change entries"
  ON public.oil_change_entries
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.cars
      WHERE cars.id = oil_change_entries.car_id
        AND cars.user_id = auth.uid()
    )
  )
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.cars
      WHERE cars.id = oil_change_entries.car_id
        AND cars.user_id = auth.uid()
    )
  );

ALTER POLICY "Users can update own oil change entries"
  ON public.oil_change_entries TO authenticated;

-- ─── inspection_entries ───────────────────────────────────────────────────────

ALTER POLICY "Users can update own inspection entries"
  ON public.inspection_entries
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.cars
      WHERE cars.id = inspection_entries.car_id
        AND cars.user_id = auth.uid()
    )
  )
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.cars
      WHERE cars.id = inspection_entries.car_id
        AND cars.user_id = auth.uid()
    )
  );

ALTER POLICY "Users can update own inspection entries"
  ON public.inspection_entries TO authenticated;

-- ─── insurance_entries ────────────────────────────────────────────────────────

ALTER POLICY "Users can update own insurance entries"
  ON public.insurance_entries
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.cars
      WHERE cars.id = insurance_entries.car_id
        AND cars.user_id = auth.uid()
    )
  )
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.cars
      WHERE cars.id = insurance_entries.car_id
        AND cars.user_id = auth.uid()
    )
  );

ALTER POLICY "Users can update own insurance entries"
  ON public.insurance_entries TO authenticated;

-- ─── Role clause on the remaining policies ────────────────────────────────────
--
-- CLAUDE.md asks for per-operation, *per-role* policies. 20260825000000 added
-- `TO authenticated` to the four INSERT policies it recreated, and the ALTERs
-- above add it to the four UPDATE policies — leaving entries SELECT/DELETE and
-- all four `cars` policies at the `CREATE POLICY` default of `public`. The split
-- implies the role clause carries meaning on some operations and not others,
-- which is not true of either.
--
-- This changes no behaviour. `public` includes `anon`, but `auth.uid()` is NULL
-- for an anonymous request and `NULL = user_id` is never TRUE, so anon already
-- matched no row. `service_role` holds BYPASSRLS and never consults policies at
-- all. The clause is made explicit so every policy reads the same way.
--
-- Role-list-only ALTERs: no USING or WITH CHECK expression is restated here, so
-- there is nothing to get wrong by transcription.

ALTER POLICY "Users can view own cars"   ON public.cars TO authenticated;
ALTER POLICY "Users can insert own cars" ON public.cars TO authenticated;
ALTER POLICY "Users can update own cars" ON public.cars TO authenticated;
ALTER POLICY "Users can delete own cars" ON public.cars TO authenticated;

ALTER POLICY "Users can view own repair entries"   ON public.repair_entries TO authenticated;
ALTER POLICY "Users can delete own repair entries" ON public.repair_entries TO authenticated;

ALTER POLICY "Users can view own oil change entries"   ON public.oil_change_entries TO authenticated;
ALTER POLICY "Users can delete own oil change entries" ON public.oil_change_entries TO authenticated;

ALTER POLICY "Users can view own inspection entries"   ON public.inspection_entries TO authenticated;
ALTER POLICY "Users can delete own inspection entries" ON public.inspection_entries TO authenticated;

ALTER POLICY "Users can view own insurance entries"   ON public.insurance_entries TO authenticated;
ALTER POLICY "Users can delete own insurance entries" ON public.insurance_entries TO authenticated;
