import { app } from 'electron';
import { existsSync } from 'fs';
import path from 'path';
import { getConfig } from './config-store';
import { LocalWhisperEngine } from './local-whisper-engine';
import { SidecarManager } from './sidecar-manager';
import { getModelPath, getVadModelPath, isModelInstalled, isVadModelInstalled, LOCAL_MODELS } from './model-manager';

const MAX_PROMPT_WORDS = 24;

export function getSidecarDir(): string {
  const override = process.env.VOICEPASTE_SIDECAR_DIR;
  if (override) return override;
  return app.isPackaged
    ? path.join(process.resourcesPath, 'sidecar')
    : path.join(app.getAppPath(), 'resources', 'sidecar');
}

export function getSidecarBinaryPath(): string {
  const exeName = process.platform === 'win32' ? 'whisper-server.exe' : 'whisper-server';
  return path.join(getSidecarDir(), `${process.platform}-${process.arch}`, exeName);
}

export function isSidecarAvailable(): boolean {
  return existsSync(getSidecarBinaryPath());
}

// One shared sidecar per (binary, model) combination — reused across
// recordings so the model stays warm between dictations.
let currentSidecar: SidecarManager | null = null;
let currentSidecarKey = '';

export function getLocalSidecar(): SidecarManager {
  const config = getConfig();
  const binaryPath = getSidecarBinaryPath();
  const modelPath = getModelPath(config.localModel);
  const key = `${binaryPath}|${modelPath}`;

  if (currentSidecar && currentSidecarKey !== key) {
    currentSidecar.dispose();
    currentSidecar = null;
  }
  if (!currentSidecar) {
    currentSidecar = new SidecarManager({
      binaryPath,
      modelPath,
      vadModelPath: isVadModelInstalled() ? getVadModelPath() : null,
    });
    currentSidecarKey = key;
  }
  return currentSidecar;
}

/** Kill the sidecar (e.g. on settings change or app quit). Lazily recreated. */
export function disposeLocalSidecar(): void {
  if (currentSidecar) {
    currentSidecar.dispose();
    currentSidecar = null;
    currentSidecarKey = '';
  }
}

/**
 * Build a short glossary prompt that biases whisper decoding towards
 * dictionary words (whisper treats the initial prompt as preceding context).
 */
export function buildLocalInitialPrompt(dictionaryWords: string[]): string | undefined {
  const words = Array.from(new Set(dictionaryWords.map((w) => w.trim()).filter(Boolean)))
    .slice(0, MAX_PROMPT_WORDS);
  if (words.length === 0) return undefined;
  return `Glossary: ${words.join(', ')}.`;
}

/**
 * Create a LocalWhisperEngine for one recording session.
 * Throws a user-friendly error if the model has not been downloaded yet.
 */
export function createLocalEngine(dictionaryWords: string[]): LocalWhisperEngine {
  const config = getConfig();

  if (!isModelInstalled(config.localModel)) {
    const spec = LOCAL_MODELS[config.localModel];
    throw new Error(
      `The local speech model (${spec.label}, ${spec.fileSizeMB} MB) is not downloaded yet. ` +
      'Open Settings → Transcription Engine and click Download.',
    );
  }

  return new LocalWhisperEngine({
    sidecar: getLocalSidecar(),
    language: config.language || undefined,
    initialPrompt: buildLocalInitialPrompt(dictionaryWords),
  });
}
