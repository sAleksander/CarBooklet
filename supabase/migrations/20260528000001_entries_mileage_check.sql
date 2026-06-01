ALTER TABLE public.repair_entries     ADD CONSTRAINT repair_entries_mileage_positive     CHECK (mileage > 0);
ALTER TABLE public.oil_change_entries ADD CONSTRAINT oil_change_entries_mileage_positive CHECK (mileage > 0);
ALTER TABLE public.inspection_entries ADD CONSTRAINT inspection_entries_mileage_positive CHECK (mileage > 0);
ALTER TABLE public.insurance_entries  ADD CONSTRAINT insurance_entries_mileage_positive  CHECK (mileage > 0);
