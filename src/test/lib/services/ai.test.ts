import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "@/lib/services/ai";
import type { Car } from "@/types";

// Oracle source (R1): expected prompt substrings come from this fixture, never
// from calling buildSystemPrompt and re-asserting its own output.
const FIXTURE = {
  production_year: "2018",
  brand: "Toyota",
  model: "Corolla",
  engine_type: "diesel",
  engine_capacity: "1998cc",
  engine_power: "120hp",
  engine_code: "1ND-TV",
  vin_number: "JTDBR32E520012345",
} as const;

function makeCar(overrides: Partial<Car> = {}): Car {
  return {
    id: "car-1",
    user_id: "user-1",
    brand: FIXTURE.brand,
    model: FIXTURE.model,
    production_year: FIXTURE.production_year,
    registration_number: "ABC 1234",
    engine_type: FIXTURE.engine_type,
    engine_capacity: FIXTURE.engine_capacity,
    engine_power: FIXTURE.engine_power,
    engine_code: FIXTURE.engine_code,
    vin_number: FIXTURE.vin_number,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("buildSystemPrompt", () => {
  it("grounds the prompt on exactly the owned car's fields", () => {
    const prompt = buildSystemPrompt(makeCar());

    expect(prompt).toContain(FIXTURE.production_year);
    expect(prompt).toContain(FIXTURE.brand);
    expect(prompt).toContain(FIXTURE.model);
    expect(prompt).toContain(FIXTURE.engine_type);
    expect(prompt).toContain(FIXTURE.engine_capacity);
    expect(prompt).toContain(FIXTURE.engine_power);
    expect(prompt).toContain(FIXTURE.engine_code);
    expect(prompt).toContain(FIXTURE.vin_number);
    // Labels for the optional fields are present when the values exist.
    expect(prompt).toContain("engine code:");
    expect(prompt).toContain("VIN:");
  });

  it("sanitises control characters from car fields (stored-field injection guard)", () => {
    // A hostile stored value carrying a newline and a control char.
    const prompt = buildSystemPrompt(makeCar({ model: "Cor\nol\x01la" }));

    expect(prompt).not.toContain("\n");
    expect(prompt).not.toContain("\x01");
    // Each control char is collapsed to a space, leaving readable text.
    expect(prompt).toContain("Cor ol la");
  });

  it("omits optional fields when null", () => {
    const prompt = buildSystemPrompt(makeCar({ engine_code: null, vin_number: null }));

    expect(prompt).not.toContain("engine code:");
    expect(prompt).not.toContain("VIN:");
  });

  it("omits optional fields when whitespace-only", () => {
    const prompt = buildSystemPrompt(makeCar({ engine_code: "   ", vin_number: "\t" }));

    expect(prompt).not.toContain("engine code:");
    expect(prompt).not.toContain("VIN:");
  });
});
