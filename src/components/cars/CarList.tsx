import { useState } from "react";
import type { Car } from "@/types";
import { Button } from "@/components/ui/button";
import CarForm from "./CarForm";
import DeleteCarDialog from "./DeleteCarDialog";

interface CarListProps {
  initialCars: Car[];
  initialSelectedCarId: string | null;
}

export default function CarList({ initialCars, initialSelectedCarId }: CarListProps) {
  const [cars, setCars] = useState<Car[]>(initialCars);
  const [selectedCarId, setSelectedCarId] = useState<string | null>(initialSelectedCarId);
  const [editingCarId, setEditingCarId] = useState<string | null>(null);
  const [deletingCar, setDeletingCar] = useState<Car | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchCars(): Promise<Car[]> {
    const res = await fetch("/api/cars");
    const json = (await res.json()) as { cars?: Car[]; error?: string };
    if (!res.ok) throw new Error(json.error ?? "Failed to fetch cars");
    return json.cars ?? [];
  }

  async function selectCar(id: string) {
    setError(null);
    try {
      const res = await fetch(`/api/cars/${id}/select`, { method: "POST" });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        setError(json.error ?? "Failed to select car");
        return;
      }
      setSelectedCarId(id);
    } catch {
      setError("Network error. Please try again.");
    }
  }

  async function handleAddSuccess(car: Car) {
    try {
      const updated = await fetchCars();
      setCars(updated);
      setShowAddForm(false);
      await selectCar(car.id);
    } catch {
      setError("Car added but failed to refresh list.");
    }
  }

  async function handleEditSuccess() {
    try {
      const updated = await fetchCars();
      setCars(updated);
      setEditingCarId(null);
    } catch {
      setError("Car updated but failed to refresh list.");
    }
  }

  async function handleDeleteConfirm() {
    if (!deletingCar) return;
    setIsDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/cars/${deletingCar.id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        setError(json.error ?? "Failed to delete car");
        return;
      }
      if (selectedCarId === deletingCar.id) {
        setSelectedCarId(null);
      }
      const updated = await fetchCars();
      setCars(updated);
      setDeletingCar(null);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="space-y-6 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">My Cars</h1>
        {!showAddForm && (
          <Button
            onClick={() => {
              setShowAddForm(true);
            }}
          >
            Add car
          </Button>
        )}
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      {showAddForm && (
        <div className="rounded-lg border p-4">
          <h2 className="mb-4 text-lg font-semibold">Add a new car</h2>
          <CarForm
            onSuccess={handleAddSuccess}
            onCancel={() => {
              setShowAddForm(false);
            }}
          />
        </div>
      )}

      {cars.length === 0 && !showAddForm ? (
        <p className="text-muted-foreground">No cars yet. Add your first car.</p>
      ) : (
        <ul className="space-y-4">
          {cars.map((car) => {
            const isSelected = car.id === selectedCarId;
            const isEditing = car.id === editingCarId;
            return (
              <li key={car.id} className={`rounded-lg border p-4 ${isSelected ? "border-primary bg-primary/5" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">
                      {car.brand} {car.model}
                    </p>
                    <p className="text-muted-foreground text-sm">
                      {car.production_year} · {car.engine_type.toUpperCase()} · {car.engine_capacity} ·{" "}
                      {car.engine_power}
                    </p>
                    {car.registration_number && (
                      <p className="text-muted-foreground text-sm">{car.registration_number}</p>
                    )}
                    {isSelected && <span className="text-primary mt-1 inline-block text-xs font-medium">Selected</span>}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      size="sm"
                      variant={isSelected ? "default" : "outline"}
                      disabled={isSelected}
                      onClick={() => selectCar(car.id)}
                    >
                      {isSelected ? "Active" : "Select"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditingCarId(isEditing ? null : car.id);
                      }}
                    >
                      {isEditing ? "Cancel" : "Edit"}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => {
                        setDeletingCar(car);
                      }}
                    >
                      Delete
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
