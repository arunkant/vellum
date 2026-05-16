export const ANALYZE_PROMPT = `Please analyze this screenshot and provide TWO things:

1. **Extracted Text**: Extract ALL visible text from the image verbatim. Include every word, label, heading, button text, code snippet, menu item, error message, or any other text you can see. Format it cleanly and preserve the structure as much as possible. If there's no text, say "No text detected."

2. **Description**: Provide a concise but detailed description of what this screenshot shows. Include the context — what app or website is shown, what the user is looking at, and the key visual elements.

Format your response exactly like this:
[TEXT_START]
(extracted text here)
[TEXT_END]

[DESC_START]
(description here)
[DESC_END]`;

export function chatPrompt(userMessage: string): string {
  return `You are a helpful AI assistant. The user has captured a screenshot and has a question about it. Answer concisely and helpfully.\n\nUser question: ${userMessage}`;
}

export function parseAnalyzeResponse(content: string): { extractedText: string; description: string } {
  const textMatch = content.match(/\[TEXT_START\]([\s\S]*?)\[TEXT_END\]/);
  const descMatch = content.match(/\[DESC_START\]([\s\S]*?)\[DESC_END\]/);
  return {
    extractedText: textMatch ? textMatch[1].trim() : content,
    description: descMatch ? descMatch[1].trim() : '',
  };
}
