/**
 * Small PCM helpers for the local transcription engine.
 * Kept free of Electron imports so they can be unit-tested in plain Node.
 */

/** Root-mean-square level of a PCM16 block, normalized to 0..1. */
export function pcm16Rms(samples: Int16Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] / 32768;
    sum += v * v;
  }
  return Math.sqrt(sum / samples.length);
}

/**
 * Linear-interpolation resampler. Good enough for speech (24 kHz -> 16 kHz).
 */
export function resamplePcm16(input: Int16Array, fromRate: number, toRate: number): Int16Array {
  if (fromRate === toRate || input.length === 0) {
    return input;
  }
  const ratio = fromRate / toRate;
  const outLength = Math.max(1, Math.floor(input.length / ratio));
  const out = new Int16Array(outLength);

  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = input[idx];
    const b = idx + 1 < input.length ? input[idx + 1] : a;
    out[i] = (a + (b - a) * frac) | 0;
  }
  return out;
}

/** Encode mono PCM16 samples as a WAV file buffer. */
export function encodeWavPcm16(samples: Int16Array, sampleRate: number): Buffer {
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16); // fmt chunk size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < samples.length; i++) {
    buffer.writeInt16LE(samples[i], 44 + i * 2);
  }
  return buffer;
}

/** Convert an IPC Buffer (little-endian PCM16 bytes) into an aligned Int16Array copy. */
export function bufferToPcm16(buf: Buffer): Int16Array {
  const sampleCount = buf.byteLength >> 1;
  const out = new Int16Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    out[i] = buf.readInt16LE(i * 2);
  }
  return out;
}
