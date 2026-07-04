import type { LocalModelId, PolishProvider, TranscriptionEngineKind } from './types';

export const APP_DEFAULTS = {
  hotkey: '`',
  language: '',
  enablePolish: true,
  polishProvider: 'openai' as PolishProvider,
  audioInputDeviceId: '',
  openaiApiKey: '',
  transcriptionEngine: 'local' as TranscriptionEngineKind,
  localModel: 'large-v3-turbo-q5_0' as LocalModelId,
} as const;
