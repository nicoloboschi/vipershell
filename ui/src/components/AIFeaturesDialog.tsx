import { useState, useEffect } from 'react';
import { Sparkles, Check, Loader, RotateCw, Tag } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';

type AIProvider = 'claude-code' | 'codex';

interface AIConfig {
  aiEnabled: boolean;
  aiProvider: AIProvider;
  autoNaming: boolean;
}

type AsyncState = 'idle' | 'loading' | 'ok' | 'error';

interface AIFeaturesDialogProps {
  onClose: () => void;
}

export default function AIFeaturesDialog({ onClose }: AIFeaturesDialogProps) {
  const [cfg, setCfg] = useState<AIConfig | null>(null);
  const [saveState, setSaveState] = useState<AsyncState>('idle');
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    fetch('/api/ai/config')
      .then(r => r.json())
      .then(setCfg)
      .catch(() => {});
  }, []);

  async function save() {
    if (!cfg) return;
    setSaveState('loading');
    setSaveError('');
    try {
      const res = await fetch('/api/ai/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      });
      const data = await res.json();
      if (!data.ok) { setSaveState('error'); setSaveError(data.error || 'Save failed'); return; }
      setSaveState('ok');
      setTimeout(() => setSaveState('idle'), 2000);
    } catch (e) {
      setSaveState('error'); setSaveError(`Request failed: ${e}`);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="w-[90vw] max-w-[480px] flex flex-col gap-0 p-0">
        <DialogHeader className="px-5 py-4 border-b border-border">
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles size={15} className="text-primary" />
            AI Features
          </DialogTitle>
        </DialogHeader>

        <div className="p-5 flex flex-col gap-4 min-h-[180px]">
          {!cfg ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader size={13} className="animate-spin" /> Loading&hellip;
            </div>
          ) : (
            <>
              {/* Enable AI */}
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={cfg.aiEnabled}
                  onChange={e => setCfg({ ...cfg, aiEnabled: e.target.checked })}
                  className="rounded"
                />
                <span className="text-xs font-medium text-foreground">Enable AI features</span>
              </label>

              {cfg.aiEnabled && (
                <>
                  {/* Provider */}
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-foreground">Provider</label>
                    <select
                      value={cfg.aiProvider}
                      onChange={e => setCfg({ ...cfg, aiProvider: e.target.value as AIProvider })}
                      className="text-xs px-2 py-1.5 rounded border border-border bg-background text-foreground w-48"
                    >
                      <option value="claude-code">Claude Code (claude CLI)</option>
                      <option value="codex">Codex (codex CLI)</option>
                    </select>
                    <p className="text-xs text-muted-foreground">
                      Uses the local <code className="bg-muted px-1 rounded">{cfg.aiProvider === 'claude-code' ? 'claude' : 'codex'}</code> CLI for one-shot prompts.
                    </p>
                  </div>

                  {/* Divider */}
                  <div className="border-t border-border" />

                  {/* Auto-naming */}
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <Tag size={13} className="text-muted-foreground" />
                      <span className="text-xs font-semibold text-foreground">Auto-naming</span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Periodically reads terminal output and asks the AI to generate a short,
                      descriptive name for each session (with an emoji).
                    </p>

                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={cfg.autoNaming}
                        onChange={e => setCfg({ ...cfg, autoNaming: e.target.checked })}
                        className="rounded"
                      />
                      <span className="text-xs font-medium text-foreground">Enable auto-naming</span>
                    </label>
                  </div>
                </>
              )}

              {/* Save */}
              {saveState === 'error' && (
                <p className="text-xs text-destructive">{saveError}</p>
              )}

              <Button
                size="sm"
                className="self-start flex items-center gap-2 mt-1"
                onClick={save}
                disabled={saveState === 'loading'}
              >
                {saveState === 'loading' && <Loader size={13} className="animate-spin" />}
                {saveState === 'ok' && <Check size={13} />}
                {(saveState === 'idle' || saveState === 'error') && <RotateCw size={13} />}
                {saveState === 'loading' ? 'Saving\u2026'
                  : saveState === 'ok' ? 'Saved'
                  : 'Save & Apply'}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
