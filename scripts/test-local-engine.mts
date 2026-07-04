/**
 * Standalone smoke test for the local transcription engine (no Electron needed).
 *
 * Feeds a 24 kHz mono PCM16 WAV file through LocalWhisperEngine exactly like
 * the renderer does at runtime (2400-sample / 100 ms chunks), then prints the
 * final transcript and diagnostics.
 *
 * Usage:
 *   npx tsx scripts/test-local-engine.mts \
 *     --binary resources/sidecar/win32-x64/whisper-server.exe \
 *     --model  path/to/ggml-base-q5_1.bin \
 *     [--vad   path/to/ggml-silero-v5.1.2.bin] \
 *     --wav    path/to/test-24k.wav
 */
import { readFileSync } from 'fs';
import { LocalWhisperEngine } from '../src/main/local-whisper-engine';
import { SidecarManager } from '../src/main/sidecar-manager';

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

const binaryPath = arg('binary');
const modelPath = arg('model');
const vadPath = arg('vad');
const wavPath = arg('wav');

if (!binaryPath || !modelPath || !wavPath) {
  console.error('Missing required args: --binary, --model, --wav');
  process.exit(1);
}

// Minimal WAV reader: assumes PCM16 mono (as produced for the test)
function readWavPcm16(filePath: string): { samples: Int16Array; sampleRate: number } {
  const buf = readFileSync(filePath);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Not a WAV file');
  }
  let offset = 12;
  let sampleRate = 0;
  let dataOffset = -1;
  let dataSize = 0;
  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    if (chunkId === 'fmt ') {
      sampleRate = buf.readUInt32LE(offset + 12);
      const channels = buf.readUInt16LE(offset + 10);
      const bits = buf.readUInt16LE(offset + 22);
      if (channels !== 1 || bits !== 16) throw new Error(`Expected mono PCM16, got ch=${channels} bits=${bits}`);
    } else if (chunkId === 'data') {
      dataOffset = offset + 8;
      dataSize = chunkSize;
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  if (dataOffset < 0) throw new Error('No data chunk');
  const samples = new Int16Array(dataSize / 2);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = buf.readInt16LE(dataOffset + i * 2);
  }
  return { samples, sampleRate };
}

const { samples, sampleRate } = readWavPcm16(wavPath);
console.log(`WAV: ${samples.length} samples @ ${sampleRate} Hz (${(samples.length / sampleRate).toFixed(1)}s)`);

const sidecar = new SidecarManager({
  binaryPath,
  modelPath,
  vadModelPath: vadPath ?? null,
  idleTimeoutMs: 60_000,
});

const engine = new LocalWhisperEngine({
  sidecar,
  inputSampleRate: sampleRate,
});

engine.on('speech_started', () => console.log('>> event: speech_started'));
engine.on('speech_stopped', () => console.log('>> event: speech_stopped'));
engine.on('utterance', (text: string) => console.log(`>> utterance: "${text}"`));

const t0 = Date.now();
await engine.connect();

// Feed in 100ms chunks like the real renderer (2400 samples @ 24kHz)
const chunkSamples = Math.round(sampleRate / 10);
for (let pos = 0; pos < samples.length; pos += chunkSamples) {
  const slice = samples.subarray(pos, Math.min(pos + chunkSamples, samples.length));
  const buf = Buffer.alloc(slice.length * 2);
  for (let i = 0; i < slice.length; i++) buf.writeInt16LE(slice[i], i * 2);
  engine.sendAudioChunk(buf);
}
// Trailing silence so the hangover-based segmenter can close the last utterance
const silence = Buffer.alloc(chunkSamples * 2);
for (let i = 0; i < 12; i++) engine.sendAudioChunk(silence);

const text = await engine.stop();
const elapsed = Date.now() - t0;

console.log('\n=== RESULT ===');
console.log(`Transcript: "${text}"`);
console.log(`Total time (incl. model load): ${elapsed}ms`);
console.log('Debug:', JSON.stringify(engine.getDebugSnapshot(), null, 2).slice(0, 1200));

sidecar.dispose();
engine.disconnect();

if (!text.trim()) {
  console.error('\nFAIL: empty transcript');
  process.exit(1);
}
console.log('\nPASS');
process.exit(0);
