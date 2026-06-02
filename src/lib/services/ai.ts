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

function sanitise(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\r\n\x00-\x1F\x7F]/g, " ").trim();
}

function buildSystemPrompt(car: Car): string {
  const details: string[] = [
    `fuel type: ${sanitise(car.engine_type)}`,
    `engine capacity: ${sanitise(car.engine_capacity)}`,
    `engine power: ${sanitise(car.engine_power)}`,
  ];
  if (car.engine_code?.trim()) details.push(`engine code: ${sanitise(car.engine_code)}`);
  if (car.vin_number?.trim()) details.push(`VIN: ${sanitise(car.vin_number)}`);

  return (
    `You are an expert car assistant. The user's car is a ${sanitise(car.production_year)} ${sanitise(car.brand)} ${sanitise(car.model)}. ` +
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
