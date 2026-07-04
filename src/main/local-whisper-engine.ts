import { EventEmitter } from 'events';
import { bufferToPcm16, encodeWavPcm16, pcm16Rms, resamplePcm16 } from './audio-utils';
import type { RealtimeDebugSnapshot } from './realtime-transcription-service';
import type { SidecarManager } from './sidecar-manager';
import type { TranscriptionEngine } from './transcription-engine';

export interface LocalWhisperEngineOptions {
  sidecar: SidecarManager;
  /** Whisper language code; '' or undefined = auto-detect */
  language?: string;
  /** Initial prompt used to bias decoding (dictionary glossary) */
  initialPrompt?: string;
  /** Input sample rate of incoming PCM16 chunks (VoicePaste records at 24 kHz) */
  inputSampleRate?: number;
}

const INPUT_SAMPLE_RATE_DEFAULT = 24_000;
const WHISPER_SAMPLE_RATE = 16_000;

// Energy-based utterance segmentation (streaming). whisper.cpp's built-in
// Silero VAD additionally trims silence inside each segment server-side.
const SPEECH_START_RMS = 0.015;
const SPEECH_KEEP_RMS = 0.009;
const SILENCE_HANGOVER_MS = 900;
const PRE_ROLL_MS = 320;
const POST_ROLL_MS = 220;
const MIN_SEGMENT_MS = 350;
const MAX_SEGMENT_MS = 28_000;
const STOP_FLUSH_TIMEOUT_MS = 120_000;
const MIN_FALLBACK_AUDIO_MS = 300;

// Classic whisper silence hallucinations. A segment is dropped only when the
// WHOLE trimmed text matches one of these.
const HALLUCINATION_PATTERNS: RegExp[] = [
  /^[\s.,!?~-]*$/,
  /^(thank you|thanks|thank you for watching|thanks for watching)[.!\s]*$/i,
  /^(bedankt voor het kijken|tot de volgende keer)[.!\s]*$/i,
  /^\(?\s*(music|applause|silence|muziek|applaus|stilte)\s*\)?[.!\s]*$/i,
  /^\[\s*(music|applause|silence|blank_audio|typing|inaudible)\s*\][.!\s]*$/i,
  /amara\.org/i,
  /^(ondertitel(s|d)?|untertitel(ung)?|sous-titr\w*|subt[ií]tulos|字幕|자막).{0,60}$/i,
  /^subtitles? (by|made|provided|created).{0,60}$/i,
  /^www\.[a-z0-9.-]+$/i,
];

/**
 * Fully local transcription engine backed by a whisper.cpp sidecar.
 *
 * Drop-in replacement for RealtimeTranscriptionService: audio chunks stream in
 * over the same IPC path, utterances are segmented with an energy VAD while
 * recording, and each segment is transcribed in the background so `stop()`
 * only has to flush the tail.
 */
export class LocalWhisperEngine extends EventEmitter implements TranscriptionEngine {
  private readonly opts: LocalWhisperEngineOptions;
  private readonly inputRate: number;

  // Growing PCM buffer for the whole recording
  private samples = new Int16Array(INPUT_SAMPLE_RATE_DEFAULT * 60);
  private sampleCount = 0;

  // Segmentation state
  private speechActive = false;
  private segmentStart = 0; // sample offset
  private silenceMs = 0;
  private segmentsEnqueued = 0;

  // Transcription pipeline
  private jobChain: Promise<void> = Promise.resolve();
  private pendingJobs = 0;
  private accumulatedTranscripts: string[] = [];

  // Lifecycle / diagnostics
  private connected = false;
  private disposed = false;
  private stopping = false;
  private audioChunksReceived = 0;
  private speechStartedCount = 0;
  private speechStoppedCount = 0;
  private transcriptCompletedCount = 0;
  private lastTranscriptPreview: string | null = null;
  private lastTranscriptionFailure: string | null = null;
  private lastServerError: string | null = null;
  private stopRequestedAt: number | null = null;
  private stopResolvedAt: number | null = null;
  private recentEvents: string[] = [];

  constructor(opts: LocalWhisperEngineOptions) {
    super();
    this.opts = opts;
    this.inputRate = opts.inputSampleRate ?? INPUT_SAMPLE_RATE_DEFAULT;
  }

  get isConnected(): boolean {
    return this.connected && !this.disposed;
  }

  /**
   * Validates the sidecar (binary + model present) and warms it up in the
   * background. Returns immediately so recording can start without waiting
   * for the model to load — audio is buffered locally anyway.
   */
  async connect(): Promise<void> {
    this.opts.sidecar.preflight();
    this.connected = true;
    this.rememberEvent('local.connected');

    this.opts.sidecar.ensureRunning().catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[LocalEngine] Sidecar warm-up failed: ${msg}`);
      this.lastServerError = msg;
    });
  }

  getAccumulatedText(): string {
    return this.accumulatedTranscripts.join(' ');
  }

  getDebugSnapshot(): RealtimeDebugSnapshot {
    return {
      isConnected: this.isConnected,
      audioChunksSent: this.audioChunksReceived,
      accumulatedTranscriptCount: this.accumulatedTranscripts.length,
      accumulatedTextPreview: this.getAccumulatedText().slice(0, 300),
      speechStartedCount: this.speechStartedCount,
      speechStoppedCount: this.speechStoppedCount,
      transcriptCompletedCount: this.transcriptCompletedCount,
      transcriptDeltaCount: 0,
      lastTranscriptPreview: this.lastTranscriptPreview,
      lastDeltaPreview: null,
      lastTranscriptionFailure: this.lastTranscriptionFailure,
      lastServerError: this.lastServerError,
      stopRequestedAt: this.stopRequestedAt,
      stopResolvedAt: this.stopResolvedAt,
      stopResolution: this.stopResolvedAt ? 'completed' : (this.stopRequestedAt ? 'waiting' : null),
      recentEvents: [...this.recentEvents],
    };
  }

  popLastTranscript(): void {
    this.accumulatedTranscripts.pop();
  }

  replaceLastTranscript(text: string): void {
    if (this.accumulatedTranscripts.length === 0) return;
    this.accumulatedTranscripts[this.accumulatedTranscripts.length - 1] = text;
  }

  removeWarmHandlers(): void {
    this.removeAllListeners();
  }

  sendAudioChunk(pcm16: Buffer): void {
    if (!this.connected || this.disposed || this.stopping) return;

    const chunk = bufferToPcm16(pcm16);
    if (chunk.length === 0) return;

    this.appendSamples(chunk);
    this.audioChunksReceived++;
    if (this.audioChunksReceived % 50 === 1) {
      console.log(`[LocalEngine] Audio chunks received: ${this.audioChunksReceived}`);
    }

    this.advanceSegmentation(chunk.length, pcm16Rms(chunk));
  }

  /**
   * Flush: finalize the trailing segment, wait for all queued transcriptions,
   * and return the accumulated text.
   */
  async stop(): Promise<string> {
    this.stopRequestedAt = Date.now();
    this.rememberEvent('local.stop');

    if (this.stopping) {
      return this.getAccumulatedText();
    }
    this.stopping = true;

    // Finalize trailing speech
    if (this.speechActive) {
      this.speechActive = false;
      this.speechStoppedCount++;
      this.safeEmit('speech_stopped');
      this.enqueueSegment(this.segmentStart, this.sampleCount);
    }

    // Fallback: if the energy VAD never triggered but we did record audio,
    // transcribe the whole buffer instead of returning nothing.
    const totalMs = (this.sampleCount / this.inputRate) * 1000;
    if (this.segmentsEnqueued === 0 && totalMs >= MIN_FALLBACK_AUDIO_MS) {
      console.log(`[LocalEngine] No segments detected, falling back to full-buffer transcription (${Math.round(totalMs)}ms)`);
      this.enqueueSegment(0, this.sampleCount);
    }

    // Wait for the queue to drain (bounded)
    const flushDeadline = new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        console.warn('[LocalEngine] Flush timeout reached, returning partial transcript');
        resolve();
      }, STOP_FLUSH_TIMEOUT_MS);
      // Don't keep process alive for the timeout
      (t as unknown as { unref?: () => void }).unref?.();
      this.jobChain.then(() => {
        clearTimeout(t);
        resolve();
      });
    });
    await flushDeadline;

    this.stopResolvedAt = Date.now();
    const fullText = this.getAccumulatedText();
    console.log(`[LocalEngine] Final accumulated text (${this.accumulatedTranscripts.length} segments, flush ${this.stopResolvedAt - this.stopRequestedAt}ms): "${fullText.slice(0, 200)}"`);
    return fullText;
  }

  disconnect(): void {
    console.log(`[LocalEngine] Disconnecting (chunks: ${this.audioChunksReceived}, transcripts: ${this.accumulatedTranscripts.length})`);
    this.disposed = true;
    this.connected = false;
    // Note: the sidecar process is shared and managed by its own idle
    // watchdog — we intentionally do NOT kill it here.
    this.samples = new Int16Array(0);
    this.sampleCount = 0;
    this.accumulatedTranscripts = [];
    this.removeAllListeners();
  }

  // --- Internal ---

  private appendSamples(chunk: Int16Array): void {
    if (this.sampleCount + chunk.length > this.samples.length) {
      const grown = new Int16Array(Math.max(this.samples.length * 2, this.sampleCount + chunk.length));
      grown.set(this.samples.subarray(0, this.sampleCount));
      this.samples = grown;
    }
    this.samples.set(chunk, this.sampleCount);
    this.sampleCount += chunk.length;
  }

  private advanceSegmentation(chunkSamples: number, rms: number): void {
    const chunkMs = (chunkSamples / this.inputRate) * 1000;
    const chunkEnd = this.sampleCount;

    if (!this.speechActive) {
      if (rms >= SPEECH_START_RMS) {
        this.speechActive = true;
        this.silenceMs = 0;
        const preRollSamples = Math.round((PRE_ROLL_MS / 1000) * this.inputRate);
        this.segmentStart = Math.max(0, chunkEnd - chunkSamples - preRollSamples);
        this.speechStartedCount++;
        this.rememberEvent('vad.speech_started');
        this.safeEmit('speech_started');
      }
      return;
    }

    // Speech is active
    if (rms < SPEECH_KEEP_RMS) {
      this.silenceMs += chunkMs;
      if (this.silenceMs >= SILENCE_HANGOVER_MS) {
        const postRollSamples = Math.round((POST_ROLL_MS / 1000) * this.inputRate);
        const silenceSamples = Math.round((this.silenceMs / 1000) * this.inputRate);
        const segmentEnd = Math.min(chunkEnd, chunkEnd - silenceSamples + postRollSamples);
        this.speechActive = false;
        this.silenceMs = 0;
        this.speechStoppedCount++;
        this.rememberEvent('vad.speech_stopped');
        this.safeEmit('speech_stopped');
        this.enqueueSegment(this.segmentStart, segmentEnd);
      }
      return;
    }

    this.silenceMs = 0;

    // Force a boundary on very long utterances so text streams in
    const segmentMs = ((chunkEnd - this.segmentStart) / this.inputRate) * 1000;
    if (segmentMs >= MAX_SEGMENT_MS) {
      this.enqueueSegment(this.segmentStart, chunkEnd);
      this.segmentStart = chunkEnd;
    }
  }

  private enqueueSegment(startSample: number, endSample: number): void {
    const start = Math.max(0, Math.min(startSample, this.sampleCount));
    const end = Math.max(start, Math.min(endSample, this.sampleCount));
    const durationMs = ((end - start) / this.inputRate) * 1000;
    if (durationMs < MIN_SEGMENT_MS) {
      console.log(`[LocalEngine] Skipping too-short segment (${Math.round(durationMs)}ms)`);
      return;
    }

    const segment = this.samples.slice(start, end);
    this.segmentsEnqueued++;
    this.pendingJobs++;
    this.rememberEvent(`segment.enqueued(${Math.round(durationMs)}ms)`);

    this.jobChain = this.jobChain
      .then(() => this.transcribeSegment(segment))
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[LocalEngine] Segment transcription failed: ${msg}`);
        this.lastTranscriptionFailure = msg;
      })
      .finally(() => {
        this.pendingJobs = Math.max(0, this.pendingJobs - 1);
      });
  }

  private async transcribeSegment(segment: Int16Array): Promise<void> {
    if (this.disposed) return;

    const t0 = Date.now();
    const resampled = resamplePcm16(segment, this.inputRate, WHISPER_SAMPLE_RATE);
    const wav = encodeWavPcm16(resampled, WHISPER_SAMPLE_RATE);

    const text = await this.opts.sidecar.transcribe(wav, {
      language: this.opts.language,
      prompt: this.opts.initialPrompt,
      temperature: 0,
    });

    const cleaned = text.replace(/\s+/g, ' ').trim();
    console.log(`[LocalEngine] Segment transcribed in ${Date.now() - t0}ms: "${cleaned.slice(0, 120)}"`);

    if (!cleaned || this.isHallucination(cleaned)) {
      if (cleaned) {
        console.warn(`[LocalEngine] Dropped hallucinated segment: "${cleaned.slice(0, 120)}"`);
        this.rememberEvent('segment.hallucination_dropped');
      }
      return;
    }

    this.transcriptCompletedCount++;
    this.lastTranscriptPreview = cleaned.slice(0, 200);
    this.accumulatedTranscripts.push(cleaned);
    if (!this.disposed) {
      this.safeEmit('utterance', cleaned);
    }
  }

  private isHallucination(text: string): boolean {
    return HALLUCINATION_PATTERNS.some((pattern) => pattern.test(text));
  }

  private safeEmit(event: string, ...args: unknown[]): void {
    try {
      if (this.listenerCount(event) > 0) {
        this.emit(event, ...args);
      }
    } catch (err) {
      console.error(`[LocalEngine] Listener for '${event}' threw:`, err);
    }
  }

  private rememberEvent(type: string): void {
    this.recentEvents.push(type);
    if (this.recentEvents.length > 25) {
      this.recentEvents.splice(0, this.recentEvents.length - 25);
    }
  }
}
