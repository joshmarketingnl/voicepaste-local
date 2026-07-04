import { app } from 'electron';
import { createWriteStream, existsSync, mkdirSync, statSync, unlinkSync, renameSync } from 'fs';
import os from 'os';
import path from 'path';
import type { LocalModelId, LocalModelInfo, LocalModelProgress } from '../shared/types';

export interface LocalModelSpec {
  id: LocalModelId;
  label: string;
  description: string;
  fileName: string;
  url: string;
  /** Approximate size, for UI display */
  fileSizeMB: number;
  /** Reject downloads smaller than this (catches HTML error pages etc.) */
  minBytes: number;
  ramHintMB: number;
}

export const LOCAL_MODELS: Record<LocalModelId, LocalModelSpec> = {
  'large-v3-turbo-q5_0': {
    id: 'large-v3-turbo-q5_0',
    label: 'Best quality (Whisper large-v3-turbo)',
    description: '99 languages, near cloud-level accuracy. ~574 MB download, ~1.2 GB RAM while transcribing.',
    fileName: 'ggml-large-v3-turbo-q5_0.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin',
    fileSizeMB: 574,
    minBytes: 400 * 1024 * 1024,
    ramHintMB: 1200,
  },
  'small-q5_1': {
    id: 'small-q5_1',
    label: 'Light (Whisper small)',
    description: '99 languages, good accuracy, for machines with less RAM. ~190 MB download, ~600 MB RAM.',
    fileName: 'ggml-small-q5_1.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin',
    fileSizeMB: 190,
    minBytes: 120 * 1024 * 1024,
    ramHintMB: 600,
  },
};

/** Silero VAD model used by whisper.cpp to trim silence (prevents hallucinations). */
export const VAD_MODEL = {
  fileName: 'ggml-silero-v5.1.2.bin',
  url: 'https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin',
  minBytes: 200 * 1024,
};

const RECOMMEND_TURBO_MIN_RAM_BYTES = 7.5 * 1024 * 1024 * 1024;

export function getModelsDir(): string {
  const override = process.env.VOICEPASTE_MODELS_DIR;
  const dir = override || path.join(app.getPath('userData'), 'models');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function getModelPath(id: LocalModelId): string {
  return path.join(getModelsDir(), LOCAL_MODELS[id].fileName);
}

export function getVadModelPath(): string {
  return path.join(getModelsDir(), VAD_MODEL.fileName);
}

export function isModelInstalled(id: LocalModelId): boolean {
  const filePath = getModelPath(id);
  if (!existsSync(filePath)) return false;
  try {
    return statSync(filePath).size >= LOCAL_MODELS[id].minBytes;
  } catch {
    return false;
  }
}

export function isVadModelInstalled(): boolean {
  const filePath = getVadModelPath();
  if (!existsSync(filePath)) return false;
  try {
    return statSync(filePath).size >= VAD_MODEL.minBytes;
  } catch {
    return false;
  }
}

/** Pick the default model based on installed RAM. */
export function recommendModel(): LocalModelId {
  return os.totalmem() >= RECOMMEND_TURBO_MIN_RAM_BYTES ? 'large-v3-turbo-q5_0' : 'small-q5_1';
}

export function listModels(): LocalModelInfo[] {
  return Object.values(LOCAL_MODELS).map((spec) => ({
    id: spec.id,
    label: spec.label,
    description: spec.description,
    fileSizeMB: spec.fileSizeMB,
    ramHintMB: spec.ramHintMB,
    installed: isModelInstalled(spec.id),
  }));
}

export function deleteModel(id: LocalModelId): void {
  const filePath = getModelPath(id);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
    console.log(`[Models] Deleted ${filePath}`);
  }
}

/**
 * Download a model file with progress reporting. Writes to a `.part` file
 * first and renames on success so an interrupted download never looks
 * installed.
 */
export async function downloadModelFile(
  id: LocalModelId | 'vad',
  onProgress: (progress: LocalModelProgress) => void,
): Promise<void> {
  const spec = id === 'vad'
    ? { fileName: VAD_MODEL.fileName, url: VAD_MODEL.url, minBytes: VAD_MODEL.minBytes }
    : { fileName: LOCAL_MODELS[id].fileName, url: LOCAL_MODELS[id].url, minBytes: LOCAL_MODELS[id].minBytes };

  const targetPath = path.join(getModelsDir(), spec.fileName);
  const partPath = `${targetPath}.part`;

  console.log(`[Models] Downloading ${spec.url}`);
  const response = await fetch(spec.url);
  if (!response.ok || !response.body) {
    throw new Error(`Model download failed: HTTP ${response.status}`);
  }

  const totalBytes = Number(response.headers.get('content-length') ?? 0);
  let receivedBytes = 0;
  let lastReport = 0;

  const fileStream = createWriteStream(partPath);
  try {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      await new Promise<void>((resolve, reject) => {
        fileStream.write(Buffer.from(value), (err) => (err ? reject(err) : resolve()));
      });
      const now = Date.now();
      if (now - lastReport >= 250) {
        lastReport = now;
        onProgress({ id, receivedBytes, totalBytes, done: false });
      }
    }
    await new Promise<void>((resolve, reject) => {
      fileStream.end((err?: Error | null) => (err ? reject(err) : resolve()));
    });
  } catch (error) {
    fileStream.destroy();
    try { unlinkSync(partPath); } catch { /* noop */ }
    throw error;
  }

  const finalSize = statSync(partPath).size;
  if (finalSize < spec.minBytes) {
    try { unlinkSync(partPath); } catch { /* noop */ }
    throw new Error(`Downloaded file is too small (${finalSize} bytes) — download corrupted?`);
  }

  try { unlinkSync(targetPath); } catch { /* noop */ }
  renameSync(partPath, targetPath);
  onProgress({ id, receivedBytes, totalBytes: totalBytes || receivedBytes, done: true });
  console.log(`[Models] Installed ${spec.fileName} (${Math.round(finalSize / 1024 / 1024)}MB)`);
}
