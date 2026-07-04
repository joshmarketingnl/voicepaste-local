import React, { useEffect, useState } from 'react';
import type {
  LocalModelId,
  LocalModelProgress,
  LocalModelStatusResult,
  TranscriptionEngineKind,
} from '../../shared/types';

interface AudioDevice {
  deviceId: string;
  label: string;
}

const SettingsPage: React.FC = () => {
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [enablePolish, setEnablePolish] = useState(true);
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [engine, setEngine] = useState<TranscriptionEngineKind>('local');
  const [localModel, setLocalModel] = useState<LocalModelId>('large-v3-turbo-q5_0');
  const [modelStatus, setModelStatus] = useState<LocalModelStatusResult | null>(null);
  const [downloadingId, setDownloadingId] = useState<LocalModelId | null>(null);
  const [downloadPct, setDownloadPct] = useState<number | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const refreshDevices = async () => {
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = allDevices
        .filter((d) => d.kind === 'audioinput')
        .map((d) => ({
          deviceId: d.deviceId,
          label: d.label || `Microphone (${d.deviceId.slice(0, 8)}...)`,
        }));
      setDevices(audioInputs);
    } catch (err) {
      console.error('[Settings] Failed to enumerate devices:', err);
    }
  };

  const refreshModelStatus = async () => {
    try {
      const status = await window.electronAPI.localModelStatus();
      setModelStatus(status);
    } catch (err) {
      console.error('[Settings] Failed to load local model status:', err);
    }
  };

  // Load saved settings + device list on mount
  useEffect(() => {
    window.electronAPI.getSettings().then((settings) => {
      setSelectedDeviceId(settings.audioInputDeviceId);
      setEnablePolish(settings.enablePolish);
      setApiKey(settings.openaiApiKey || '');
      setEngine(settings.transcriptionEngine || 'local');
      setLocalModel(settings.localModel || 'large-v3-turbo-q5_0');
    });
    refreshDevices();
    refreshModelStatus();
  }, []);

  // Refresh device list on hot-plug
  useEffect(() => {
    navigator.mediaDevices.addEventListener('devicechange', refreshDevices);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', refreshDevices);
    };
  }, []);

  // Model download progress
  useEffect(() => {
    const dispose = window.electronAPI.onLocalModelProgress((progress: LocalModelProgress) => {
      if (progress.id === 'vad') return; // tiny helper model, not worth a progress bar
      if (progress.error) {
        setDownloadError(progress.error);
        setDownloadingId(null);
        setDownloadPct(null);
        return;
      }
      if (progress.done) {
        setDownloadingId(null);
        setDownloadPct(null);
        refreshModelStatus();
        return;
      }
      if (progress.totalBytes > 0) {
        setDownloadPct(Math.min(100, Math.round((progress.receivedBytes / progress.totalBytes) * 100)));
      }
    });
    return dispose;
  }, []);

  const handleDeviceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    setSelectedDeviceId(value);
    window.electronAPI.setSettings({ audioInputDeviceId: value });
  };

  const handlePolishToggle = () => {
    const newValue = !enablePolish;
    setEnablePolish(newValue);
    window.electronAPI.setSettings({ enablePolish: newValue });
  };

  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setApiKey(value);
    window.electronAPI.setSettings({ openaiApiKey: value });
  };

  const handleEngineChange = (value: TranscriptionEngineKind) => {
    setEngine(value);
    window.electronAPI.setSettings({ transcriptionEngine: value });
  };

  const handleLocalModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value as LocalModelId;
    setLocalModel(value);
    window.electronAPI.setSettings({ localModel: value });
  };

  const handleDownload = async (id: LocalModelId) => {
    setDownloadError(null);
    setDownloadingId(id);
    setDownloadPct(0);
    const result = await window.electronAPI.localModelDownload(id);
    if (!result.success) {
      setDownloadError(result.error || 'Download failed');
      setDownloadingId(null);
      setDownloadPct(null);
    }
    refreshModelStatus();
  };

  const handleDeleteModel = async (id: LocalModelId) => {
    await window.electronAPI.localModelDelete(id);
    refreshModelStatus();
  };

  const selectedModelInfo = modelStatus?.models.find((m) => m.id === localModel);
  const recommendedInfo = modelStatus?.models.find((m) => m.id === modelStatus.recommended);

  return (
    <div className="flex flex-1 flex-col p-[48px]">
      <h1 className="font-heading text-[28px] font-normal tracking-[-0.5px] text-[var(--text-primary)] mb-[32px]">
        Settings
      </h1>

      {/* Transcription engine row */}
      <div className="flex flex-col gap-[16px] py-[24px]">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-[4px]">
            <span className="text-[14px] font-semibold font-sans text-[var(--text-primary)]">
              Transcription Engine
            </span>
            <span className="text-[12px] font-sans text-[var(--text-tertiary)]">
              {engine === 'local'
                ? 'Local: audio never leaves your machine, free, works offline'
                : 'OpenAI API: cloud transcription, requires an API key'}
            </span>
          </div>
          <div className="flex rounded-[8px] border border-[#d4d2cc] bg-white p-[2px]">
            <button
              onClick={() => handleEngineChange('local')}
              className={`h-[34px] rounded-[6px] px-[14px] text-[13px] font-sans font-semibold transition-colors ${
                engine === 'local' ? 'bg-[var(--accent-orange)] text-white' : 'text-[var(--text-secondary)]'
              }`}
            >
              Local (private, free)
            </button>
            <button
              onClick={() => handleEngineChange('openai')}
              className={`h-[34px] rounded-[6px] px-[14px] text-[13px] font-sans font-semibold transition-colors ${
                engine === 'openai' ? 'bg-[var(--accent-orange)] text-white' : 'text-[var(--text-secondary)]'
              }`}
            >
              OpenAI API
            </button>
          </div>
        </div>

        {/* Local engine details */}
        {engine === 'local' && (
          <div className="flex flex-col gap-[12px] rounded-[12px] border border-[var(--border-light)] bg-[rgba(0,0,0,0.02)] p-[16px]">
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-[2px]">
                <span className="text-[13px] font-semibold font-sans text-[var(--text-primary)]">
                  Speech model
                </span>
                {recommendedInfo && (
                  <span className="text-[11px] font-sans text-[var(--text-tertiary)]">
                    Recommended for this machine: {recommendedInfo.label}
                  </span>
                )}
              </div>
              <select
                value={localModel}
                onChange={handleLocalModelChange}
                className="h-[36px] min-w-[220px] max-w-[340px] rounded-[8px] border border-[#d4d2cc] bg-white px-[10px] text-[13px] font-sans text-[var(--text-primary)] outline-none focus:border-[#3b5bfe]"
              >
                {(modelStatus?.models ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} — {m.fileSizeMB} MB{m.installed ? ' ✓' : ''}
                  </option>
                ))}
              </select>
            </div>

            {selectedModelInfo && (
              <span className="text-[12px] font-sans text-[var(--text-tertiary)]">
                {selectedModelInfo.description}
              </span>
            )}

            {/* Install state / download */}
            {selectedModelInfo && !selectedModelInfo.installed && downloadingId !== localModel && (
              <div className="flex items-center gap-[12px]">
                <button
                  onClick={() => handleDownload(localModel)}
                  className="h-[36px] rounded-[8px] bg-[var(--accent-orange)] px-[16px] text-[13px] font-sans font-semibold text-white"
                >
                  Download model ({selectedModelInfo.fileSizeMB} MB)
                </button>
                <span className="text-[12px] font-sans text-[var(--text-tertiary)]">
                  One-time download, stored locally
                </span>
              </div>
            )}

            {downloadingId === localModel && (
              <div className="flex items-center gap-[12px]">
                <div className="h-[8px] w-[240px] overflow-hidden rounded-full bg-[#e4e2dc]">
                  <div
                    className="h-full rounded-full bg-[var(--accent-orange)] transition-all"
                    style={{ width: `${downloadPct ?? 2}%` }}
                  />
                </div>
                <span className="text-[12px] font-sans text-[var(--text-secondary)]">
                  {downloadPct !== null ? `${downloadPct}%` : 'Starting…'}
                </span>
              </div>
            )}

            {selectedModelInfo?.installed && (
              <div className="flex items-center gap-[12px]">
                <span className="text-[12px] font-sans font-semibold text-[#1a7f37]">✓ Installed</span>
                <button
                  onClick={() => handleDeleteModel(localModel)}
                  className="text-[12px] font-sans text-[var(--text-tertiary)] underline"
                >
                  Delete model
                </button>
              </div>
            )}

            {downloadError && (
              <span className="text-[12px] font-sans text-[#c0392b]">{downloadError}</span>
            )}

            {modelStatus && !modelStatus.sidecarAvailable && (
              <span className="text-[12px] font-sans text-[#c0392b]">
                Local engine binary missing for this platform. In development, run <code>npm run sidecar:download</code> first.
              </span>
            )}
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="h-[1px] w-full bg-[var(--border-light)]" />

      {/* API Key row */}
      <div className="flex items-center justify-between py-[24px]">
        <div className="flex flex-col gap-[4px]">
          <span className="text-[14px] font-semibold font-sans text-[var(--text-primary)]">
            OpenAI API Key
          </span>
          <span className="text-[12px] font-sans text-[var(--text-tertiary)]">
            {engine === 'local'
              ? 'Optional: only used for AI polish (and the OpenAI engine). Leave empty for fully offline use.'
              : 'Required for transcription and polish. Get one at platform.openai.com'}
          </span>
        </div>
        <div className="flex items-center gap-[8px]">
          <input
            type={showApiKey ? 'text' : 'password'}
            value={apiKey}
            onChange={handleApiKeyChange}
            placeholder="sk-..."
            className="h-[40px] w-[300px] rounded-[8px] border border-[#d4d2cc] bg-white px-[12px] text-[14px] font-sans text-[var(--text-primary)] outline-none focus:border-[#3b5bfe] font-mono"
          />
          <button
            onClick={() => setShowApiKey(!showApiKey)}
            className="flex h-[40px] w-[40px] items-center justify-center rounded-[8px] border border-[#d4d2cc] bg-white text-[14px]"
          >
            {showApiKey ? '🙈' : '👁'}
          </button>
        </div>
      </div>

      {/* Divider */}
      <div className="h-[1px] w-full bg-[var(--border-light)]" />

      {/* Microphone row */}
      <div className="flex items-center justify-between py-[24px]">
        <span className="text-[14px] font-semibold font-sans text-[var(--text-primary)]">
          Microphone
        </span>
        <select
          value={selectedDeviceId}
          onChange={handleDeviceChange}
          className="h-[40px] min-w-[200px] max-w-[320px] rounded-[8px] border border-[#d4d2cc] bg-white px-[12px] text-[14px] font-sans text-[var(--text-primary)] outline-none focus:border-[#3b5bfe]"
        >
          <option value="">System Default</option>
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
            </option>
          ))}
        </select>
      </div>

      {/* Divider */}
      <div className="h-[1px] w-full bg-[var(--border-light)]" />

      {/* Output mode row */}
      <div className="flex items-center justify-between py-[24px]">
        <div className="flex flex-col gap-[4px]">
          <span className="text-[14px] font-semibold font-sans text-[var(--text-primary)]">
            Output Mode
          </span>
          <span className="text-[12px] font-sans text-[var(--text-tertiary)]">
            {enablePolish
              ? 'Polish mode: AI cleans up transcription before output (uses OpenAI API)'
              : 'Fast mode: raw transcription output, no AI processing — fully offline with the local engine'}
          </span>
        </div>
        <button
          onClick={handlePolishToggle}
          className={`relative h-[28px] w-[52px] shrink-0 rounded-full transition-colors ${
            enablePolish ? 'bg-[var(--accent-orange)]' : 'bg-[#d4d2cc]'
          }`}
        >
          <span
            className={`absolute top-[2px] h-[24px] w-[24px] rounded-full bg-white shadow transition-transform ${
              enablePolish ? 'left-[26px]' : 'left-[2px]'
            }`}
          />
        </button>
      </div>

      {/* Divider */}
      <div className="h-[1px] w-full bg-[var(--border-light)]" />
    </div>
  );
};

export default SettingsPage;
