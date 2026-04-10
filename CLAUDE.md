# vipershell — notes for Claude

## Glossary (authoritative — use these terms)

When talking about features, writing comments, or naming variables, use these
terms consistently. The code has some legacy field names (`gridStates`,
`currentSessionId`) that don't match the glossary — document, don't rename,
unless the surrounding code is already being rewritten.

| Term | Meaning |
|---|---|
| **Session** | A backend PTY process. 1:1 with a pane. Identified by `sessionId`. Never use "session" to refer to a sidebar row. |
| **Pane** | A single terminal rendered in the UI. Backed by exactly one session. Has a `paneIndex` (0-based within its workspace). `TerminalCell` renders one pane. |
| **Workspace** | A sidebar row. A collection of 1–4 panes sharing a layout, name, and last-command. Identified by `workspaceId`, which equals the `sessionId` of the workspace's **root pane**. |
| **Root pane** | The pane at `paneIndex === 0`. Its session id *is* the workspace id. Anchor: closing it closes the whole workspace; currently not movable between workspaces. Surfaced in code as `isGridRoot`. |
| **Layout** | Shape of a workspace: `single` / `horizontal` / `vertical` / `three` / `quad`. Type alias: `GridLayout`. |
| **Active pane** | The focused pane inside the active workspace. Drives the Git/Files/Search tabs. Stored as `gridStates[workspaceId].activeCell`. |
| **Active workspace** | The workspace shown in the main area (sidebar selection). Stored as `currentSessionId` (legacy name; really means this). |

### Terms to avoid
- ❌ "primary session" / "primary pane" → ✅ **root pane**
- ❌ "grid" as a user-facing noun (in UI strings, comments, or docs) → ✅ **workspace**
- ❌ "split" as a noun → ✅ **pane** (or "non-root pane" when the distinction matters)
- ❌ "session" to mean "sidebar row" → ✅ **workspace**

### Legacy field names — don't rename, just document
- `gridStates` in the store = the per-workspace state map (keyed by `workspaceId`).
- `gridId` in component props = `workspaceId`. Both names are acceptable in code; prefer `workspaceId` in new code.
- `currentSessionId` in the store = the **active workspace id** (which is the root pane's session id — same thing).
- `splitSessionIds` in the store = session ids of non-root panes that must stay hidden from the sidebar.

## Brand palette — Hindsight colors

The brand color is a **blue → teal gradient** (Hindsight palette). Do not
reintroduce green as a brand color; green is reserved for semantic "success"
/ "addition" / "healthy" states only (git additions, PASS checks, clean tree,
connected status dot, ANSI green, etc.).

### Tokens

```
Primary gradient (default):
  linear-gradient(135deg, #0074d9 0%, #009296 100%)
    start: #0074d9   (blue)
    end:   #009296   (teal)

Hover / darker variant:
  linear-gradient(135deg, #005db0 0%, #007a7d 100%)

Light tint (10–15% alpha) — used for soft backgrounds:
  rgba(0, 116, 217, 0.1) → rgba(0, 146, 150, 0.1)

Dark surface gradient (control-plane backdrop):
  linear-gradient(135deg, #0f1419 0%, #0d1117 100%)
```

### CSS variables (defined in `ui/src/style.css`)

| var                        | value                                     | use for                          |
|----------------------------|-------------------------------------------|----------------------------------|
| `--primary`                | `#0074d9`                                 | solid brand (borders, text, fg)  |
| `--primary-end`            | `#009296`                                 | gradient end / secondary accent  |
| `--primary-gradient`       | `linear-gradient(135deg, #0074d9, #009296)` | buttons, filled surfaces       |
| `--primary-gradient-hover` | `linear-gradient(135deg, #005db0, #007a7d)` | hover state for the above      |
| `--primary-tint`           | `linear-gradient(135deg, rgba(0,116,217,.1), rgba(0,146,150,.1))` | soft backgrounds |
| `--dark-surface-gradient`  | `linear-gradient(135deg, #0f1419, #0d1117)` | control-plane backdrops         |
| `--ring`                   | `#0074d9`                                 | focus outlines                   |
| `--success`                | `#4ADE80`                                 | **semantic green — keep**        |

### Rules of thumb

- **Solid brand color** → `var(--primary)` (`#0074d9`).
- **Filled buttons / hero surfaces** → `background: var(--primary-gradient)`,
  `var(--primary-gradient-hover)` on hover.
- **Soft tinted backgrounds** → `var(--primary-tint)`.
- **Semantic success / additions / healthy** → stays `var(--success)` /
  `#4ADE80`. Do not replace with blue.
- **ANSI `green` in xterm theme** → stays `#4ADE80` (it's the ANSI green slot,
  not brand).
