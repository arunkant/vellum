# Vellum

A tray-resident macOS screenshot helper. Capture a region or the full screen with a global shortcut; Vellum runs the image through an OpenRouter vision model to extract text and describe what's on screen, then lets you chat about the capture.

## Install (Apple Silicon)

```sh
curl -fsSL https://arunkant.github.io/vellum/install.sh | bash
```

The installer downloads the latest release from GitHub, drops `vellum.app` into `/Applications`, strips the macOS quarantine flag (Vellum is not code-signed), and launches it. Source: [docs/install.sh](docs/install.sh). Landing page: <https://arunkant.github.io/vellum/>.

## Requirements

- Node.js 20+ and npm
- macOS (the app is built around macOS tray + screen capture; other platforms are not actively tested)
- An [OpenRouter](https://openrouter.ai) API key for AI features

## Build & Run

Install dependencies:

```sh
npm install
```

Run in development (hot-reload via Electron Forge + Vite):

```sh
npm start
```

Type-check and lint:

```sh
npm run typecheck
npm run lint
```

Package the app for the current platform (output in `out/`):

```sh
npm run package
```

Build distributables (`.dmg` on macOS, `.deb`/`.rpm` on Linux, Squirrel installer on Windows):

```sh
npm run make
```

Regenerate tray/app icons from source PNGs:

```sh
npm run build:assets
```

## Basic Usage

1. Launch Vellum. It lives in the menu-bar tray — there's no dock icon.
2. Open the main window from the tray and paste your OpenRouter API key into settings. The key is stored encrypted via Electron's `safeStorage`. Optionally change the model (default: `google/gemini-2.5-flash-lite`).
3. Capture a screenshot:
   - **`Cmd/Ctrl + Shift + 1`** — region capture (drag to select an area)
   - **`Cmd/Ctrl + Shift + 2`** — full-screen capture
   - Or use the tray menu items.
4. After a capture, the chat window opens with the screenshot. The AI runs in the background and fills in extracted text + a description. You can then ask follow-up questions about the image.
5. The main window's gallery lists past screenshots; you can search across captures and chat history.

Captured images and AI results are cached locally under Electron's `userData` directory.

On packaged builds, Vellum registers itself as a login item and starts hidden in the tray.
