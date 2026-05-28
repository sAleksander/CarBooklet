-- ─── repair_entries ───────────────────────────────────────────────────────────

CREATE TABLE public.repair_entries (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id       UUID        NOT NULL REFERENCES public.cars(id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conducted_at DATE        NOT NULL,
  mileage      INTEGER,
  description  TEXT        NOT NULL,
  cause        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.repair_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own repair entries"
  ON public.repair_entries FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own repair entries"
  ON public.repair_entries FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own repair entries"
  ON public.repair_entries FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own repair entries"
  ON public.repair_entries FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER repair_entries_updated_at
  BEFORE UPDATE ON public.repair_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ─── oil_change_entries ───────────────────────────────────────────────────────

CREATE TABLE public.oil_change_entries (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id       UUID        NOT NULL REFERENCES public.cars(id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conducted_at DATE        NOT NULL,
  mileage      INTEGER,
  oil_details  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.oil_change_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own oil change entries"
  ON public.oil_change_entries FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own oil change entries"
  ON public.oil_change_entries FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own oil change entries"
  ON public.oil_change_entries FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own oil change entries"
  ON public.oil_change_entries FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER oil_change_entries_updated_at
  BEFORE UPDATE ON public.oil_change_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ─── inspection_entries ───────────────────────────────────────────────────────

CREATE TABLE public.inspection_entries (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id               UUID        NOT NULL REFERENCES public.cars(id) ON DELETE CASCADE,
  user_id              UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conducted_at         DATE        NOT NULL,
  mileage              INTEGER,
  result               TEXT,
  next_inspection_date DATE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.inspection_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own inspection entries"
  ON public.inspection_entries FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own inspection entries"
  ON public.inspection_entries FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own inspection entries"
  ON public.inspection_entries FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own inspection entries"
  ON public.inspection_entries FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER inspection_entries_updated_at
  BEFORE UPDATE ON public.inspection_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ─── insurance_entries ────────────────────────────────────────────────────────

CREATE TABLE public.insurance_entries (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id             UUID        NOT NULL REFERENCES public.cars(id) ON DELETE CASCADE,
  user_id            UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conducted_at       DATE        NOT NULL,
  mileage            INTEGER,
  insurer            TEXT,
  policy_start_date  DATE,
  renewal_date       DATE        NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.insurance_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own insurance entries"
  ON public.insurance_entries FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own insurance entries"
  ON public.insurance_entries FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own insurance entries"
  ON public.insurance_entries FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own insurance entries"
  ON public.insurance_entries FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER insurance_entries_updated_at
  BEFORE UPDATE ON public.insurance_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
