import { useState, useEffect } from 'react';
import { BrainCircuit, ExternalLink, Check, Loader, RotateCw, Copy, Power, PowerOff, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import ClaudeIcon from './ClaudeIcon';

const TABS = ['Overview', 'Claude Code'] as const;
type Tab = typeof TABS[number];

const LLM_PROVIDERS = ['mock', 'openai', 'anthropic', 'groq', 'ollama', 'gemini', 'lmstudio', 'openai-codex'] as const;
const NO_KEY_PROVIDERS = new Set(['mock', 'ollama', 'lmstudio', 'openai-codex']);

type HindsightMode = 'embedded' | 'external';

interface MemoryConfig {
  hindsightEnabled: boolean;
  hindsightMode: HindsightMode;
  hindsightApiUrl: string;
  hindsightApiToken: string;
  llmProvider: string;
  llmApiKey: string;
  llmModel: string;
  retainChunkChars: number;
  observationsEnabled: boolean;
  active?: boolean;
  mode?: string;
}

type AsyncState = 'idle' | 'loading' | 'ok' | 'error';

interface MemoryDialogProps {
  onClose: () => void;
}

export default function MemoryDialog({ onClose }: MemoryDialogProps) {
  const [tab, setTab] = useState<Tab>('Overview');

  const [cfg, setCfg] = useState<MemoryConfig | null>(null);
  const [restartState, setRestartState] = useState<AsyncState>('idle');
  const [restartError, setRestartError] = useState('');

  // Claude Code setup state
  const [ccState, setCcState] = useState<AsyncState>('idle');
  const [ccError, setCcError] = useState('');
  const [copied, setCopied] = useState(false);
  const [ccStatus, setCcStatus] = useState<{
    pluginInstalled: boolean;
    pluginEnabled: boolean;
    configExists: boolean;
    configUrl: string;
  } | null>(null);

  useEffect(() => {
    fetch('/api/memory/config')
      .then(r => r.json())
      .then(setCfg)
      .catch(() => {});
    fetch('/api/memory/claude-code-status')
      .then(r => r.json())
      .then(setCcStatus)
      .catch(() => {});
  }, []);

  const [cpError, setCpError] = useState('');

  async function openControlPlane() {
    setCpError('');
    try {
      const res = await fetch('/api/memory/ui', { method: 'POST' });
      const { active, url } = await res.json();
      if (active && url) {
        window.open(url, '_blank');
      } else {
        setCpError('Hindsight is not active yet. Enable it and wait for it to start.');
      }
    } catch {
      setCpError('Failed to start control plane.');
    }
  }

  async function saveAndRestart() {
    setRestartState('loading');
    setRestartError('');
    try {
      const res = await fetch('/api/memory/restart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      });
      const { ok, error } = await res.json();
      if (!ok) { setRestartState('error'); setRestartError(error || 'Save failed'); return; }
      setRestartState('ok');
      setTimeout(() => setRestartState('idle'), 2000);
    } catch {
      setRestartState('error'); setRestartError('Request failed');
    }
  }

  async function setupClaudeCode() {
    setCcState('loading');
    setCcError('');
    try {
      const res = await fetch('/api/memory/claude-code-setup', { method: 'POST' });
      const { ok, error } = await res.json();
      if (ok) {
        setCcState('ok');
        fetch('/api/memory/claude-code-status').then(r => r.json()).then(setCcStatus).catch(() => {});
      }
      else { setCcState('error'); setCcError(error || 'Unknown error'); }
    } catch {
      setCcState('error'); setCcError('Request failed');
    }
  }

  const [actionState, setActionState] = useState<AsyncState>('idle');
  const [actionError, setActionError] = useState('');

  async function ccAction(endpoint: string) {
    setActionState('loading');
    setActionError('');
    try {
      const res = await fetch(`/api/memory/${endpoint}`, { method: 'POST' });
      const { ok, error } = await res.json();
      if (ok) {
        setActionState('ok');
        fetch('/api/memory/claude-code-status').then(r => r.json()).then(setCcStatus).catch(() => {});
        setTimeout(() => setActionState('idle'), 1500);
      } else {
        setActionState('error');
        setActionError(error || 'Unknown error');
      }
    } catch {
      setActionState('error');
      setActionError('Request failed');
    }
  }

  const manualCommands = `claude plugin marketplace add vectorize-io/hindsight\nclaude plugin install hindsight-memory\n\n# Then add to ~/.hindsight/claude-code.json:\n# { "hindsightApiUrl": "http://${window.location.host}/api/hindsight" }`;

  function copyCommand() {
    navigator.clipboard.writeText(manualCommands);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="w-[90vw] max-w-[520px] flex flex-col gap-0 p-0">
        <DialogHeader className="px-5 py-4 border-b border-border">
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            <BrainCircuit size={15} className="text-primary" />
            Memory
          </DialogTitle>
        </DialogHeader>

        <div className="flex border-b border-border">
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={[
                'px-4 py-2 text-xs border-b-2 transition-colors bg-transparent cursor-pointer flex items-center gap-1.5',
                tab === t
                  ? 'font-semibold text-foreground border-primary'
                  : 'font-normal text-muted-foreground border-transparent hover:text-foreground',
              ].join(' ')}
            >
              {t === 'Claude Code' && <ClaudeIcon size={12} />}
              {t}
            </button>
          ))}
        </div>

        <div className="p-5 flex flex-col gap-4 min-h-[220px]">
          {tab === 'Overview' && (
            <>
              <p className="text-sm text-muted-foreground leading-relaxed">
                vipershell passively captures terminal output and stores it in{' '}
                <strong className="text-foreground font-semibold">Hindsight</strong> &mdash; a long-term
                memory system. Every session is indexed by directory and host, so coding agents can
                recall what happened in a repo across sessions.
              </p>

              {cfg && (
                <div className="flex flex-col gap-1 text-xs">
                  <div className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full ${cfg.active ? 'bg-green-500' : 'bg-red-500'}`} />
                    <span className="text-muted-foreground">
                      {cfg.active ? `Active (${cfg.mode ?? cfg.hindsightMode})` : cfg.hindsightEnabled ? 'Starting\u2026' : 'Disabled'}
                    </span>
                  </div>
                </div>
              )}

              {/* Settings — inline */}
              {!cfg ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader size={13} className="animate-spin" /> Loading&hellip;
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={cfg.hindsightEnabled}
                      onChange={e => setCfg({ ...cfg, hindsightEnabled: e.target.checked })}
                      className="rounded"
                    />
                    <span className="text-xs font-medium text-foreground">Enable Hindsight</span>
                  </label>

                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-foreground">Mode</label>
                    <select
                      value={cfg.hindsightMode}
                      onChange={e => setCfg({ ...cfg, hindsightMode: e.target.value as HindsightMode })}
                      className="text-xs px-2 py-1.5 rounded border border-border bg-background text-foreground"
                    >
                      <option value="embedded">Embedded (local daemon)</option>
                      <option value="external">External API</option>
                    </select>
                    {cfg.hindsightMode === 'embedded' && (
                      <p className="text-xs text-muted-foreground">Automatically starts a local Hindsight daemon via <code className="bg-muted px-1 rounded">uvx</code>.</p>
                    )}
                  </div>

                  {cfg.hindsightMode === 'external' && (
                    <>
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-foreground">API URL</label>
                        <input
                          type="text"
                          value={cfg.hindsightApiUrl}
                          onChange={e => setCfg({ ...cfg, hindsightApiUrl: e.target.value })}
                          placeholder="https://hindsight.example.com"
                          className="text-xs px-2 py-1.5 rounded border border-border bg-background text-foreground placeholder:text-muted-foreground"
                        />
                      </div>

                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-foreground">API Token <span className="text-muted-foreground font-normal">(optional)</span></label>
                        <input
                          type="password"
                          value={cfg.hindsightApiToken}
                          onChange={e => setCfg({ ...cfg, hindsightApiToken: e.target.value })}
                          placeholder="Bearer token"
                          className="text-xs px-2 py-1.5 rounded border border-border bg-background text-foreground placeholder:text-muted-foreground"
                        />
                      </div>
                    </>
                  )}

                  {cfg.hindsightMode === 'embedded' && (
                    <>
                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-foreground">LLM Provider</label>
                        <select
                          value={cfg.llmProvider}
                          onChange={e => setCfg({ ...cfg, llmProvider: e.target.value })}
                          className="text-xs px-2 py-1.5 rounded border border-border bg-background text-foreground"
                        >
                          {LLM_PROVIDERS.map(p => (
                            <option key={p} value={p}>{p}</option>
                          ))}
                        </select>
                        {cfg.llmProvider === 'mock' && (
                          <p className="text-xs text-muted-foreground">Mock mode &mdash; no LLM calls, chunks stored as-is.</p>
                        )}
                        {cfg.llmProvider === 'openai-codex' && (
                          <p className="text-xs text-muted-foreground">Uses <code className="bg-muted px-1 rounded">~/.codex/auth.json</code> &mdash; run <code className="bg-muted px-1 rounded">codex auth login</code> first.</p>
                        )}
                      </div>

                      {!NO_KEY_PROVIDERS.has(cfg.llmProvider) && (
                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-medium text-foreground">API Key</label>
                          <input
                            type="password"
                            value={cfg.llmApiKey}
                            onChange={e => setCfg({ ...cfg, llmApiKey: e.target.value })}
                            placeholder="sk-&hellip;"
                            className="text-xs px-2 py-1.5 rounded border border-border bg-background text-foreground placeholder:text-muted-foreground"
                          />
                        </div>
                      )}

                      <div className="flex flex-col gap-1">
                        <label className="text-xs font-medium text-foreground">Model <span className="text-muted-foreground font-normal">(optional)</span></label>
                        <input
                          type="text"
                          value={cfg.llmModel}
                          onChange={e => setCfg({ ...cfg, llmModel: e.target.value })}
                          placeholder="default for provider"
                          className="text-xs px-2 py-1.5 rounded border border-border bg-background text-foreground placeholder:text-muted-foreground"
                        />
                      </div>
                    </>
                  )}

                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={cfg.observationsEnabled}
                      onChange={e => setCfg({ ...cfg, observationsEnabled: e.target.checked })}
                      className="rounded"
                    />
                    <span className="text-xs font-medium text-foreground">Enable observations</span>
                    <span className="text-xs text-muted-foreground">(requires LLM)</span>
                  </label>

                  {restartState === 'error' && (
                    <p className="text-xs text-destructive">{restartError}</p>
                  )}

                  <div className="flex items-center gap-2 mt-1">
                    <Button
                      size="sm"
                      className="flex items-center gap-2"
                      onClick={saveAndRestart}
                      disabled={restartState === 'loading'}
                    >
                      {restartState === 'loading' && <Loader size={13} className="animate-spin" />}
                      {restartState === 'ok' && <Check size={13} />}
                      {(restartState === 'idle' || restartState === 'error') && <RotateCw size={13} />}
                      {restartState === 'loading' ? 'Saving\u2026'
                        : restartState === 'ok' ? 'Saved'
                        : 'Save & Restart'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex items-center gap-2"
                      onClick={openControlPlane}
                    >
                      <ExternalLink size={13} />
                      Control Plane
                    </Button>
                  </div>
                  {cpError && <p className="text-xs text-destructive">{cpError}</p>}
                </div>
              )}
            </>
          )}

          {tab === 'Claude Code' && (
            <>
              <div className="flex items-center gap-3 mb-1">
                <div
                  className="flex items-center justify-center rounded-lg"
                  style={{ width: 40, height: 40, background: 'linear-gradient(135deg, #D4A574 0%, #CC785C 100%)' }}
                >
                  <ClaudeIcon size={22} className="text-white" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">Connect to Claude Code</p>
                  <p className="text-xs text-muted-foreground">Give Claude long-term memory of your terminal sessions</p>
                </div>
              </div>

              {/* Status */}
              {ccStatus && (
                <div className="rounded-md border border-border px-3 py-2.5 flex flex-col gap-1.5 text-xs">
                  <div className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ccStatus.pluginInstalled && ccStatus.pluginEnabled ? 'bg-green-500' : ccStatus.pluginInstalled ? 'bg-yellow-500' : 'bg-muted-foreground'}`} />
                    <span className="text-muted-foreground">
                      Plugin: {ccStatus.pluginInstalled ? (ccStatus.pluginEnabled ? <span className="text-green-500 font-medium">installed & enabled</span> : <span className="text-yellow-500 font-medium">installed (not enabled)</span>) : <span className="text-muted-foreground">not installed</span>}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ccStatus.configExists ? 'bg-green-500' : 'bg-muted-foreground'}`} />
                    <span className="text-muted-foreground">
                      Config: {ccStatus.configExists ? (
                        <>
                          <span className="text-green-500 font-medium">configured</span>
                          {ccStatus.configUrl && <span className="text-muted-foreground"> &rarr; <code className="text-[10px] bg-muted px-1 rounded">{ccStatus.configUrl}</code></span>}
                        </>
                      ) : <span className="text-muted-foreground">not configured</span>}
                    </span>
                  </div>
                </div>
              )}

              {ccStatus?.pluginInstalled && ccStatus?.configExists ? (
                <>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    The <strong className="text-foreground">Hindsight plugin</strong> is installed and configured.
                    Claude Code has long-term memory powered by vipershell&apos;s Hindsight.
                  </p>

                  {actionState === 'error' && (
                    <p className="text-xs text-destructive break-words">{actionError}</p>
                  )}

                  <div className="flex items-center gap-2">
                    {ccStatus.pluginEnabled ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex items-center gap-2"
                        onClick={() => ccAction('claude-code-disable')}
                        disabled={actionState === 'loading'}
                      >
                        {actionState === 'loading' ? <Loader size={13} className="animate-spin" /> : <PowerOff size={13} />}
                        Disable
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        className="flex items-center gap-2"
                        onClick={() => ccAction('claude-code-enable')}
                        disabled={actionState === 'loading'}
                      >
                        {actionState === 'loading' ? <Loader size={13} className="animate-spin" /> : <Power size={13} />}
                        Enable
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex items-center gap-2 text-destructive hover:text-destructive"
                      onClick={() => ccAction('claude-code-remove')}
                      disabled={actionState === 'loading'}
                    >
                      {actionState === 'loading' ? <Loader size={13} className="animate-spin" /> : <Trash2 size={13} />}
                      Remove
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Install the{' '}
                    <strong className="text-foreground">Hindsight plugin</strong> for Claude Code.
                    It automatically captures conversations and recalls relevant context &mdash;
                    Claude gains memory across all sessions powered by vipershell&apos;s Hindsight.
                  </p>

                  <div
                    className="rounded-lg border border-border p-4 flex flex-col gap-3"
                    style={{ background: 'var(--accent)' }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-foreground">Automatic setup</span>
                      {!cfg?.active && (
                        <span className="text-xs text-yellow-500">(requires Hindsight to be running)</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Installs the plugin and configures it to connect to this vipershell instance.
                    </p>
                    {ccState === 'error' && (
                      <p className="text-xs text-destructive break-words">{ccError}</p>
                    )}
                    <Button
                      size="sm"
                      className="self-start flex items-center gap-2"
                      onClick={setupClaudeCode}
                      disabled={ccState === 'loading' || ccState === 'ok' || !cfg?.active}
                    >
                      {ccState === 'loading' && <Loader size={13} className="animate-spin" />}
                      {ccState === 'ok' && <Check size={13} />}
                      {(ccState === 'idle' || ccState === 'error') && <ClaudeIcon size={13} />}
                      {ccState === 'loading' ? 'Installing\u2026'
                        : ccState === 'ok' ? 'Installed & configured'
                        : 'Install Hindsight Plugin'}
                    </Button>
                  </div>

                  <div className="flex flex-col gap-2">
                    <span className="text-xs font-semibold text-foreground">Or install manually</span>
                    <div className="relative group">
                      <pre
                        className="text-[10px] text-muted-foreground bg-muted rounded-md px-3 py-2.5 pr-9 leading-relaxed font-mono select-all whitespace-pre-wrap"
                      >{manualCommands}</pre>
                      <button
                        onClick={copyCommand}
                        className="absolute top-2 right-2 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-background/50"
                        title="Copy commands"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted-foreground)' }}
                      >
                        {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
