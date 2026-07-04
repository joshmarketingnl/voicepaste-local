import { BrowserWindow, ipcMain } from 'electron';
import { IPC_CHANNELS } from '../shared/constants';
import type { LocalModelId, LocalModelProgress, LocalModelStatusResult } from '../shared/types';
import {
  deleteModel,
  downloadModelFile,
  getModelsDir,
  isVadModelInstalled,
  listModels,
  LOCAL_MODELS,
  recommendModel,
} from './model-manager';
import { disposeLocalSidecar, isSidecarAvailable } from './local-engine-factory';

const activeDownloads = new Set<string>();

export function registerLocalModelIPC(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.removeHandler(IPC_CHANNELS.LOCAL_MODEL_STATUS);
  ipcMain.removeHandler(IPC_CHANNELS.LOCAL_MODEL_DOWNLOAD);
  ipcMain.removeHandler(IPC_CHANNELS.LOCAL_MODEL_DELETE);

  const sendProgress = (progress: LocalModelProgress) => {
    getMainWindow()?.webContents.send(IPC_CHANNELS.LOCAL_MODEL_PROGRESS, progress);
  };

  ipcMain.handle(IPC_CHANNELS.LOCAL_MODEL_STATUS, (): LocalModelStatusResult => {
    return {
      models: listModels(),
      recommended: recommendModel(),
      sidecarAvailable: isSidecarAvailable(),
      vadInstalled: isVadModelInstalled(),
      modelsDir: getModelsDir(),
    };
  });

  ipcMain.handle(IPC_CHANNELS.LOCAL_MODEL_DOWNLOAD, async (_event, id: LocalModelId) => {
    if (!LOCAL_MODELS[id]) {
      return { success: false, error: `Unknown model: ${id}` };
    }
    if (activeDownloads.has(id)) {
      return { success: false, error: 'Download already in progress' };
    }

    activeDownloads.add(id);
    try {
      await downloadModelFile(id, sendProgress);

      // Best effort: also fetch the tiny Silero VAD model (trims silence,
      // prevents whisper hallucinations). Non-fatal when unavailable.
      if (!isVadModelInstalled()) {
        try {
          await downloadModelFile('vad', sendProgress);
        } catch (err) {
          console.warn(`[Models] VAD model download failed (non-fatal): ${err instanceof Error ? err.message : err}`);
        }
      }

      // A running sidecar may hold the old model — restart lazily.
      disposeLocalSidecar();
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[Models] Download failed: ${message}`);
      sendProgress({ id, receivedBytes: 0, totalBytes: 0, done: true, error: message });
      return { success: false, error: message };
    } finally {
      activeDownloads.delete(id);
    }
  });

  ipcMain.handle(IPC_CHANNELS.LOCAL_MODEL_DELETE, (_event, id: LocalModelId) => {
    if (!LOCAL_MODELS[id]) {
      return { success: false, error: `Unknown model: ${id}` };
    }
    try {
      disposeLocalSidecar();
      deleteModel(id);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
