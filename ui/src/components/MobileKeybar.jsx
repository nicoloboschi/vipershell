import useStore from '../store.js';

const KEYS = [
  { label: 'Esc',       data: '\x1b' },
  { label: 'Tab',       data: '\t' },
  { label: 'Shift+Tab', data: '\x1b[Z' },
  { label: '↑',      data: '\x1b[A' },
  { label: '↓',      data: '\x1b[B' },
  { label: '←',      data: '\x1b[D' },
  { label: '→',      data: '\x1b[C' },
  { label: 'Ctrl+C', data: '\x03' },
  { label: 'Ctrl+Z', data: '\x1a' },
  { label: 'Ctrl+D', data: '\x04' },
  { label: 'Ctrl+L', data: '\x0c' },
  { label: 'PgUp',   data: '\x1b[5~' },
  { label: 'PgDn',   data: '\x1b[6~' },
];

export default function MobileKeybar({ sendRef }) {
  const currentSessionId = useStore(s => s.currentSessionId);

  if (!currentSessionId) return null;

  function press(data) {
    sendRef.current({ type: 'input', data });
  }

  return (
    <div
      className="md:hidden flex items-center gap-1 px-2 shrink-0 overflow-x-auto border-t"
      style={{ background: 'var(--card)', borderColor: 'var(--border)', height: 40, scrollbarWidth: 'none' }}
    >
      {KEYS.map(k => (
        <button
          key={k.label}
          onPointerDown={e => { e.preventDefault(); press(k.data); }}
          style={{
            flexShrink: 0,
            padding: '3px 10px',
            borderRadius: 5,
            border: '1px solid var(--border)',
            background: 'var(--secondary)',
            color: 'var(--foreground)',
            fontSize: 11,
            fontFamily: '"Cascadia Code","JetBrains Mono",monospace',
            cursor: 'pointer',
            userSelect: 'none',
            WebkitUserSelect: 'none',
          }}
        >
          {k.label}
        </button>
      ))}
    </div>
  );
}
