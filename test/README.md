# Tests

`npm test` runs every test once. `npm run test:coverage` also fails unless **statements, branches, functions and lines are all 100%** for `electron/`, `src/` and `scripts/`.

## Layout

| Folder | What it tests | Runs in |
| --- | --- | --- |
| `test/electron` | the main process: database, the Ledge-to-Pullshelf data migration, notes, files, clipboard, gesture parser, PTY, preload bridge, and `main.ts` (window, tray and its menu-bar settings, IPC, gestures) | Node |
| `test/scripts` | `scripts/postinstall.mjs` | Node |
| `test/src` | the React UI: each pane, the shelf layout and dividers, the settings menu, theme, entry point | jsdom |
| `test/mocks`, `test/shims`, `test/helpers` | shared fakes and setup | |

## How things are faked

- **SQLite is real.** `better-sqlite3` is built for Electron and cannot load under plain Node, so `test/shims/better-sqlite3.ts` runs the app's real SQL on Node's built-in `node:sqlite`. Notes, files, clipboard history and settings are exercised against an actual database in a temp folder.
- **Electron is faked** in `test/mocks/electron.ts` (windows, tray, IPC, clipboard, screen). `ipcMain.invoke(...)` and `.send(...)` call the handlers `main.ts` registered, the way the page would.
- **`node-pty` and `child_process`** are scripted fakes. **xterm** is replaced by a recording fake in jsdom.
- **`main.ts` tests** keep the pty, clipboard and gesture modules mocked and use the real database, notes and files modules.
- **The migration** (`test/electron/migrate.test.ts`) uses real temporary folders, including read-only ones to force move failures, so it needs no fs mocks. Do not run the suite as root, which ignores folder permissions.
- **Timers**: animation and gesture tests use Vitest fake timers (including `Date` and `performance`), so they do not wait in real time.

## What the 100% does not mean

- **`native/GestureHelper.swift` is not measured.** JavaScript coverage cannot see Swift. Its JavaScript side (`electron/gesture.ts`) is fully tested; the Swift decision logic (scroll direction, edge zone, drag start and stop) is checked by hand.
- **Real Electron and macOS behaviour is not tested here**: true window input, the CSS grid and minimum widths, native drag and drop, and the actual trackpad. jsdom has no layout, so divider dragging is tested by its arithmetic with stubbed pane widths.
- Coverage shows lines were run, not that they are right. Tests assert behaviour (state, return values, events, rendered text). They were checked by deliberately breaking the source (27 places originally, plus the menu-bar and migration logic added later); every break made a test fail.

## The six coverage exclusions

Each is a `v8 ignore` comment on a defensive guard that cannot be reached through the public behaviour, with the reason beside it:

- `electron/clipboard.ts` (3): `rememberText`, `rememberImage` and `trim` check that the database is open; polling only starts after it is.
- `electron/main.ts` (3): the end-of-slide guard in `hideShelf`, the window check in `slideWindow`, and the database check in `persist`. Callers already guarantee these.

Everything else, including the paths that only run when something fails, is tested.
