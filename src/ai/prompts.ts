export const ANALYZE_PROMPT = `Briefly analyze this screenshot. In 2-4 short sentences:
- What app/page is shown and what the user is doing.
- The most important visible text (headings, errors, code, key content). Skip nav chrome and timestamps.

Be concise. Plain prose, no headings or markdown.`;

export function chatPrompt(userMessage: string): string {
  return `You are a helpful AI assistant. The user has captured a screenshot and has a question about it. Answer concisely and helpfully.\n\nUser question: ${userMessage}`;
}

export function parseAnalyzeResponse(content: string): { extractedText: string; description: string } {
  return { description: content.trim(), extractedText: '' };
}
