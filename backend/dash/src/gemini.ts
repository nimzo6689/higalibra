import { GoogleGenAI } from '@google/genai';
import type { NewBook } from '@higalibra/scraping';
import { createBookPrompt } from './dash.js';
import type { BookDecision } from './types.js';

const DEFAULT_MODEL = 'gemini-2.5-flash';

export function createGeminiBookEvaluator(
  apiKey: string,
  model = DEFAULT_MODEL,
): (book: NewBook) => Promise<BookDecision> {
  if (!apiKey.trim()) {
    throw new Error('Gemini API key must not be empty.');
  }
  const client = new GoogleGenAI({ apiKey });

  return async (book) => {
    const response = await client.models.generateContent({
      model,
      contents: createBookPrompt(book),
      config: {
        tools: [{ googleSearch: {} }],
      },
    });
    const text = response.text;
    if (!text) {
      throw new Error(
        `Gemini returned no decision for book ${book.bookNo} (${book.title}).`,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new Error(
        `Gemini returned invalid JSON for book ${book.bookNo} (${book.title}).`,
        { cause: error },
      );
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('shouldReserve' in parsed) ||
      typeof parsed.shouldReserve !== 'boolean' ||
      !('reason' in parsed) ||
      typeof parsed.reason !== 'string' ||
      parsed.reason.trim() === ''
    ) {
      throw new Error(
        `Gemini returned an invalid decision for book ${book.bookNo} (${book.title}).`,
      );
    }
    return {
      shouldReserve: parsed.shouldReserve,
      reason: parsed.reason.trim(),
    };
  };
}
