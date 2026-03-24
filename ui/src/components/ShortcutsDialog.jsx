import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog.jsx';

const SHORTCUTS = [
  { keys: ['⌘', '↑ / ↓'], desc: 'Navigate between sessions' },
  { keys: ['⌘', '← / →'], desc: 'Cycle views (Terminal · Git Diff · Files)' },
  { keys: ['⌘', 'N'],      desc: 'New session in current directory' },
  { keys: ['⌘', 'W'],      desc: 'Close current session' },
];

export default function ShortcutsDialog({ onClose }) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="w-80" style={{ maxWidth: 340 }}>
        <DialogHeader>
          <DialogTitle style={{ fontSize: 13, fontWeight: 600 }}>Keyboard Shortcuts</DialogTitle>
        </DialogHeader>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <tbody>
            {SHORTCUTS.map(({ keys, desc }) => (
              <tr key={desc} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '8px 0', whiteSpace: 'nowrap', paddingRight: 16 }}>
                  {keys.map((k, i) => (
                    <span key={i}>
                      <kbd style={{
                        display: 'inline-block', padding: '1px 5px', borderRadius: 4,
                        border: '1px solid var(--border)', background: 'var(--muted)',
                        fontFamily: 'inherit', fontSize: 11,
                      }}>{k}</kbd>
                      {i < keys.length - 1 && ' '}
                    </span>
                  ))}
                </td>
                <td style={{ padding: '8px 0', color: 'var(--muted-foreground)' }}>{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DialogContent>
    </Dialog>
  );
}
