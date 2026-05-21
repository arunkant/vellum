# Vellum — a private, on‑device screenshot assistant powered by Gemma 4

*This is a submission for the [Google Gemma 4 Challenge](https://dev.to/challenges/google-gemma-2026-05-06): **Build with Gemma 4***

## What I Built

**Vellum** is a tray‑resident macOS app that turns any screenshot into a conversation. Hit `⌘⇧1` to drag a region, or `⌘⇧2` to grab the whole screen — the capture pops open in a chat window, the image is described and OCR'd in the background, and you can immediately ask follow‑up questions about what's on screen.

The interesting bit: Vellum runs Gemma 4 **locally** on Apple Silicon by default. No screenshot ever leaves the machine. There's no account, no API key, no cloud round‑trip — just a global hotkey and a vision‑language model living in your menu bar.

How I actually use it: over a few days I capture screenshots of things I read on the internet — articles, threads, diagrams, half‑finished thoughts — and let them pile up. Then one evening I sit down and review the whole stack. Because every capture is OCR'd by Gemma 4, the pile is fully searchable, and the review session turns into something more useful than a screenshot graveyard:

- **Capture now, think later.** Grab anything interesting with `⌘⇧1` and keep reading — no context switch, no "where do I save this".
- **OCR everything automatically.** Gemma 4 reads the text out of each image on capture, so I can search across days of captures by what was *in* them, not just when I took them.
- **Review in one sitting.** An evening pass over the gallery surfaces patterns I'd never have spotted scrolling live.
- **New blog‑post ideas.** Asking Gemma about a cluster of related captures regularly hands me an angle for something I want to write.
- **Organize with tags.** Group captures into themes so the next review starts already sorted.

A few quality‑of‑life touches that make the review session flow:

- **One‑click "Copy for Slack / JIRA".** From the capture's action bar, Vellum puts the image *and* a ready‑to‑paste blurb on the clipboard — Gemma 4's description plus the tags, formatted for each tool (Slack mrkdwn or Jira markup). Paste straight into a thread or ticket.
- **"Copy with shadow"** for a polished share. One click composites the raw screenshot onto a transparent canvas with padding, rounded corners and a soft drop shadow, then drops it on the clipboard — the kind of framed shot you'd otherwise reach for a separate tool to make.
- **Plain "Copy image"** for everything else.

Each action also has a `⌘1…9` shortcut, so the whole review‑and‑share loop stays on the keyboard.

Source + install script (one curl line for Apple Silicon): <https://github.com/arunkant/vellum>

## Demo

A short walkthrough showing region capture → auto‑description → follow‑up chat, all served by a local Gemma 4 E4B‑it instance:

> 📺 **Video:** *(insert your screen recording link here — Loom / YouTube unlisted / dev.to upload)*

Screenshots:

> *(drop 2–3 stills here: tray menu, region overlay, chat window with Gemma's response)*

Install on macOS (Apple Silicon):

```sh
curl -fsSL https://www.arunkant.com/vellum/install.sh | bash
```

## How I Used Gemma 4

Vellum bundles `llama.cpp`'s `llama-server` as an `extraResource` and, on first use of the local provider, downloads:

- `gemma-4-E4B-it-Q4_K_M.gguf` — Google's vision‑capable **Gemma 4 E4B‑it**, quantized to Q4_K_M (~5 GB).
- `mmproj-BF16.gguf` — the multimodal projector that lets Gemma 4 actually look at pixels.

Both come from Unsloth's GGUF mirror of the official `google/gemma-4-E4B-it`. The server is launched lazily the first time the user takes a screenshot, then kept warm for the rest of the session.

The request flow is a regular OpenAI‑compatible vision call to localhost — Gemma 4 happily accepts an image part next to a text part:

```ts
// src/ai/local.ts
await net.fetch(`${serverEndpoint()}/v1/chat/completions`, {
  method: 'POST',
  body: JSON.stringify({
    model: 'gemma-4-e4b',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: req.prompt },
        { type: 'image_url', image_url: { url: imageToDataUrl(req.imagePath) } },
      ],
    }],
    max_tokens: req.maxTokens ?? 2000,
    temperature: 0.2,
  }),
});
```

The launcher arguments are deliberately conservative so it fits comfortably alongside a browser and an IDE on a 16 GB MacBook:

```ts
// src/ai/llama-server.ts
const args = [
  '-m', modelPath(),
  '--mmproj', mmprojPath(),
  '--host', '127.0.0.1',
  '--port', String(port),
  '-c', '8192',
  '--no-webui',
];
```

Two prompts drive everything:

1. **Auto‑analysis** — a short instruction asking Gemma 4 to describe the app/page and pull out the most important visible text, runs the moment a capture lands.
2. **Chat** — every user message is forwarded with the original image still attached, so Gemma can ground each answer in the pixels rather than its own prior summary.

The same `VisionProvider` interface is also implemented by an OpenRouter‑backed provider, so users who want a beefier hosted model can swap in one without touching the rest of the app. Gemma 4 is the **default**, and it's the only path that works fully offline.

## Multimodal Insights

A few things I learned shipping Gemma 4 to end‑users:

- **The 4B/E4B vision model is genuinely shippable.** It comfortably reads UI text, error dialogs, and code editors. For dense documents I occasionally bump `-c` to 16k, but 8k is fine for screen captures.
- **The multimodal projector is the easy thing to forget.** Without `--mmproj`, the model will silently treat the image like noise. Vellum downloads it alongside the weights and refuses to start the server if either file is missing.
- **Q4_K_M is the right tradeoff for laptops.** It keeps the whole thing under ~5 GB on disk, leaves headroom for a browser, and the quality cost on screenshot tasks is invisible to me in practice.
- **`temperature: 0.2`** for screenshot tasks. Higher temperatures make Gemma start *narrating* the UI; low temperatures make it answer the question.

## Why Gemma 4 for this app

I built Vellum around a habit: capturing things I read over days, then reviewing the pile in one sitting. That only works if every capture is OCR'd and searchable the moment I take it — and I'm not about to stream days of half‑formed reading habits and private dashboards to a third‑party endpoint just to make that happen. An open‑weights vision model I can bundle and ship inside an Electron app is the only way that problem actually gets solved: it runs the moment I hit `⌘⇧1`, with no account, no API key, and no network hop. Gemma 4 E4B‑it is the first model in this size class where the OCR and the follow‑up answers are consistently good enough that I stopped reaching for the cloud fallback.

## Tech stack

- **Model:** `google/gemma-4-E4B-it` (Q4_K_M GGUF, BF16 mmproj) via Unsloth
- **Runtime:** `llama.cpp` `llama-server`, bundled per‑arch as an Electron `extraResource`
- **App shell:** Electron + Vite + TypeScript, packaged with Electron Forge
- **Storage:** SQLite for screenshots + AI results + chat history; images on disk, key encrypted via `safeStorage`
- **Auto‑update:** GitHub Releases + a tiny installer script served from GitHub Pages

## Links

- **Repo:** <https://github.com/arunkant/vellum>
- **Latest release (v1.3.0):** <https://github.com/arunkant/vellum/releases/tag/v1.3.0>
- **Landing page + installer:** <https://www.arunkant.com/vellum/>
- **License:** MIT (bundled `llama.cpp` retains its own license — see `THIRD_PARTY_NOTICES.md`)

Thanks to the Gemma team for shipping a vision model small enough to live in a menu bar, and to the `llama.cpp` and Unsloth communities for making GGUF inference this painless.
