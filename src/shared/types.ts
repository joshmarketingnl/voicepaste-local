export type AppStatus = 'idle' | 'recording' | 'transcribing' | 'done' | 'error';
export type RendererLogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

export type PolishProvider = 'openai' | 'groq';

// Transcription engine selection
export type TranscriptionEngineKind = 'local' | 'openai';
export type LocalModelId = 'large-v3-turbo-q5_0' | 'small-q5_1';

export interface LocalModelInfo {
  id: LocalModelId;
  label: string;
  description: string;
  fileSizeMB: number;
  ramHintMB: number;
  installed: boolean;
}

export interface LocalModelStatusResult {
  models: LocalModelInfo[];
  recommended: LocalModelId;
  sidecarAvailable: boolean;
  vadInstalled: boolean;
  modelsDir: string;
}

export interface LocalModelProgress {
  id: LocalModelId | 'vad';
  receivedBytes: number;
  totalBytes: number;
  done: boolean;
  error?: string;
}

export interface CursorContext {
  appName: string;
  windowTitle: string;
  selectedText: string;
  elementRole: string;
}

export interface AppSettings {
  hotkey: string;
  language: string;
  enablePolish: boolean; // Enable AI polish after transcription
  polishProvider: PolishProvider; // Which provider to use for polish
  audioInputDeviceId: string; // Selected mic device ID; empty string = system default
  openaiApiKey: string; // User's OpenAI API key
  transcriptionEngine: TranscriptionEngineKind; // 'local' = on-device whisper.cpp, 'openai' = Realtime API
  localModel: LocalModelId; // Which local whisper model to use
}

// Dictionary types
export interface DictionaryWord {
  id: string;
  word: string;
  created_at: string;
}

// History types
export interface TranscriptionRecord {
  id: string;
  original_text: string;
  optimized_text: string | null;
  app_context: string | null;
  language: string | null;
  duration_seconds: number | null;
  created_at: string;
}

export interface HistoryListRequest {
  page: number;
  pageSize: number;
}

export interface HistoryListResult {
  data: TranscriptionRecord[];
  total: number;
}

export interface HistoryDeleteResult {
  success: boolean;
  error?: string;
}

export interface TranscriptionStatsResult {
  totalWords: number;
  totalCount: number;
  totalDurationSeconds: number;
}

type Disposer = () => void;

export interface ElectronAPI {
  onRecordingStart: (callback: () => void) => Disposer;
  onRecordingStop: (callback: () => void) => Disposer;
  onRecordingCancel: (callback: () => void) => Disposer;
  onRecordingCancelAvailability: (callback: (available: boolean) => void) => Disposer;
  onStatusUpdate: (callback: (status: AppStatus) => void) => Disposer;
  onTranscriptionResult: (callback: (text: string) => void) => Disposer;
  onTranscriptionError: (callback: (error: string) => void) => Disposer;
  cancelRecording: () => void;
  recordingPreflight: () => Promise<{ success: boolean; error?: string }>;
  reportRecordingStartFailure: (message: string) => void;
  getSettings: () => Promise<AppSettings>;
  setSettings: (settings: Partial<AppSettings>) => void;

  // Realtime streaming transcription
  realtimeStart: () => Promise<{ success: boolean; error?: string }>;
  realtimeSendAudio: (pcm16: ArrayBuffer) => void;
  realtimeStop: () => void;
  onRealtimeStarted: (callback: () => void) => Disposer;
  onRealtimeUtterance: (callback: (text: string) => void) => Disposer;
  onRealtimeError: (callback: (error: string) => void) => Disposer;
  realtimeResize: (width: number, height: number) => void;

  // Dictionary
  dictionaryList: () => Promise<DictionaryWord[]>;
  dictionaryAdd: (word: string) => Promise<DictionaryWord>;
  dictionaryDelete: (id: string) => Promise<{ success: boolean }>;

  // History
  historyList: (page: number, pageSize: number) => Promise<HistoryListResult>;
  historyDelete: (id: string) => Promise<HistoryDeleteResult>;
  historyGetDir: () => Promise<string>;
  historySetDir: (dir: string) => Promise<{ success: boolean; error?: string }>;

  // Stats
  statsGet: () => Promise<TranscriptionStatsResult>;
  onHistoryUpdated: (callback: () => void) => Disposer;

  // Local model management
  localModelStatus: () => Promise<LocalModelStatusResult>;
  localModelDownload: (id: LocalModelId) => Promise<{ success: boolean; error?: string }>;
  localModelDelete: (id: LocalModelId) => Promise<{ success: boolean; error?: string }>;
  onLocalModelProgress: (callback: (progress: LocalModelProgress) => void) => Disposer;

  // Diagnostic logging (renderer -> main, persisted by the main-process logger)
  rendererLog: (msg: string, level?: RendererLogLevel, source?: string) => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
