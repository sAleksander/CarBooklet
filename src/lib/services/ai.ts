import OpenAI from "openai";
import { OPENROUTER_API_KEY } from "astro:env/server";

const client = new OpenAI({
  apiKey: OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: {
    "X-Title": "CarBooklet",
  },
});

export async function createChatStream(prompt: string) {
  if (!OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }

  return client.chat.completions.create({
    // Catch-all alias — OpenRouter routes to the currently available free model. Pin to a specific
    // model ID (e.g. "google/gemini-2.0-flash-exp:free") before S-02 if determinism matters.
    model: "openrouter/free",
    messages: [
      { role: "system", content: "You are a helpful car assistant." },
      { role: "user", content: prompt },
    ],
    stream: true,
  });
}
