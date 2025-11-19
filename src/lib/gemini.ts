import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = import.meta.env.VITE_GEMINI_API_KEY;

if (!apiKey) {
  console.warn(
    "VITE_GEMINI_API_KEY is not set. Gemini features will not work."
  );
}

const genAI = new GoogleGenerativeAI(apiKey || "");

// Use the correct model name for the Gemini API
const DEFAULT_MODEL = "gemini-2.5-flash";

// Retry configuration
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 30000;

// Helper function for exponential backoff with jitter
async function delay(attempt: number): Promise<void> {
  const backoffMs = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * Math.pow(2, attempt - 1));
  const jitter = Math.floor(Math.random() * Math.min(1000, backoffMs / 4));
  const totalDelay = backoffMs + jitter;
  console.log(`Retrying after ${totalDelay}ms (attempt ${attempt}/${MAX_RETRIES})`);
  return new Promise((resolve) => setTimeout(resolve, totalDelay));
}

// Check if error is retryable (transient)
function isRetryableError(error: any): boolean {
  const errorMsg = error?.message || "";
  // Check for rate limit, overload, or transient errors
  return (
    errorMsg.includes("429") ||
    errorMsg.includes("503") ||
    errorMsg.includes("overloaded") ||
    errorMsg.includes("temporarily") ||
    errorMsg.includes("RESOURCE_EXHAUSTED") ||
    errorMsg.includes("unavailable")
  );
}

export const geminiClient = {
  async generateText(prompt: string, model: string = DEFAULT_MODEL) {
    let lastError: any;
    
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`Gemini API call (attempt ${attempt}/${MAX_RETRIES}):`, model);
        const generativeModel = genAI.getGenerativeModel({ model });
        const result = await generativeModel.generateContent(prompt);
        const response = await result.response;
        return response.text();
      } catch (error) {
        lastError = error;
        console.error(`Attempt ${attempt} failed:`, error);

        if (!isRetryableError(error) || attempt === MAX_RETRIES) {
          console.error("Gemini API error (non-retryable or max retries reached):", error);
          throw error;
        }

        await delay(attempt);
      }
    }

    throw lastError || new Error("Max retries reached calling Gemini");
  },

  async generateWithStreaming(
    prompt: string,
    onChunk: (chunk: string) => void,
    model: string = DEFAULT_MODEL
  ) {
    let lastError: any;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`Gemini streaming call (attempt ${attempt}/${MAX_RETRIES}):`, model);
        const generativeModel = genAI.getGenerativeModel({ model });
        const result = await generativeModel.generateContentStream(prompt);

        for await (const chunk of result.stream) {
          const text = chunk.text();
          onChunk(text);
        }

        return await result.response;
      } catch (error) {
        lastError = error;
        console.error(`Streaming attempt ${attempt} failed:`, error);

        if (!isRetryableError(error) || attempt === MAX_RETRIES) {
          console.error("Gemini streaming error (non-retryable or max retries reached):", error);
          throw error;
        }

        await delay(attempt);
      }
    }

    throw lastError || new Error("Max retries reached calling Gemini");
  },

  async analyzeText(text: string, analysisType: string = "general") {
    const prompt = `Analyze the following text for ${analysisType}:\n\n${text}`;
    return this.generateText(prompt);
  },

  async matchTutorBuddy(
    studentProfile: string,
    tutorProfile: string
  ): Promise<{ score: number; reasoning: string }> {
    const prompt = `
You are an expert in matching students with tutors/study buddies. Analyze the compatibility between these two profiles and provide a match score (0-100) and reasoning.

Student Profile:
${studentProfile}

Tutor/Buddy Profile:
${tutorProfile}

Respond in JSON format:
{
  "score": <number 0-100>,
  "reasoning": "<brief explanation>"
}
`;

    try {
      const response = await this.generateText(prompt);
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      throw new Error("Could not parse response");
    } catch (error) {
      console.error("Match analysis error:", error);
      return { score: 0, reasoning: "Error analyzing compatibility" };
    }
  },

  async generateStudyPlan(topic: string, level: string, duration: string) {
    const prompt = `
Create a detailed study plan for the following:
- Topic: ${topic}
- Level: ${level}
- Duration: ${duration}

Provide a structured, actionable study plan with daily milestones.
`;
    return this.generateText(prompt);
  },
};

export type GeminiClient = typeof geminiClient;
