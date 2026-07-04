import { spawn, type ChildProcess } from 'child_process';
import { existsSync, statSync } from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';

export interface SidecarOptions {
  binaryPath: string;
  modelPath: string;
  vadModelPath?: string | null;
  threads?: number;
  /** Kill the server process after this much idle time to free RAM. Default 5 minutes. */
  idleTimeoutMs?: number;
}

export interface TranscribeOptions {
  /** Whisper language code ('' or undefined = auto-detect) */
  language?: string;
  /** Initial prompt used to bias decoding (e.g. dictionary glossary) */
  prompt?: string;
  temperature?: number;
}

const SERVER_READY_TIMEOUT_MS = 90_000; // large models can take a while to load from disk
const SERVER_POLL_INTERVAL_MS = 250;
const EARLY_EXIT_WINDOW_MS = 2_500;
const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60_000;
const IDLE_CHECK_INTERVAL_MS = 30_000;
const INFERENCE_TIMEOUT_MS = 120_000;

function defaultThreadCount(): number {
  const cores = os.cpus()?.length ?? 4;
  return Math.max(2, Math.min(8, cores - 2));
}

/**
 * Manages a local whisper.cpp `whisper-server` sidecar process.
 *
 * - Lazily started on first transcription request
 * - Kept warm while in use, killed after `idleTimeoutMs` of inactivity (frees RAM)
 * - Falls back to launching without VAD flags if the binary rejects them
 */
export class SidecarManager {
  private readonly opts: SidecarOptions;
  private proc: ChildProcess | null = null;
  private port: number | null = null;
  private startPromise: Promise<number> | null = null;
  private lastUsedAt = Date.now();
  private busyCount = 0;
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private vadDisabled = false;

  constructor(opts: SidecarOptions) {
    // Resolve to absolute paths: spawn() with a `cwd` option would otherwise
    // resolve a relative binary path against the wrong directory.
    this.opts = {
      ...opts,
      binaryPath: path.resolve(opts.binaryPath),
      modelPath: path.resolve(opts.modelPath),
      vadModelPath: opts.vadModelPath ? path.resolve(opts.vadModelPath) : opts.vadModelPath,
    };
  }

  /** Validates that the binary and model exist. Throws a user-friendly error otherwise. */
  preflight(): void {
    if (!existsSync(this.opts.binaryPath)) {
      throw new Error(
        `Local transcription engine is not installed for this platform (missing ${path.basename(this.opts.binaryPath)}). ` +
        'Reinstall VoicePaste or run "npm run sidecar:download" in development.',
      );
    }
    if (!existsSync(this.opts.modelPath)) {
      throw new Error(
        'The local speech model is not downloaded yet. Open Settings and download it under "Transcription Engine".',
      );
    }
  }

  get isRunning(): boolean {
    return this.proc !== null && this.port !== null;
  }

  /** Ensure the server is running; resolves with the HTTP port. */
  async ensureRunning(): Promise<number> {
    if (this.disposed) {
      throw new Error('Sidecar manager disposed');
    }
    if (this.proc && this.port !== null) {
      return this.port;
    }
    if (!this.startPromise) {
      this.startPromise = this.start().finally(() => {
        this.startPromise = null;
      });
    }
    return this.startPromise;
  }

  /**
   * Transcribe a 16 kHz mono PCM16 WAV buffer. Returns the raw transcript text.
   */
  async transcribe(wav: Buffer, options: TranscribeOptions = {}): Promise<string> {
    const port = await this.ensureRunning();
    this.busyCount++;
    this.lastUsedAt = Date.now();

    try {
      const form = buildMultipart([
        { name: 'file', filename: 'audio.wav', contentType: 'audio/wav', data: wav },
        { name: 'response_format', data: Buffer.from('json') },
        { name: 'temperature', data: Buffer.from(String(options.temperature ?? 0)) },
        { name: 'language', data: Buffer.from(options.language?.trim() || 'auto') },
        ...(options.prompt ? [{ name: 'prompt', data: Buffer.from(options.prompt) }] : []),
      ]);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), INFERENCE_TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetch(`http://127.0.0.1:${port}/inference`, {
          method: 'POST',
          headers: { 'Content-Type': `multipart/form-data; boundary=${form.boundary}` },
          body: form.body,
          signal: controller.signal,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          throw new Error(`Local transcription timed out after ${INFERENCE_TIMEOUT_MS}ms`);
        }
        throw error;
      } finally {
        clearTimeout(timeoutId);
      }

      const bodyText = await response.text();
      if (!response.ok) {
        throw new Error(`Local transcription server error ${response.status}: ${bodyText.slice(0, 300)}`);
      }

      try {
        const parsed = JSON.parse(bodyText) as { text?: string; error?: string };
        if (parsed.error) {
          throw new Error(`Local transcription failed: ${parsed.error}`);
        }
        return (parsed.text ?? '').trim();
      } catch (err) {
        if (err instanceof SyntaxError) {
          // Some builds return plain text for response_format=json edge cases
          return bodyText.trim();
        }
        throw err;
      }
    } finally {
      this.busyCount = Math.max(0, this.busyCount - 1);
      this.lastUsedAt = Date.now();
    }
  }

  /** Kill the server process (RAM drops to zero). Safe to call repeatedly. */
  stop(): void {
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.proc) {
      console.log('[Sidecar] Stopping whisper-server');
      try {
        this.proc.removeAllListeners();
        this.proc.kill();
      } catch {
        // already dead
      }
      this.proc = null;
    }
    this.port = null;
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
  }

  // --- Internal ---

  private async start(): Promise<number> {
    this.preflight();

    const modelSizeMB = Math.round(statSync(this.opts.modelPath).size / 1024 / 1024);
    const port = await findFreePort();
    const useVad = !this.vadDisabled
      && !!this.opts.vadModelPath
      && existsSync(this.opts.vadModelPath);

    console.log(`[Sidecar] Starting whisper-server (model=${path.basename(this.opts.modelPath)}, ${modelSizeMB}MB, port=${port}, vad=${useVad})`);

    try {
      await this.spawnAndWait(port, useVad);
    } catch (error) {
      if (useVad) {
        // Older/leaner builds may not support VAD flags — retry without them once.
        console.warn(`[Sidecar] Start with VAD failed (${error instanceof Error ? error.message : error}), retrying without VAD`);
        this.vadDisabled = true;
        await this.spawnAndWait(port, false);
      } else {
        throw error;
      }
    }

    this.port = port;
    this.lastUsedAt = Date.now();
    this.startIdleWatchdog();
    console.log(`[Sidecar] whisper-server ready on port ${port}`);
    return port;
  }

  private spawnAndWait(port: number, useVad: boolean): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const args = [
        '-m', this.opts.modelPath,
        '--host', '127.0.0.1',
        '--port', String(port),
        '-t', String(this.opts.threads ?? defaultThreadCount()),
      ];
      if (useVad && this.opts.vadModelPath) {
        args.push('--vad', '--vad-model', this.opts.vadModelPath);
      }

      const startedAt = Date.now();
      const proc = spawn(this.opts.binaryPath, args, {
        cwd: path.dirname(this.opts.binaryPath),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let settled = false;
      let stderrTail = '';

      proc.stdout?.on('data', (chunk: Buffer) => {
        const line = chunk.toString().trim();
        if (line) console.log(`[Sidecar:out] ${line.slice(0, 400)}`);
      });
      proc.stderr?.on('data', (chunk: Buffer) => {
        stderrTail = (stderrTail + chunk.toString()).slice(-2000);
      });

      proc.on('error', (err) => {
        if (!settled) {
          settled = true;
          reject(new Error(`Failed to launch whisper-server: ${err.message}`));
        }
      });

      proc.on('exit', (code, signal) => {
        const uptime = Date.now() - startedAt;
        console.warn(`[Sidecar] whisper-server exited (code=${code}, signal=${signal}, uptime=${uptime}ms)`);
        if (this.proc === proc) {
          this.proc = null;
          this.port = null;
        }
        if (!settled && uptime < EARLY_EXIT_WINDOW_MS + SERVER_READY_TIMEOUT_MS) {
          settled = true;
          reject(new Error(
            `whisper-server exited early (code=${code}). ${stderrTail ? `stderr: ${stderrTail.slice(-400)}` : ''}`,
          ));
        }
      });

      this.proc = proc;

      waitForHttp(port, proc, SERVER_READY_TIMEOUT_MS)
        .then(() => {
          if (!settled) {
            settled = true;
            resolve();
          }
        })
        .catch((err) => {
          if (!settled) {
            settled = true;
            try { proc.kill(); } catch { /* noop */ }
            reject(err);
          }
        });
    });
  }

  private startIdleWatchdog(): void {
    if (this.idleTimer) return;
    const idleTimeout = this.opts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.idleTimer = setInterval(() => {
      if (!this.proc) return;
      if (this.busyCount > 0) return;
      if (Date.now() - this.lastUsedAt >= idleTimeout) {
        console.log(`[Sidecar] Idle for ${Math.round(idleTimeout / 60000)}min — shutting down to free RAM`);
        this.stop();
      }
    }, IDLE_CHECK_INTERVAL_MS);
    // Don't keep the app alive just for this timer
    this.idleTimer.unref?.();
  }
}

// --- helpers ---

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        const { port } = address;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('Failed to allocate port')));
      }
    });
  });
}

async function waitForHttp(port: number, proc: ChildProcess, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null || proc.signalCode !== null) {
      throw new Error('whisper-server process exited during startup');
    }
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 1000);
      // Any HTTP response (even 404) means the server is accepting requests
      await fetch(`http://127.0.0.1:${port}/`, { signal: controller.signal });
      clearTimeout(t);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, SERVER_POLL_INTERVAL_MS));
    }
  }
  throw new Error(`whisper-server did not become ready within ${timeoutMs}ms`);
}

interface MultipartField {
  name: string;
  data: Buffer;
  filename?: string;
  contentType?: string;
}

function buildMultipart(fields: MultipartField[]): { boundary: string; body: Buffer } {
  const boundary = `----voicepaste-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const parts: Buffer[] = [];

  for (const field of fields) {
    const headers = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="${field.name}"${field.filename ? `; filename="${field.filename}"` : ''}`,
      ...(field.contentType ? [`Content-Type: ${field.contentType}`] : []),
      '',
      '',
    ].join('\r\n');
    parts.push(Buffer.from(headers, 'utf8'), field.data, Buffer.from('\r\n', 'utf8'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));

  return { boundary, body: Buffer.concat(parts) };
}
