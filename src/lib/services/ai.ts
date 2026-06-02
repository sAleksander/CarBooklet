import OpenAI from "openai";
import { OPENROUTER_API_KEY } from "astro:env/server";
import type { Car } from "@/types";

const client = new OpenAI({
  apiKey: OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: {
    "X-Title": "CarBooklet",
  },
});

function buildSystemPrompt(car: Car): string {
  const details: string[] = [`fuel type: ${car.engine_type}`];
  if (car.engine_capacity.trim()) details.push(`engine capacity: ${car.engine_capacity}`);
  if (car.engine_power.trim()) details.push(`engine power: ${car.engine_power}`);
  if (car.engine_code?.trim()) details.push(`engine code: ${car.engine_code}`);
  if (car.vin_number?.trim()) details.push(`VIN: ${car.vin_number}`);

  return (
    `You are an expert car assistant. The user's car is a ${car.production_year} ${car.brand} ${car.model}. ` +
    `Known details: ${details.join(", ")}. ` +
    `Answer questions using your specific knowledge of this car model — common faults, maintenance intervals, ` +
    `OBD2 codes, and technical specifications. Be precise and reference the specific model where relevant.`
  );
}

export async function createChatStream(prompt: string, car: Car) {
  if (!OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }

  return client.chat.completions.create({
    model: "openrouter/free",
    messages: [
      { role: "system", content: buildSystemPrompt(car) },
      { role: "user", content: prompt },
    ],
    stream: true,
  });
}
