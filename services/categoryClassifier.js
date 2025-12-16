// services/categoryClassifier.js
import OpenAI from "openai";

const CATEGORIES = [
  "fitness",
  "car_wash",
  "salon",
  "home_services",
  "clinic",
  "other"
];

export async function classifyBusinessCategory({ name, description }) {
  if (!process.env.OPENAI_API_KEY) {
    console.warn("No OPENAI_API_KEY set, defaulting category to 'other'");
    return "other";
  }

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

  const prompt = `
You classify businesses for an AI phone receptionist platform.

Business name: "${name}"
Business description: "${description || ""}"

Choose ONE category ID from this list:
${CATEGORIES.join(", ")}

Respond with ONLY the category id, nothing else.
`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }]
  });

  const text =
    response?.choices?.[0]?.message?.content?.trim()?.toLowerCase() || "";

  const match =
    CATEGORIES.find((cat) => text.includes(cat)) || "other";

  return match;
}
