CREATE TYPE public.engine_type AS ENUM ('electric', 'gas', 'diesel', 'lpg');

CREATE TABLE public.cars (
  id                  UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID               NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brand               TEXT               NOT NULL,
  model               TEXT               NOT NULL,
  production_year     TEXT               NOT NULL,
  registration_number TEXT,
  engine_type         public.engine_type NOT NULL,
  engine_capacity     TEXT               NOT NULL,
  engine_power        TEXT               NOT NULL,
  engine_code         TEXT,
  vin_number          TEXT,
  created_at          TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ        NOT NULL DEFAULT NOW()
);

ALTER TABLE public.cars ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own cars"
  ON public.cars FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own cars"
  ON public.cars FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own cars"
  ON public.cars FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own cars"
  ON public.cars FOR DELETE
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER cars_updated_at
  BEFORE UPDATE ON public.cars
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
