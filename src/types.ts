export type EngineType = "electric" | "gas" | "diesel" | "lpg";

export interface Car {
  id: string;
  user_id: string;
  brand: string;
  model: string;
  production_year: string;
  registration_number: string | null;
  engine_type: EngineType;
  engine_capacity: string;
  engine_power: string;
  engine_code: string | null;
  vin_number: string | null;
  created_at: string;
  updated_at: string;
}
