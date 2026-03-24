import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';

interface Shortcut {
  keys: string[];
  desc: string;
}

const SHORTCUTS: Shortcut[] = [
  { keys: ['\u2318', '\u2191 / \u2193'], desc: 'Navigate between sessions' },
  { keys: ['\u2318', '\u2190 / \u2192'], desc: 'Cycle views (Terminal \u00B7 Git Diff \u00B7 Files)' },
  { keys: ['\u2318', 'N'],      desc: 'New session in current directory' },
  { keys: ['\u2318', 'W'],      desc: 'Close current session' },
];

interface ShortcutsDialogProps {
  onClose: () => void;
}

export default function ShortcutsDialog({ onClose }: ShortcutsDialogProps) {
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
