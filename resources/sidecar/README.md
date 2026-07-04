# Local transcription sidecar (whisper.cpp)

This directory holds the platform-specific `whisper-server` binaries that power
VoicePaste's local transcription engine. They are **not** committed to git.

Layout expected by the app (`src/main/local-engine-factory.ts`):

```
resources/sidecar/
  win32-x64/whisper-server.exe   (+ whisper.dll, ggml*.dll)
  darwin-arm64/whisper-server    (Metal-accelerated)
  darwin-x64/whisper-server
  linux-x64/whisper-server
```

## Getting the binaries

- **Development:** `npm run sidecar:download`
  - Windows: downloads the official prebuilt from whisper.cpp releases
  - macOS/Linux: builds whisper.cpp from source (requires cmake + a compiler)
- **CI/Release:** the `build-sidecar` GitHub Actions workflow builds all
  platforms and uploads them as artifacts.

The whole directory is bundled into the app via `extraResource` in
`forge.config.ts`, so packaged builds find the binary at
`<resources>/sidecar/<platform>-<arch>/`.

Speech models are *not* bundled — they are downloaded on first use into the
user's data directory (Settings → Transcription Engine).
