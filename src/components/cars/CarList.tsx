import { useState } from "react";
import { useTranslation, I18nextProvider } from "react-i18next";
import { createClientI18n } from "@/i18n/client";
import type { Locale } from "@/i18n/config";
import type { Car, EngineType } from "@/types";

const ENGINE_TYPE_KEYS: Record<EngineType, string> = {
  gas: "cars.form.gasoline",
  diesel: "cars.form.diesel",
  electric: "cars.form.electric",
  lpg: "cars.form.lpg",
};
import { Button } from "@/components/ui/button";
import CarForm from "./CarForm";
import DeleteCarDialog from "./DeleteCarDialog";
import { statusErrorKey } from "@/lib/http-error-copy";

interface CarListProps {
  initialCars: Car[];
  initialSelectedCarId: string | null;
  lang: Locale;
  /**
   * The server could not load the list — `initialCars` is empty because the
   * request failed, not because the user owns no cars. Without this the two are
   * indistinguishable in the UI, and "You have no cars yet" next to an error
   * banner invites the user to re-create a car they already own.
   */
  loadFailed?: boolean;
}

export default function CarList({ initialCars, initialSelectedCarId, lang, loadFailed }: CarListProps) {
  const [i18n] = useState(() => createClientI18n(lang));
  return (
    <I18nextProvider i18n={i18n}>
      <CarListContent
        initialCars={initialCars}
        initialSelectedCarId={initialSelectedCarId}
        lang={lang}
        loadFailed={loadFailed}
      />
    </I18nextProvider>
  );
}

function CarListContent({ initialCars, initialSelectedCarId, loadFailed = false }: CarListProps) {
  const { t } = useTranslation();
  const [cars, setCars] = useState<Car[]>(initialCars);
  const [selectedCarId, setSelectedCarId] = useState<string | null>(initialSelectedCarId);
  const [editingCarId, setEditingCarId] = useState<string | null>(null);
  const [deletingCar, setDeletingCar] = useState<Car | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchCars(): Promise<Car[]> {
    const res = await fetch("/api/cars");
    const json = (await res.json()) as { cars?: Car[] };
    if (!res.ok) throw new Error(t(statusErrorKey(res.status)));
    return json.cars ?? [];
  }

  async function selectCar(id: string) {
    setError(null);
    try {
      const res = await fetch(`/api/cars/${id}/select`, { method: "POST" });
      if (!res.ok) {
        setError(t(statusErrorKey(res.status)));
        return;
      }
      setSelectedCarId(id);
    } catch {
      setError(t("common.networkError"));
    }
  }

  async function handleAddSuccess(car: Car) {
    try {
      const updated = await fetchCars();
      setCars(updated);
      setShowAddForm(false);
      await selectCar(car.id);
    } catch {
      setError(t("cars.addedRefreshFailed"));
    }
  }

  async function handleEditSuccess() {
    try {
      const updated = await fetchCars();
      setCars(updated);
      setEditingCarId(null);
    } catch {
      setError(t("cars.updatedRefreshFailed"));
    }
  }

  async function handleDeleteConfirm() {
    if (!deletingCar) return;
    setIsDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/cars/${deletingCar.id}`, { method: "DELETE" });
      if (!res.ok) {
        setError(t(statusErrorKey(res.status)));
        return;
      }
      if (selectedCarId === deletingCar.id) {
        setSelectedCarId(null);
      }
      const updated = await fetchCars();
      setCars(updated);
      setDeletingCar(null);
    } catch {
      setError(t("common.networkError"));
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="space-y-6 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("cars.myCars")}</h1>
        {!showAddForm && !loadFailed && (
          <Button
            onClick={() => {
              setShowAddForm(true);
            }}
          >
            {t("cars.addCar")}
          </Button>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {showAddForm && (
        <div className="rounded-lg border p-4">
          <h2 className="mb-4 text-lg font-semibold">{t("cars.addNewCar")}</h2>
          <CarForm
            onSuccess={handleAddSuccess}
            onCancel={() => {
              setShowAddForm(false);
            }}
          />
        </div>
      )}

      {cars.length === 0 && !showAddForm && !loadFailed ? (
        <p className="text-muted-foreground">{t("cars.noCars")}</p>
      ) : (
        <ul className="space-y-4">
          {cars.map((car) => {
            const isSelected = car.id === selectedCarId;
            const isEditing = car.id === editingCarId;
            return (
              <li
                key={car.id}
                className={`rounded-lg border p-4 ${isSelected ? "border-accent-ink bg-primary/5" : ""}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">
                      {car.brand} {car.model}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {car.production_year} · {t(ENGINE_TYPE_KEYS[car.engine_type])} · {car.engine_capacity} ·{" "}
                      {car.engine_power}
                    </p>
                    {car.registration_number && (
                      <p className="text-sm text-muted-foreground">{car.registration_number}</p>
                    )}
                    {isSelected && (
                      <span className="mt-1 inline-block text-xs font-medium text-accent-ink">
                        {t("cars.selected")}
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      size="sm"
                      variant={isSelected ? "default" : "outline"}
                      disabled={isSelected}
                      onClick={() => selectCar(car.id)}
                    >
                      {isSelected ? t("cars.active") : t("cars.select")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditingCarId(isEditing ? null : car.id);
                      }}
                    >
                      {isEditing ? t("common.cancel") : t("common.edit")}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => {
                        setDeletingCar(car);
                      }}
                    >
                      {t("common.delete")}
                    </Button>
                  </div>
                </div>

                {isEditing && (
                  <div className="mt-4 border-t pt-4">
                    <CarForm
                      car={car}
                      onSuccess={handleEditSuccess}
                      onCancel={() => {
                        setEditingCarId(null);
                      }}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {deletingCar && (
        <DeleteCarDialog
          car={deletingCar}
          open={true}
          onConfirm={handleDeleteConfirm}
          onCancel={() => {
            setDeletingCar(null);
          }}
          isDeleting={isDeleting}
        />
      )}
    </div>
  );
}
