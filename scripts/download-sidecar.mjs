#!/usr/bin/env node
/**
 * Fetches (Windows) or builds (macOS/Linux) the whisper.cpp `whisper-server`
 * sidecar binary for the current platform into resources/sidecar/<platform-arch>/.
 *
 * Usage: npm run sidecar:download
 */
import { execSync } from 'child_process';
import { createWriteStream, existsSync, mkdirSync, readdirSync, copyFileSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const WHISPER_CPP_VERSION = 'v1.9.1';
const WIN_X64_ZIP_URL = `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_CPP_VERSION}/whisper-bin-x64.zip`;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const platformKey = `${process.platform}-${process.arch}`;
const targetDir = path.join(repoRoot, 'resources', 'sidecar', platformKey);

async function downloadFile(url, dest) {
  console.log(`Downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed: HTTP ${response.status}`);
  }
  const stream = createWriteStream(dest);
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    await new Promise((resolve, reject) => {
      stream.write(Buffer.from(value), (err) => (err ? reject(err) : resolve()));
    });
  }
  await new Promise((resolve, reject) => stream.end((err) => (err ? reject(err) : resolve())));
}

async function setupWindows() {
  const tmpDir = path.join(os.tmpdir(), `voicepaste-sidecar-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  const zipPath = path.join(tmpDir, 'whisper-bin-x64.zip');
  await downloadFile(WIN_X64_ZIP_URL, zipPath);

  console.log('Extracting…');
  execSync(
    `powershell -NoProfile -Command "Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${tmpDir}' -Force"`,
    { stdio: 'inherit' },
  );

  // The zip contains Release/whisper-server.exe plus required DLLs
  const releaseDir = path.join(tmpDir, 'Release');
  const sourceDir = existsSync(releaseDir) ? releaseDir : tmpDir;
  const wanted = readdirSync(sourceDir).filter((name) =>
    name === 'whisper-server.exe' || name === 'whisper.dll' || /^ggml.*\.dll$/i.test(name),
  );
  if (!wanted.includes('whisper-server.exe')) {
    throw new Error(`whisper-server.exe not found in ${sourceDir}`);
  }

  mkdirSync(targetDir, { recursive: true });
  for (const name of wanted) {
    copyFileSync(path.join(sourceDir, name), path.join(targetDir, name));
    console.log(`  -> ${path.join(targetDir, name)}`);
  }
  rmSync(tmpDir, { recursive: true, force: true });
}

function setupUnixBuild() {
  // macOS (incl. Metal) and Linux: build from source at the pinned version.
  const tmpDir = path.join(os.tmpdir(), `voicepaste-whispercpp-${Date.now()}`);
  console.log(`Building whisper.cpp ${WHISPER_CPP_VERSION} from source in ${tmpDir}`);
  execSync(`git clone --depth 1 --branch ${WHISPER_CPP_VERSION} https://github.com/ggml-org/whisper.cpp "${tmpDir}"`, { stdio: 'inherit' });
  execSync('cmake -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_EXAMPLES=ON', {
    cwd: tmpDir,
    stdio: 'inherit',
  });
  execSync('cmake --build build --config Release -j --target whisper-server', {
    cwd: tmpDir,
    stdio: 'inherit',
  });

  const built = path.join(tmpDir, 'build', 'bin', 'whisper-server');
  if (!existsSync(built)) {
    throw new Error(`Build finished but ${built} is missing`);
  }
  mkdirSync(targetDir, { recursive: true });
  copyFileSync(built, path.join(targetDir, 'whisper-server'));
  execSync(`chmod +x "${path.join(targetDir, 'whisper-server')}"`);
  console.log(`  -> ${path.join(targetDir, 'whisper-server')}`);
  rmSync(tmpDir, { recursive: true, force: true });
}

try {
  if (process.platform === 'win32' && process.arch === 'x64') {
    await setupWindows();
  } else if (process.platform === 'darwin' || process.platform === 'linux') {
    setupUnixBuild();
  } else {
    throw new Error(`Unsupported platform: ${platformKey}`);
  }
  console.log(`\nSidecar ready in resources/sidecar/${platformKey}/`);
} catch (error) {
  console.error(`\nSidecar setup failed: ${error.message}`);
  process.exit(1);
}
