import type { EventEmitter } from 'events';
import type { RealtimeDebugSnapshot } from './realtime-transcription-service';

/**
 * Common surface shared by the OpenAI Realtime engine and the local whisper.cpp engine.
 *
 * Events:
 * - 'utterance' (text: string) — completed transcript for one phrase
 * - 'speech_started'
 * - 'speech_stopped'
 * - 'error' (msg: string)
 *
 * `RealtimeTranscriptionService` satisfies this interface structurally;
 * `LocalWhisperEngine` implements it explicitly.
 */
export interface TranscriptionEngine extends EventEmitter {
  readonly isConnected: boolean;
  getAccumulatedText(): string;
  getDebugSnapshot(): RealtimeDebugSnapshot;
  popLastTranscript(): void;
  replaceLastTranscript(text: string): void;
  removeWarmHandlers(): void;
  sendAudioChunk(pcm16: Buffer): void;
  stop(): Promise<string>;
  disconnect(): void;
}
