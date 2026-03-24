import { useState, useEffect } from 'react';
import { BrainCircuit, ExternalLink, Terminal, Check, Loader, RotateCw } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';

const TABS = ['Overview', 'Claude Code', 'Settings'] as const;
type Tab = typeof TABS[number];

const LLM_PROVIDERS = ['mock', 'openai', 'anthropic', 'groq', 'ollama', 'gemini', 'lmstudio', 'openai-codex'] as const;
const NO_KEY_PROVIDERS = new Set(['mock', 'ollama', 'lmstudio', 'openai-codex']);

interface MemoryConfig {
  hindsightEnabled: boolean;
  llmProvider: string;
  llmApiKey: string;
  llmModel: string;
  retainChunkChars: number;
  observationsEnabled: boolean;
}

type AsyncState = 'idle' | 'loading' | 'ok' | 'error';

interface MemoryDialogProps {
  onClose: () => void;
}

export default function MemoryDialog({ onClose }: MemoryDialogProps) {
  const [tab, setTab] = useState<Tab>('Overview');
  const [mcpState, setMcpState] = useState<AsyncState>('idle');
  const [mcpError, setMcpError] = useState('');

  const [cfg, setCfg] = useState<MemoryConfig | null>(null);
  const [restartState, setRestartState] = useState<AsyncState>('idle');
  const [restartError, setRestartError] = useState('');

  useEffect(() => {
    fetch('/api/memory/config')
      .then(r => r.json())
      .then(setCfg)
      .catch(() => {});
  }, []);

  async function openControlPlane() {
    const res = await fetch('/api/memory/ui', { method: 'POST' });
    const { active, url } = await res.json();
    if (active && url) window.open(url, '_blank');
  }

  async function setupClaudeCode() {
    setMcpState('loading');
    setMcpError('');
    try {
      const res = await fetch('/api/memory/mcp-setup', { method: 'POST' });
      const { ok, error } = await res.json();
      if (ok) { setMcpState('ok'); }
      else { setMcpState('error'); setMcpError(error || 'Unknown error'); }
    } catch {
      setMcpState('error'); setMcpError('Request failed');
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

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="w-[90vw] max-w-[480px] flex flex-col gap-0 p-0">
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
                'px-4 py-2 text-xs border-b-2 transition-colors bg-transparent cursor-pointer',
                tab === t
                  ? 'font-semibold text-foreground border-primary'
                  : 'font-normal text-muted-foreground border-transparent hover:text-foreground',
              ].join(' ')}
            >
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
              <ul className="text-xs text-muted-foreground leading-loose list-disc pl-4">
                <li>Terminal output is chunked and retained automatically</li>
                <li>Memories are tagged by working directory and hostname</li>
                <li>No LLM required &mdash; extraction runs locally</li>
              </ul>
              <Button
                variant="outline"
                size="sm"
                className="self-start flex items-center gap-2 mt-1"
                onClick={openControlPlane}
              >
                <ExternalLink size={13} />
                Open Control Plane
              </Button>
            </>
          )}

          {tab === 'Claude Code' && (
            <>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Register vipershell&apos;s memory as an MCP server in Claude Code. Once added,
                Claude can recall terminal history from any repo using the{' '}
                <code className="text-xs px-1 py-0.5 rounded bg-muted">recall</code>
                {' '}and{' '}
                <code className="text-xs px-1 py-0.5 rounded bg-muted">reflect</code>
                {' '}tools.
              </p>
              <code className="text-xs text-muted-foreground bg-muted rounded px-3 py-2.5 break-all leading-relaxed">
                claude mcp add --scope user --transport http hindsight{' '}
                {window.location.origin}/api/hindsight/mcp/
              </code>
              {mcpState === 'error' && (
                <p className="text-xs text-destructive">{mcpError}</p>
              )}
              <Button
                size="sm"
                className="self-start flex items-center gap-2"
                onClick={setupClaudeCode}
                disabled={mcpState === 'loading' || mcpState === 'ok'}
              >
                {mcpState === 'loading' && <Loader size={13} className="animate-spin" />}
                {mcpState === 'ok' && <Check size={13} />}
                {mcpState === 'idle' && <Terminal size={13} />}
                {mcpState === 'loading' ? 'Setting up\u2026'
                  : mcpState === 'ok' ? 'Added to Claude Code'
                  : 'Add to Claude Code'}
              </Button>
            </>
          )}

          {tab === 'Settings' && (
            <>
              {!cfg ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader size={13} className="animate-spin" /> Loading\u2026
                </div>
              ) : (
                <>
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
                          placeholder="sk-\u2026"
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

                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-foreground">Retain chunk size <span className="text-muted-foreground font-normal">(chars)</span></label>
                      <input
                        type="number"
                        min={200}
                        max={20000}
                        value={cfg.retainChunkChars}
                        onChange={e => setCfg({ ...cfg, retainChunkChars: parseInt(e.target.value) || 3000 })}
                        className="text-xs px-2 py-1.5 rounded border border-border bg-background text-foreground w-28"
                      />
                    </div>

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
                  </div>

                  {restartState === 'error' && (
                    <p className="text-xs text-destructive">{restartError}</p>
                  )}

                  <Button
                    size="sm"
                    className="self-start flex items-center gap-2 mt-1"
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
                </>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
