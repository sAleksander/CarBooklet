import OpenAI from "openai";
import { OPENROUTER_API_KEY } from "astro:env/server";

export async function createChatStream(prompt: string) {
  if (!OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }

  const client = new OpenAI({
    apiKey: OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": "http://localhost:4321",
      "X-Title": "CarBooklet",
    },
  });

  return client.chat.completions.create({
    model: "openrouter/free",
    messages: [
      { role: "system", content: "You are a helpful car assistant." },
      { role: "user", content: prompt },
    ],
    stream: true,
  });
}
