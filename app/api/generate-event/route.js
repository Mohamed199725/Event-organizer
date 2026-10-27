import { NextResponse } from "next/server";

// Allow the route to run for up to 30s on hosts that honor this (Vercel etc.)
export const maxDuration = 30;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Models that actually exist for this key today, in order of preference.
// (gemini-2.0-flash / gemini-1.5-flash were retired and now return 404.)
const MODELS = [
  "gemini-flash-lite-latest",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemma-4-26b-a4b-it",
];

// Per-model network timeout. Keeps total latency short instead of hanging for minutes.
const TIMEOUT_MS = 12000;
// Each model has its own free-tier daily quota, so keep trying until we find one with headroom.
const MAX_MODELS_TO_TRY = MODELS.length;

const CATEGORIES = [
  "tech",
  "music",
  "sports",
  "art",
  "food",
  "business",
  "health",
  "education",
  "gaming",
  "networking",
  "outdoor",
  "community",
];

function buildPrompt(prompt) {
  return `You are an event planning assistant. Generate event details based on the user's description.

Return ONLY valid JSON with this exact structure:
{
  "title": "Event title (catchy and professional, single line, under 80 characters)",
  "description": "Detailed event description, 2-3 sentences, single paragraph with no line breaks.",
  "category": "One of: ${CATEGORIES.join(", ")}",
  "suggestedCapacity": 50,
  "suggestedTicketType": "free"
}

Rules:
- Return ONLY the JSON object, no markdown, no explanation
- "category" MUST be exactly one of these lowercase values: ${CATEGORIES.join(", ")}
- "suggestedCapacity" MUST be a plain integer between 10 and 5000
- "suggestedTicketType" MUST be exactly "free" or "paid"
- All string values must be a single line with no line breaks

User's event idea: ${prompt}`;
}

function normalize(data) {
  if (!data || typeof data !== "object") return null;

  const title = typeof data.title === "string" ? data.title.trim() : "";
  const description =
    typeof data.description === "string"
      ? data.description.replace(/\s+/g, " ").trim()
      : "";

  if (!title || !description) return null;

  const rawCategory = String(data.category || "").toLowerCase();
  const category =
    CATEGORIES.find((c) => rawCategory.includes(c)) || "community";

  const capacity = Number.parseInt(data.suggestedCapacity, 10);
  const suggestedCapacity =
    Number.isFinite(capacity) && capacity > 0
      ? Math.min(Math.max(capacity, 10), 5000)
      : 50;

  const rawTicket = String(data.suggestedTicketType || "").toLowerCase();
  const suggestedTicketType = rawTicket.includes("paid") ? "paid" : "free";

  return {
    title,
    description,
    category,
    suggestedCapacity,
    suggestedTicketType,
  };
}

function parseModelText(text) {
  if (!text) return null;

  let cleaned = text.trim();
  // Strip markdown fences if the model ignored responseMimeType
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");

  // Grab the outermost JSON object if there is any leading/trailing prose
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end > start) {
    cleaned = cleaned.slice(start, end + 1);
  }

  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

async function callModel(model, prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": GEMINI_API_KEY,
        },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: buildPrompt(prompt) }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 2000,
            responseMimeType: "application/json",
          },
        }),
      },
    );

    if (!res.ok) {
      const body = await res.text();
      return {
        ok: false,
        status: res.status,
        error: body,
        retryable: res.status === 429 || res.status >= 500,
      };
    }

    const result = await res.json();
    // Models that think by default return reasoning in extra parts flagged `thought: true`.
    // Only the non-thought parts are the actual answer.
    const text = (result.candidates?.[0]?.content?.parts || [])
      .filter((p) => !p.thought)
      .map((p) => p.text || "")
      .join("");

    const data = normalize(parseModelText(text));
    if (!data) {
      return {
        ok: false,
        status: 200,
        error: "Unparsable model output",
        retryable: true,
      };
    }
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error:
        err.name === "AbortError"
          ? `Timed out after ${TIMEOUT_MS}ms`
          : err.message,
      retryable: true,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(req) {
  try {
    const { prompt } = await req.json();

    if (!prompt || !prompt.trim()) {
      return NextResponse.json(
        { error: "Prompt is required" },
        { status: 400 },
      );
    }

    if (!GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY is not configured.", fallback: true },
        { status: 500 },
      );
    }

    let lastError = "No model responded";

    for (const model of MODELS.slice(0, MAX_MODELS_TO_TRY)) {
      const result = await callModel(model, prompt.trim());

      if (result.ok) {
        return NextResponse.json(result.data);
      }

      lastError = `[${model}] ${result.status} ${String(result.error).slice(0, 300)}`;
      console.error("Gemini generation failed:", lastError);
    }

    return NextResponse.json(
      {
        error:
          "AI generation unavailable right now. Please fill in the event details manually.",
        detail: lastError,
        fallback: true,
      },
      { status: 500 },
    );
  } catch (error) {
    console.error("Error generating event:", error);
    return NextResponse.json(
      {
        error:
          "AI generation unavailable. Please fill in the event details manually.",
        fallback: true,
      },
      { status: 500 },
    );
  }
}
