<p align="center">
  <img src="assets/icon.svg" width="120" alt="VoicePaste icon" />
</p>

<h1 align="center">VoicePaste</h1>

<p align="center">
  <strong>Speak naturally, paste perfectly — in any app.</strong>
</p>

<p align="center">
  <a href="README-zh.md">简体中文</a> | English
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-blue?style=flat-square" alt="macOS | Windows" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="MIT License" />
  <img src="https://img.shields.io/badge/electron-40-purple?style=flat-square" alt="Electron 40" />
  <img src="https://img.shields.io/badge/transcription-100%25%20local-orange?style=flat-square" alt="100% local transcription" />
</p>

---

> **🔒 Local-first edition** — this fork of [CloveSVG/voicepaste](https://github.com/CloveSVG/voicepaste) replaces the OpenAI transcription API with a **fully local speech engine** ([whisper.cpp](https://github.com/ggml-org/whisper.cpp) + Whisper large-v3-turbo). Your voice never leaves your machine, transcription is free, and it works offline. The OpenAI engine is still available as an opt-in setting.

VoicePaste is a **local, open-source** voice-to-text tool.
Press one key, speak, and polished text appears at your cursor — in any app. No account required. No API key needed for transcription.

> **All data stays on your machine.** Audio is transcribed on-device. History, dictionary, and settings are stored as local JSON files. Only the optional AI-polish step calls OpenAI's API — switch it off in Settings for fully offline use.

<p align="center">
  <img src="assets/screenshots/overlay.png" width="360" alt="Recording overlay with live transcription" />
  &nbsp;&nbsp;&nbsp;&nbsp;
  <img src="assets/screenshots/dashboard.png" width="500" alt="VoicePaste dashboard" />
</p>

## How It Works

```
 ┌─────────┐     ┌──────────────────┐     ┌───────────────┐     ┌─────────┐
 │ 🎙️ Speak │ ──▶ │ whisper.cpp      │ ──▶ │ AI Polish     │ ──▶ │ 📋 Paste │
 │         │     │ (100% on-device) │     │ (optional)    │     │         │
 └─────────┘     └──────────────────┘     └───────────────┘     └─────────┘
```

1. Press <kbd>\`</kbd> (the key below `Esc`) to start recording
2. Speak naturally — supports **99 languages** with automatic language detection
3. Press <kbd>\`</kbd> again to stop
4. Speech is segmented and transcribed **while you talk** (energy VAD + Silero VAD), then optionally polished and pasted at your cursor

While recording, finished phrases are already being transcribed in the background — stopping only flushes the tail, so results appear almost instantly.

### Local transcription engine

| Model | Download | RAM while transcribing | Notes |
|-------|----------|------------------------|-------|
| **Whisper large-v3-turbo (q5_0)** — default | 574 MB | ~1.2 GB | Near cloud-level accuracy, 99 languages |
| **Whisper small (q5_1)** — light | 190 MB | ~600 MB | For machines with less RAM |

- Models are downloaded once from Hugging Face (Settings → Transcription Engine) and stored locally
- The whisper.cpp sidecar starts on demand and **shuts down after 5 minutes idle → 0 MB RAM when not dictating**
- Apple Silicon builds use Metal acceleration; Windows builds use optimized CPU kernels (AVX2)
- Silero VAD trims silence server-side, preventing the classic whisper "subtitle" hallucinations

> **Recommended hotkey:** We suggest using <kbd>\`</kbd> (backtick, right below <kbd>Esc</kbd>). It's easy to reach and rarely conflicts with other shortcuts.

## Quick Start

```bash
git clone https://github.com/joshmarketingnl/voicepaste-local.git
cd voicepaste-local
npm install
npm run sidecar:download   # fetches/builds the whisper.cpp engine for your platform
npm start
```

On first launch, go to **Settings → Transcription Engine** and click **Download model**. That's it — no API key needed.

Optional: paste an [OpenAI API key](https://platform.openai.com/api-keys) to enable AI polish or the cloud engine.

### Requirements

- Node.js >= 18
- macOS (Accessibility permission required for auto-paste) or Windows
- macOS/Linux only: `cmake` + a C++ compiler to build the whisper.cpp sidecar (Windows uses the official prebuilt)

## Features

### AI Polish (Default: ON)

Raw speech is messy — VoicePaste cleans it up before pasting. The built-in polish prompt:

- Removes filler words (`uh`, `um`, `like`, `嗯`, `那个`, `えーと`, `저기`...)
- Structures multi-point speech into **numbered lists**
- Preserves code-switching — every word stays in its original language, never translates
- Matches the tone of a well-written Slack message

Toggle polish off in **Settings** → **Output Mode** for raw transcription (Fast Mode).

> **The polish prompt is fully customizable** — edit `src/main/openai-service.ts` to tune how your speech gets cleaned up.

### Multi-Language Support

VoicePaste supports **50+ languages** out of the box — English, Chinese, Japanese, Korean, Spanish, French, German, and many more. Language is detected automatically, no manual switching needed.

**Code-switching friendly:** Switch between languages mid-sentence. Say "오늘 meeting 에서 discuss 한 내용" or "我们需要 update 一下" — each word stays in its original language.

### Context-Aware Transcription

VoicePaste captures the **active app name**, **window title**, and **selected text** before transcribing. This helps the polish model understand technical terms and variable names in context.

### Dictionary

Add proper nouns, jargon, or names that the transcription model might misspell. These terms are injected into the transcription prompt so the model gets them right the first time.

*Example: Add "Supabase", "Zustand", "Tailwind" to avoid common mishearings.*

### History & Dashboard

Every transcription is saved locally as a JSON file. The dashboard gives you a quick overview of your usage:

| Stat | Meaning |
|------|---------|
| **Transcriptions** | Total number of voice-to-text sessions |
| **Total dictation time** | Cumulative recording duration |
| **Words dictated** | Total word count across all transcriptions |

All history data is stored on your machine — browse, search, and delete from the app.

<p align="center">
  <img src="assets/screenshots/dashboard.png" width="600" alt="VoicePaste dashboard showing transcription stats" />
</p>

### Settings

| Setting | Description |
|---------|-------------|
| **Transcription Engine** | <kbd>Local</kbd> (default) — on-device whisper.cpp, private and free. <kbd>OpenAI API</kbd> — cloud transcription. |
| **Speech model** | Local engine only: Best quality (large-v3-turbo, 574 MB) or Light (small, 190 MB). |
| **OpenAI API Key** | Optional with the local engine (used for AI polish only). Required for the OpenAI engine. |
| **Microphone** | Select input device. Defaults to system default. |
| **Output Mode** | <kbd>Polish</kbd> (default) — AI cleans up before pasting (OpenAI call). <kbd>Fast</kbd> — raw STT output, fully offline. |

<p align="center">
  <img src="assets/screenshots/userSetting.png" width="600" alt="VoicePaste settings — Output Mode toggle" />
</p>

## Before → After Examples

Here's what VoicePaste's AI Polish actually does:

---

**You say (raw transcription):**
> 嗯那个我觉得我们现在需要update一下那个feature就是那个login的flow有点问题就是用户点了之后没反应然后然后他们就会一直点就会触发多次request

**VoicePaste outputs:**
> login 的 flow 需要 update，目前有两个问题：
> 1. 用户点击之后没有反应
> 2. 用户会反复点击，触发多次 request

---

**You say:**
> ok so the plan is uh first we need to migrate the database then second thing is we update the API endpoints and then third we do the frontend changes and last step is we run the regression tests before we deploy

**VoicePaste outputs:**
> The plan is:
> 1. Migrate the database
> 2. Update the API endpoints
> 3. Make the frontend changes
> 4. Run regression tests before deploying

---

**You say:**
> 我今天跟那个PM聊了一下他说这个deadline可能要往后推一周因为design那边还没finalize他们还在跟stakeholder确认一些细节但是他说overall方向没问题

**VoicePaste outputs:**
> 今天跟 PM 聊了一下，主要信息：
> 1. Deadline 可能往后推一周
> 2. Design 还没 finalize，在跟 stakeholder 确认细节
> 3. Overall 方向没问题

---

**You say:**
> I think the better approach is to use WebSocket instead of 嗯polling because polling is gonna kill our server with that many concurrent users

**VoicePaste outputs:**
> I think the better approach is to use WebSocket instead of polling, because polling would overwhelm the server with that many concurrent users.

---

## macOS Permissions

The app requires:
- **Microphone** — for audio recording
- **Accessibility** — for simulating <kbd>Cmd</kbd>+<kbd>V</kbd> to paste transcribed text

Grant these in **System Settings** → **Privacy & Security**.

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Desktop Framework | Electron 40 |
| Build Tool | Electron Forge + Vite |
| UI Framework | React 19 |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 4 |
| State Management | Zustand |
| Speech-to-Text | **whisper.cpp (local, default)** or OpenAI Realtime API |
| Voice Activity Detection | Energy VAD (streaming segmentation) + Silero VAD (silence trimming) |
| Text Polish | OpenAI Chat Completions (optional) |
| Storage | electron-store + local JSON files |

## Project Structure

```
src/
  main/                  # Electron main process
    local-whisper-engine.ts      # Local engine: buffering, VAD segmentation, streaming transcription
    sidecar-manager.ts           # whisper.cpp server process (lazy start, idle shutdown)
    model-manager.ts             # Model downloads (Hugging Face) + hardware-based recommendation
    local-engine-factory.ts      # Engine wiring: config → sidecar → engine
    openai-service.ts            # OpenAI API calls (cloud transcription + polish prompt)
    ipc-handlers.ts              # Recording pipeline: start → stream → stop → polish → paste
    config-store.ts              # Persisted settings (electron-store)
    realtime-session-manager.ts  # OpenAI WebSocket session pool with warm-up
  main-app/              # React UI (dashboard, history, dictionary, settings)
  renderer/              # Overlay window (recording indicator + live transcript)
  shared/                # Types, constants, defaults
  preload.ts             # IPC bridge
resources/sidecar/       # Platform-specific whisper-server binaries (npm run sidecar:download)
scripts/
  download-sidecar.mjs   # Fetch/build the whisper.cpp sidecar for the current platform
  test-local-engine.mts  # Standalone smoke test for the local engine (no Electron needed)
```

## Credits

This is a local-first fork of [CloveSVG/voicepaste](https://github.com/CloveSVG/voicepaste) by junyuw2289-svg.
Local transcription is powered by [whisper.cpp](https://github.com/ggml-org/whisper.cpp) (Georgi Gerganov) and [OpenAI Whisper](https://github.com/openai/whisper) models, with [Silero VAD](https://github.com/snakers4/silero-vad) for silence trimming.

## License

MIT
