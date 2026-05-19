export interface SavedPrompt {
  id: string;
  name: string;
  command: string;
  description: string;
  prompt: string;
}

export const SAVED_PROMPTS: SavedPrompt[] = [
  {
    id: 'explain',
    name: 'Explain',
    command: 'explain',
    description: 'Explain what is shown',
    prompt:
      'Explain what is shown in this screenshot in clear, simple terms. Cover what the user is looking at, what it appears to be doing, and any context that would help someone unfamiliar with it understand it. Keep it under 6 sentences.',
  },
  {
    id: 'extract-json',
    name: 'Extract JSON',
    command: 'extract-json',
    description: 'Pull structured data out as JSON',
    prompt:
      'Extract the structured data visible in this screenshot and return it as valid JSON. If no obvious schema is present, infer a reasonable one from the content. Return ONLY a single fenced ```json code block, with no commentary before or after.',
  },
  {
    id: 'summarize',
    name: 'Summarize',
    command: 'summarize',
    description: 'TL;DR of the screenshot',
    prompt:
      'Summarize the content of this screenshot in 2-3 concise sentences. Lead with the most important information.',
  },
];

export function findSavedPrompt(command: string): SavedPrompt | null {
  const normalized = command.trim().toLowerCase();
  return SAVED_PROMPTS.find((p) => p.command === normalized) ?? null;
}
