import { ChevronUp, ChevronRight } from 'lucide-react';
import useStore from '../store.js';
import { tildefy } from '../utils.js';

/**
 * Mobile bottom handle bar — always visible, tap to open the session sheet.
 */
export default function MobileHandleBar() {
  const sheetOpen = useStore(s => s.sheetOpen);
  const setSheetOpen = useStore(s => s.setSheetOpen);
  const currentSessionId = useStore(s => s.currentSessionId);
  const sessionMap = useStore(s => s.sessionMap);

  const session = sessionMap[currentSessionId];
  const name = session ? session.name : 'No session';
  const path = session ? (tildefy(session.path, session.username) ?? '') : '';

  return (
    <div
      id="sheet-handle"
      className="md:hidden flex items-center gap-3 px-4 shrink-0 border-t cursor-pointer select-none"
      style={{ background: 'var(--card)', borderColor: 'var(--border)', height: 52 }}
      onClick={() => setSheetOpen(!sheetOpen)}
    >
      <span className="text-muted-foreground">
        <ChevronRight size={16} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="session-name">{name}</div>
        {path && <div className="session-path">{path}</div>}
      </div>
      <span
        id="handle-chevron"
        className="text-muted-foreground transition-transform duration-200"
        style={{ transform: sheetOpen ? 'rotate(180deg)' : undefined }}
      >
        <ChevronUp size={16} />
      </span>
    </div>
  );
}
