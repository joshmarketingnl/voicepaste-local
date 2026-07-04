import Store from 'electron-store';
import { APP_DEFAULTS } from '../shared/app-defaults';
import type { LocalModelId, PolishProvider, TranscriptionEngineKind } from '../shared/types';

interface StoreSchema {
  hotkey: string;
  language: string;
  enablePolish: boolean;
  polishProvider: PolishProvider;
  audioInputDeviceId: string;
  openaiApiKey: string;
  transcriptionEngine: TranscriptionEngineKind;
  localModel: LocalModelId;
}

const store = new Store<StoreSchema>({
  defaults: {
    hotkey: APP_DEFAULTS.hotkey,
    language: APP_DEFAULTS.language,
    enablePolish: APP_DEFAULTS.enablePolish,
    polishProvider: APP_DEFAULTS.polishProvider,
    audioInputDeviceId: APP_DEFAULTS.audioInputDeviceId,
    openaiApiKey: APP_DEFAULTS.openaiApiKey,
    transcriptionEngine: APP_DEFAULTS.transcriptionEngine,
    localModel: APP_DEFAULTS.localModel,
  },
});

function normalizeLegacyConfig(): void {
  const legacyAudioInputDeviceId = store.get('audioInputDeviceId');
  if (legacyAudioInputDeviceId === 'default') {
    store.set('audioInputDeviceId', '');
  }

  // Existing installs that already configured an OpenAI API key keep the
  // cloud engine until they explicitly switch — new installs default to local.
  if (!store.has('transcriptionEngine') && store.get('openaiApiKey')) {
    store.set('transcriptionEngine', 'openai');
  }
}

normalizeLegacyConfig();

store.set('hotkey', APP_DEFAULTS.hotkey);
store.set('polishProvider', APP_DEFAULTS.polishProvider);

// Clear legacy Supabase session store on startup
try { new Store({ name: 'supabase-session' }).clear(); } catch { /* ignore */ }

export function getConfig(): StoreSchema {
  return {
    hotkey: store.get('hotkey'),
    language: store.get('language'),
    enablePolish: store.get('enablePolish'),
    polishProvider: store.get('polishProvider'),
    audioInputDeviceId: store.get('audioInputDeviceId'),
    openaiApiKey: store.get('openaiApiKey'),
    transcriptionEngine: store.get('transcriptionEngine'),
    localModel: store.get('localModel'),
  };
}

export function setConfig(partial: Partial<StoreSchema>): void {
  for (const [key, value] of Object.entries(partial)) {
    store.set(key as keyof StoreSchema, value as any);
  }
}

export default store;
