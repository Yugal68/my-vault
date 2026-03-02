# my-vault — Task Tracker

Last updated: 2026-03-03
**CURRENT STATE**: Phase 1 ✓ | Phase 2 ✓ | Phase 3 ✓ | Phase 4 ✓ | Phase 5 ✓ | Phase 6 ✓

---

## Phase 1 — Core Vault [COMPLETE ✓]

- [x] Encryption (AES-256-GCM, PBKDF2 600k iterations)
- [x] Login screen — first run + returning unlock
- [x] Table list with live search
- [x] Table editor — inline edit, add/delete rows/cols, rename
- [x] Password column auto-masking (••••••), tap to reveal
- [x] Copy to clipboard (long-press on mobile, works on iOS Safari)
- [x] Auto-lock after 5 min inactivity
- [x] LocalStorage save/load
- [x] Dark mode + iPhone safe area
- [x] PWA (installable on iPhone home screen) ✓ CONFIRMED WORKING
- [x] CSV import (single + multi-file)
- [x] Export CSV per table
- [x] Export ALL tables as vault-backup-DATE.json (one tap)
- [x] Restore from backup (pick .json → replaces vault)
- [x] b64encode crash fix for large vaults (spread → for-loop)

---

## Phase 2 — GitHub Sync [COMPLETE ✓]

- [x] GitHub repo created: github.com/Yugal68/my-vault (PUBLIC)
- [x] GitHub Pages deployed: https://yugal68.github.io/my-vault/
- [x] Personal Access Token created and connected
- [x] Pull-first logic (new device pulls before pushing)
- [x] Sync working on Mac (localhost) ✓
- [x] Sync working on GitHub Pages (Mac Safari) ✓
- [x] Sync working on iPhone (home screen app) ✓
- [x] "✓ Synced" status pill confirmed working

---

## Phase 3 — Excel Migration [COMPLETE ✓]

- [x] Understand Excel file structure (Information.xlsm + AppleNotes.xlsm)
- [x] Build excel_to_vault.py importer
- [x] Test with dummy file — 4 tables correct
- [x] User runs importer on real files
- [x] All 100+ tables imported and confirmed working ✓

### Importer script:
/Users/yugalgarg/Desktop/PreProd/MyPersonalData/excel_to_vault.py

---

## Phase 4 — Polish [COMPLETE ✓]

- [x] **Edit Mode Toggle** — vault opens read-only by default
      - ✏ button in header toggles edit mode (amber highlight when ON)
      - Read-only: no delete buttons, no cell editing, no add row/col/table
      - Sensitive cells: tap-to-reveal still works in read-only
      - Long-press copy still works in read-only
      - Edit mode resets to OFF on vault lock
      - SW cache bumped to mv-v11, pushed to GitHub ✓
- [x] **Fix change master password** — autocomplete='off' on old pw input (Safari autofill bug)
- [x] **Fix offline sync** — load() skips GitHub pull when local has pending changes; unlock flushes pending to GitHub
- [x] **Pin tables to top** — 📌 button per table, pinned sort first (alphabetical), unpinned after
      - Pin/unpin works in both read and edit mode
      - Pins survive lock/unlock, rename updates pin reference, delete removes from pins
- [x] **Row reordering** — ▲ (move up), ▼ (move down), 📌 (pin to top), × (delete) per row in edit mode

---

## Phase 5 — Recycle Bin [COMPLETE ✓]

- [x] **Recycle Bin** — delete sends tables to bin (30 days), not permanent delete
      - 🗑 button in header with count badge when bin has items
      - Full bin screen: table name, delete date, days remaining per item
      - Restore button per item (handles name collisions with "(Restored)" suffix)
      - Permanent Delete button per item (with confirmation)
      - Auto-purge on unlock: items older than 30 days removed automatically
      - SW cache bumped to mv-v12, pushed to GitHub ✓

---

## Phase 6 — Table Count + Activity Log [COMPLETE ✓]

### Feature 1: Table Count
- [x] Count label below search box on main screen
- [x] Normal view: "142 tables" (singular "1 table" for one)
- [x] While searching: "12 of 142 tables" (shows filtered vs total)
- [x] Updates live as search query changes (rendered inside renderList())
- [x] CSS: `.table-count { padding: 0 16px 4px; font-size: 12px; color: var(--text-dim); }`

### Feature 2: Activity Log
- [x] **Data structure**: `vault.logs[]` — array of compact entries `{ t, a, tbl, d }`
- [x] **22 action types tracked**:
      - `unlock` / `lock` (with auto:true for timeout locks)
      - `open_table` / `create_table` / `rename_table` / `delete_table`
      - `add_row` / `edit_cell` / `delete_row` / `move_row`
      - `add_col` / `rename_col` / `delete_col`
      - `pin_table` / `unpin_table`
      - `restore_table` / `perm_delete`
      - `change_pw`
      - `sync_ok` / `sync_fail`
      - `bg` / `fg` (app backgrounded/foregrounded)
- [x] **Sensitive masking**: password/pin/cvv column values shown as •••••• in edit_cell logs
- [x] **Auto-purge**: logs older than 30 days removed on unlock (same as recycle bin)
- [x] **Sync logging**: sync_ok/sync_fail deferred to NEXT persist to avoid infinite loop
- [x] **lock() made async**: persists lock log BEFORE wiping in-memory state
- [x] **Auto-lock timer**: calls `lock(false)` → logs "Auto-locked (timeout)"
- [x] **Manual lock button**: calls `lock(true)` → logs "Locked vault"
- [x] **Change password**: log injected into parsed vault JSON before re-encrypting with new password
- [x] **Visibility tracking**: bg/fg logged on visibilitychange (no persist, rides next save)
- [x] **Settings UI**: Activity Log as first section, scrollable (max-height 400px)
      - Entries grouped by date: "Today", "Yesterday", or date string
      - Each entry: time (HH:MM) + human-readable description
      - Newest entries at top
      - Empty state: "No activity yet."
- [x] **CSS added**: .log-list, .log-date-header, .log-entry, .log-time, .log-desc
- [x] SW cache bumped to mv-v13

### Files Modified in Phase 6
| File | What Changed |
|---|---|
| `vault-app/js/storage.js` | `save()` now returns `{ synced: true/false }` instead of void |
| `vault-app/js/app.js` | Added: `addLog()`, `purgeLogs()`, `logAndSave()`, `getLogs()`, `isSensitiveColumn()`, `maskValue()`. Made `lock()` async with `manual` param. Hooked `addLog()` into all 16+ CRUD functions + unlock + visibility listener. `persistVault()` now handles deferred sync logging via `pendingSyncLog`. |
| `vault-app/js/ui.js` | Added: table count in `showTableList()`, `formatLogEntry()` helper, Activity Log section in `showSettings()`, `open_table` log in `showTable()`, `lock(true)` on lock button, `change_pw` log injection in change password handler. Fixed `const today` duplicate variable bug. |
| `vault-app/index.html` | Added CSS for `.table-count` + activity log classes |
| `vault-app/sw.js` | Cache bumped `mv-v12` → `mv-v13` |

### Edge Cases Handled
- lock() manual vs auto-timeout: `manual` parameter (default true), timer passes false
- lock() persists BEFORE wiping state (made async)
- permanentlyDelete() looks up table name from bin before filtering (was unavailable after filter)
- updateCell() captures old value BEFORE overwrite, masks if sensitive column
- Change password bypasses App.persistVault: log injected into parsed vault JSON before re-encrypt
- Sync logging infinite loop: sync logs deferred to NEXT persist via `pendingSyncLog` variable
- Visibility events: logged but not persisted (rides on next mutation save)
- Existing vaults without logs[]: all functions guard with `if (!vault.logs) vault.logs = []`
- `const today` was declared twice in showSettings() — renamed backup one to `todayStr`

---

## Review
All 6 phases complete as of 2026-03-03. SW cache at mv-v13. Pending: test locally + push to GitHub.
