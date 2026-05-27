import { useState } from "react";
import type { Car, CarFormData, EngineType } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface CarFormProps {
  car?: Car;
  onSuccess: (car: Car) => void;
  onCancel?: () => void;
}

const ENGINE_TYPES: { value: EngineType; label: string }[] = [
  { value: "gas", label: "Gasoline" },
  { value: "diesel", label: "Diesel" },
  { value: "electric", label: "Electric" },
  { value: "lpg", label: "LPG" },
];

const emptyForm = (): CarFormData => ({
  brand: "",
  model: "",
  production_year: "",
  registration_number: null,
  engine_type: "gas",
  engine_capacity: "",
  engine_power: "",
  engine_code: null,
  vin_number: null,
});

export default function CarForm({ car, onSuccess, onCancel }: CarFormProps) {
  const [form, setForm] = useState<CarFormData>(() =>
    car
      ? {
          brand: car.brand,
          model: car.model,
          production_year: car.production_year,
          registration_number: car.registration_number,
          engine_type: car.engine_type,
          engine_capacity: car.engine_capacity,
          engine_power: car.engine_power,
          engine_code: car.engine_code,
          vin_number: car.vin_number,
        }
      : emptyForm(),
  );
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof CarFormData, string>>>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const isEditMode = !!car;

  function setField<K extends keyof CarFormData>(key: K, value: CarFormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  function validate(): boolean {
    const errors: Partial<Record<keyof CarFormData, string>> = {};
    if (!form.brand.trim()) errors.brand = "Brand is required";
    if (!form.model.trim()) errors.model = "Model is required";
    if (!form.production_year.trim()) errors.production_year = "Production year is required";
    if (!form.engine_capacity.trim()) errors.engine_capacity = "Engine capacity is required";
    if (!form.engine_power.trim()) errors.engine_power = "Engine power is required";
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!validate()) return;
    setApiError(null);
    setIsLoading(true);
    try {
      const url = isEditMode ? `/api/cars/${car.id}` : "/api/cars";
      const method = isEditMode ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = (await res.json()) as { car?: Car; error?: string };
      if (!res.ok) {
        setApiError(json.error ?? "An error occurred");
        return;
      }
      if (json.car) onSuccess(json.car);
    } catch {
      setApiError("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="brand">Brand *</Label>
          <Input
            id="brand"
            value={form.brand}
            onChange={(e) => {
              setField("brand", e.target.value);
            }}
            placeholder="e.g. Toyota"
          />
          {fieldErrors.brand && <p className="text-destructive text-sm">{fieldErrors.brand}</p>}
        </div>

        <div className="space-y-1">
          <Label htmlFor="model">Model *</Label>
          <Input
            id="model"
            value={form.model}
            onChange={(e) => {
              setField("model", e.target.value);
            }}
            placeholder="e.g. Corolla"
          />
          {fieldErrors.model && <p className="text-destructive text-sm">{fieldErrors.model}</p>}
        </div>

        <div className="space-y-1">
          <Label htmlFor="production_year">Production year *</Label>
          <Input
            id="production_year"
            value={form.production_year}
            onChange={(e) => {
              setField("production_year", e.target.value);
            }}
            placeholder="e.g. 2020"
          />
          {fieldErrors.production_year && <p className="text-destructive text-sm">{fieldErrors.production_year}</p>}
        </div>

        <div className="space-y-1">
          <Label htmlFor="registration_number">Registration number</Label>
          <Input
            id="registration_number"
            value={form.registration_number ?? ""}
            onChange={(e) => {
              setField("registration_number", e.target.value || null);
            }}
            placeholder="e.g. ABC 1234"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="engine_type">Engine type *</Label>
          <Select
            value={form.engine_type}
            onValueChange={(v) => {
              setField("engine_type", v as EngineType);
            }}
          >
            <SelectTrigger id="engine_type">
              <SelectValue placeholder="Select engine type" />
            </SelectTrigger>
            <SelectContent>
              {ENGINE_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="engine_capacity">Engine capacity *</Label>
          <Input
            id="engine_capacity"
            value={form.engine_capacity}
            onChange={(e) => {
              setField("engine_capacity", e.target.value);
            }}
            placeholder="e.g. 1.6L"
          />
          {fieldErrors.engine_capacity && <p className="text-destructive text-sm">{fieldErrors.engine_capacity}</p>}
        </div>

        <div className="space-y-1">
          <Label htmlFor="engine_power">Engine power *</Label>
          <Input
            id="engine_power"
            value={form.engine_power}
            onChange={(e) => {
              setField("engine_power", e.target.value);
            }}
            placeholder="e.g. 132hp"
          />
          {fieldErrors.engine_power && <p className="text-destructive text-sm">{fieldErrors.engine_power}</p>}
        </div>

        <div className="space-y-1">
          <Label htmlFor="engine_code">Engine code</Label>
          <Input
            id="engine_code"
            value={form.engine_code ?? ""}
            onChange={(e) => {
              setField("engine_code", e.target.value || null);
            }}
            placeholder="e.g. 1ZR-FE"
          />
        </div>

        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="vin_number">VIN number</Label>
          <Input
            id="vin_number"
            value={form.vin_number ?? ""}
            onChange={(e) => {
              setField("vin_number", e.target.value || null);
            }}
            placeholder="e.g. JT2BF22K1W0037699"
          />
        </div>
      </div>

      {apiError && <p className="text-destructive text-sm">{apiError}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={isLoading}>
          {isLoading ? "Saving..." : isEditMode ? "Save changes" : "Add car"}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={isLoading}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
