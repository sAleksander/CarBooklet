import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Car, CarFormData, EngineType } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { statusErrorKey } from "@/lib/http-error-copy";

interface CarFormProps {
  car?: Car;
  onSuccess: (car: Car) => void;
  onCancel?: () => void;
}

const ENGINE_TYPE_VALUES: EngineType[] = ["gas", "diesel", "electric", "lpg"];
const ENGINE_TYPE_KEYS: Record<EngineType, string> = {
  gas: "cars.form.gasoline",
  diesel: "cars.form.diesel",
  electric: "cars.form.electric",
  lpg: "cars.form.lpg",
};

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
  const { t } = useTranslation();
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
    if (!form.brand.trim()) errors.brand = t("cars.form.brandRequired");
    if (!form.model.trim()) errors.model = t("cars.form.modelRequired");
    if (!form.production_year.trim()) errors.production_year = t("cars.form.yearRequired");
    if (!form.engine_capacity.trim()) errors.engine_capacity = t("cars.form.capacityRequired");
    if (!form.engine_power.trim()) errors.engine_power = t("cars.form.powerRequired");
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
      const json = (await res.json()) as { car?: Car };
      if (!res.ok) {
        setApiError(t(statusErrorKey(res.status)));
        return;
      }
      if (json.car) onSuccess(json.car);
    } catch {
      setApiError(t("common.networkError"));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="brand">{t("cars.form.brand")}</Label>
          <Input
            id="brand"
            value={form.brand}
            onChange={(e) => {
              setField("brand", e.target.value);
            }}
            placeholder="e.g. Toyota"
          />
          {fieldErrors.brand && <p className="text-sm text-destructive">{fieldErrors.brand}</p>}
        </div>

        <div className="space-y-1">
          <Label htmlFor="model">{t("cars.form.model")}</Label>
          <Input
            id="model"
            value={form.model}
            onChange={(e) => {
              setField("model", e.target.value);
            }}
            placeholder="e.g. Corolla"
          />
          {fieldErrors.model && <p className="text-sm text-destructive">{fieldErrors.model}</p>}
        </div>

        <div className="space-y-1">
          <Label htmlFor="production_year">{t("cars.form.productionYear")}</Label>
          <Input
            id="production_year"
            value={form.production_year}
            onChange={(e) => {
              setField("production_year", e.target.value);
            }}
            placeholder="e.g. 2020"
          />
          {fieldErrors.production_year && <p className="text-sm text-destructive">{fieldErrors.production_year}</p>}
        </div>

        <div className="space-y-1">
          <Label htmlFor="registration_number">{t("cars.form.registrationNumber")}</Label>
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
          <Label htmlFor="engine_type">{t("cars.form.engineType")}</Label>
          <Select
            value={form.engine_type}
            onValueChange={(v) => {
              setField("engine_type", v as EngineType);
            }}
          >
            <SelectTrigger id="engine_type">
              <SelectValue placeholder={t("cars.form.selectEngineType")} />
            </SelectTrigger>
            <SelectContent>
              {ENGINE_TYPE_VALUES.map((engineType) => (
                <SelectItem key={engineType} value={engineType}>
                  {t(ENGINE_TYPE_KEYS[engineType])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="engine_capacity">{t("cars.form.engineCapacity")}</Label>
          <Input
            id="engine_capacity"
            value={form.engine_capacity}
            onChange={(e) => {
              setField("engine_capacity", e.target.value);
            }}
            placeholder="e.g. 1.6L"
          />
          {fieldErrors.engine_capacity && <p className="text-sm text-destructive">{fieldErrors.engine_capacity}</p>}
        </div>

        <div className="space-y-1">
          <Label htmlFor="engine_power">{t("cars.form.enginePower")}</Label>
          <Input
            id="engine_power"
            value={form.engine_power}
            onChange={(e) => {
              setField("engine_power", e.target.value);
            }}
            placeholder="e.g. 132hp"
          />
          {fieldErrors.engine_power && <p className="text-sm text-destructive">{fieldErrors.engine_power}</p>}
        </div>

        <div className="space-y-1">
          <Label htmlFor="engine_code">{t("cars.form.engineCode")}</Label>
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
          <Label htmlFor="vin_number">{t("cars.form.vinNumber")}</Label>
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

      {apiError && <p className="text-sm text-destructive">{apiError}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={isLoading}>
          {isLoading ? t("cars.form.saving") : isEditMode ? t("common.save") : t("cars.form.addCar")}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={isLoading}>
            {t("common.cancel")}
          </Button>
        )}
      </div>
    </form>
  );
}
