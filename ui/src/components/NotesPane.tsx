import { useEffect, useRef, useState, useCallback } from 'react';

export default function NotesPane(): JSX.Element {
  const [content, setContent] = useState<string | null>(null);
  const [saving, setSaving]   = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Load notes on mount
  useEffect(() => {
    fetch('/api/notes')
      .then(r => r.json())
      .then(d => setContent(d.content ?? ''))
      .catch(() => setContent(''));
  }, []);

  const save = useCallback((text: string) => {
    setSaving(true);
    fetch('/api/notes', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text }),
    })
      .then(() => setSaving(false))
      .catch(() => setSaving(false));
  }, []);

  // Let Cmd+ArrowUp/Down reach the window handler for session switching
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      e.currentTarget.blur();
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: e.key, metaKey: true, bubbles: true,
      }));
    }
  }, []);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setContent(text);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => save(text), 500);
  }, [save]);

  // Focus textarea and place cursor at end when content loads
  useEffect(() => {
    if (content !== null && textareaRef.current) {
      const el = textareaRef.current;
      el.focus();
      el.selectionStart = el.selectionEnd = el.value.length;
    }
  }, [content !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  // Save on unmount if pending
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        // Sync save the current content
        const el = textareaRef.current;
        if (el) {
          navigator.sendBeacon?.('/api/notes', new Blob(
            [JSON.stringify({ content: el.value })],
            { type: 'application/json' }
          ));
        }
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (content === null) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted-foreground)' }}>
        Loading...
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, background: '#0c0c0c' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '6px 12px', borderBottom: '1px solid var(--border)',
        fontSize: 11, color: 'var(--muted-foreground)',
      }}>
        <span>~/.vipershell/notes.md</span>
        {saving && <span>Saving...</span>}
      </div>
      <textarea
        ref={textareaRef}
        value={content}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        style={{
          flex: 1,
          resize: 'none',
          background: '#0c0c0c',
          color: '#d4d4d8',
          border: 'none',
          outline: 'none',
          padding: '12px 16px',
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 14,
          lineHeight: 1.6,
          tabSize: 2,
          minHeight: 0,
        }}
        placeholder="Write your notes here..."
      />
    </div>
  );
}
