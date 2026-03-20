import { Check } from 'lucide-react';
import useStore from '../store.js';
import { themes, themeNames } from '../themes.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog.jsx';

/** Color swatches shown on each theme card — ordered for visual impact */
const SWATCH_KEYS = ['background', 'card', 'primary', 'accent', 'border', 'destructive'];

function ThemeCard({ name, active, onClick }) {
  const vars = themes[name];
  return (
    <button
      onClick={onClick}
      style={{
        background: vars.background,
        border: `2px solid ${active ? vars.ring : vars.border}`,
        borderRadius: vars.radius ?? '0.5rem',
        padding: '10px',
        cursor: 'pointer',
        textAlign: 'left',
        position: 'relative',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        boxShadow: active ? `0 0 0 2px ${vars.ring}` : 'none',
      }}
    >
      {/* Swatch row */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        {SWATCH_KEYS.map(key => (
          <div
            key={key}
            title={key}
            style={{
              flex: 1,
              height: 14,
              borderRadius: 3,
              background: vars[key] ?? 'transparent',
            }}
          />
        ))}
      </div>

      {/* Theme name + check */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
        <span style={{
          fontSize: 11,
          fontWeight: 600,
          color: vars.foreground,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {name}
        </span>
        {active && (
          <Check size={11} style={{ color: vars.primary, flexShrink: 0 }} />
        )}
      </div>
    </button>
  );
}

export default function ThemeDialog({ onClose }) {
  const theme = useStore(s => s.theme);
  const setTheme = useStore(s => s.setTheme);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="w-[90vw] max-w-[780px] max-h-[85vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <DialogTitle style={{ fontSize: 14, fontWeight: 600, color: 'var(--foreground)' }}>
            Choose Theme
          </DialogTitle>
        </DialogHeader>

        <div style={{
          padding: '16px',
          overflowY: 'auto',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
          gap: 10,
        }}>
          {themeNames.map(name => (
            <ThemeCard
              key={name}
              name={name}
              active={theme === name}
              onClick={() => setTheme(name)}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
