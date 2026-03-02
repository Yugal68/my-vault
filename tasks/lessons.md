# Lessons Learned — my-vault

---

## SAFARI RULES (user is on Safari — always apply)

### Safari #1 — Cmd+Shift+R is NOT hard refresh — it opens Reader Mode
**Cmd+Shift+R = Reader Mode toggle in Safari. NEVER tell this user to press it.**
Hard refresh in Safari = **Cmd+Option+R**
Hard refresh in Chrome = Cmd+Shift+R (different browser, different shortcut)
User got stuck in Reader Mode: app appeared plain white, all CSS/JS stripped, "Summarize" button visible.
**Rule**: Always say Cmd+Option+R for Safari. Never Cmd+Shift+R.

### Safari #2 — Reader Mode can auto-activate on vault table view
Safari detected table content and auto-activated Reader Mode after unlocking.
Symptoms: white background, "Summarize" button, no dark theme, no buttons.
Fix for user: press Cmd+Shift+R once to EXIT Reader Mode, then Cmd+Option+R to hard refresh.
**Rule**: If user reports plain white page or "Summarize" button → it's Reader Mode.

---

## Bug Fixes

### Bug #1 — stopImmediatePropagation silently blocked vault creation
**File**: js/ui.js — showLogin()
Added a separate capture-phase form listener that called stopImmediatePropagation()
unconditionally. This blocked the main submit handler. Vault was never created.
**Fix**: Moved all validation inside the single main onsubmit handler.
**Rule**: ONE form handler. All validation inside it. Never a second listener.

### Bug #2 — Service worker served stale cached JS
**File**: sw.js
After fixing JS files, browser kept loading old broken version from SW cache.
**Fix**: Bump cache version (mv-v1 → mv-v2 → ... → mv-v4 currently).
**Rule**: Bump SW cache version after every meaningful JS change.
After change, tell user: **Cmd+Option+R** (NOT Cmd+Shift+R).
Current SW version: **mv-v12**. Next: mv-v13.

### Bug #3 — Row/col counter was static
**File**: js/ui.js — showTable()
rowCount element created once from initial snapshot. Counter never updated.
**Fix**: Update counter inside rebuildTable() on every state change.
**Rule**: DOM elements showing mutable state must be refreshed in the mutation handler.

### Bug #4 — autocomplete='current-password' caused Safari to silently autofill
**File**: js/ui.js — showLogin() unlock screen
Safari autofilled the correct master password silently. User thought any password worked.
**Fix**: Changed unlock screen to autocomplete='off'. Create-vault screen keeps 'new-password'.
**Rule**: ALWAYS use autocomplete='off' on unlock/verify inputs in security apps.

### Bug #5 — resetLockTimer() fired even when vault was already locked
**File**: js/app.js — resetLockTimer()
Timer reset on every click/keydown even when locked. On login screen, each keystroke
reset a 5-min timer that would re-render showLogin() and wipe the typed password.
**Fix**: Added `if (state.locked) return;` as first line of resetLockTimer().
**Rule**: Auto-lock timer must ONLY run while vault is unlocked.

### Bug #6 — `if (!pw) return` silently failed with no feedback
**File**: js/ui.js — showLogin() submit handler
Empty password field → silent return, no error shown, nothing visibly happened.
**Fix**: Show explicit "Please enter your master password." error and focus the input.
**Rule**: NEVER silently return from a user-triggered action. Always show feedback.

### Bug #7 — No vault reset path when user forgets password
**File**: js/ui.js — showLogin()
Forgotten password = permanently inaccessible vault, no escape.
**Fix**: Added "Forgot password? Reset vault" confirmation link on unlock screen.
**Rule**: Security apps must always have a reset/escape hatch for lost passwords.

---

## Phase 2 Lessons

### Phase2 #1 — setupGitHub() must pull-first, not always push
**Bug**: setupGitHub() always called persistVault() (push) after connecting.
On a new device (iPhone / GitHub Pages), this would push an EMPTY vault to GitHub,
overwriting the real vault that was pushed from localhost.
**Fix**: Pull from GitHub first. If remote has data → pull it. If empty → push local.
```javascript
const remote = await GitHub.pull();
if (remote) { /* decrypt + update state.vault + saveLocal */ }
else         { await persistVault(); }
```
**Rule**: When connecting GitHub sync on any device, ALWAYS check if remote data
already exists before deciding to push or pull.

## User Communication Rules

### U1 — Non-technical user, guide step by step
User asked "How to add a row?" — button was right there on screen.
**Rule**: After any screen transition, describe exactly what to tap/click. No assumptions.

### U2 — Ask about data scale before recommending tools
Nearly recommended 1Password. User has 100+ tables × 20×20. Scale changes everything.
**Rule**: Ask data volume/scale first. It changes the entire solution.

---

### Bug #8 — b64encode spread operator crashes on large vaults (CRITICAL)
**File**: js/crypto.js — b64encode()
`btoa(String.fromCharCode(...new Uint8Array(buf)))` uses spread to pass every byte as a function argument.
JS has a max call stack / argument limit (~65,000). A 150-table vault produces a ciphertext
well over that limit — the spread throws "Maximum call stack size exceeded" silently,
meaning **the vault fails to save without any visible error**.
**Fix**: Replace spread with a for-loop that builds the string byte by byte.
**Rule**: NEVER use spread operator (`...`) on potentially large Uint8Arrays. Always use a loop.

### Bug #9 — "Export All" was missing — 150 tables × manual export = unusable
**Problem**: Only per-table CSV export existed. 150+ tables means 150+ manual exports.
**Fix**: Added "Export All Tables" button in Settings → downloads vault-backup-YYYY-MM-DD.json (all tables, unencrypted).
**Rule**: Any backup feature that requires N manual actions for N items is NOT a backup feature. Must be 1-click.

### Bug #10 — iOS Safari clipboard crash inside setTimeout (CRITICAL)
**File**: js/ui.js — long-press copy handler
`navigator.clipboard.writeText()` was called inside a `setTimeout` callback (long-press timer).
iOS Safari rejects clipboard calls that aren't inside a direct user gesture handler.
setTimeout breaks the "user gesture" chain — the call is no longer trusted.
**Symptom**: Long-press on iPhone did nothing; no toast, no copy.
**Fix**: Remove the setTimeout entirely. Instead, record `touchstart` timestamp, then in
`touchend` (which IS a real user gesture), measure elapsed time. Call clipboard directly inside `touchend`.
```javascript
let touchStartTime = 0;
span.addEventListener('touchstart', () => { touchStartTime = Date.now(); }, { passive: true });
span.addEventListener('touchend', () => {
  if (Date.now() - touchStartTime >= 600 && cell) copyToClipboard(cell);
}, { passive: true });
```
**Rule**: NEVER call `navigator.clipboard.writeText()` inside `setTimeout`. Always call it
directly inside a user gesture event handler (click, touchend, keydown, etc.).

### Bug #11 — Mac double-click reveal broken (onclick fires first)
**File**: js/ui.js — sensitive cell click handler
Sensitive cells had `onclick` call `beginEdit()` immediately on first click.
On Mac dblclick = two rapid clicks, so `onclick` fired first — replacing the span with an
input before `dblclick` ever had a chance to fire. Reveal never worked.
**Symptom**: Double-clicking a masked cell on Mac went straight to edit mode, skipping reveal.
**Fix**: New UX — first click reveals value, second click on already-revealed value enters edit mode.
Removed dblclick entirely. Added a `revealed` boolean flag per cell.
```javascript
let revealed = false;
span.addEventListener('click', () => {
  if (longPressTriggered) { longPressTriggered = false; return; }
  if (!revealed) {
    revealed = true;
    span.textContent = cell;
    span.classList.remove('cell-hidden');
  } else {
    beginEdit(td, span, tableName, ri, ci, isSensitive, rebuildTable);
  }
});
```
**Rule**: NEVER mix onclick + ondblclick on the same element. Use state flags instead.
Single click = reveal. Second click on revealed = edit.

---

## Architecture Decisions

### A1 — Single submit handler for all forms
```javascript
const form = el('form', { onsubmit: async e => {
  e.preventDefault();
  // ALL validation + action here
}});
// Never add a second listener — causes order-of-execution bugs
```

### A2 — rebuildTable() is single source of DOM truth
All counter updates, grid redraws, and state refreshes go through rebuildTable().
Never update individual elements outside it.

### A3 — editMode is a module-level boolean in ui.js IIFE
`let editMode = false;` lives at the top of the UI IIFE.
Reset to false inside `showLogin()` so locking always drops back to read-only.
Toggle button re-renders the whole screen (showTableList() or showTable()) — no partial DOM update.
`editMode && el(...)` pattern DOES NOT WORK — `false` passed as child to el() crashes appendChild.
Instead: build parent element first, then use `if (editMode) { parent.appendChild(...) }`.

### A4 — No git repo in MyPersonalData — push via GitHub API using gh CLI
The vault-app has no local git repo. Deploy by reading each file, base64-encoding, and
PUT-ting to GitHub API with the file's current SHA:
```bash
SHA=$(gh api "repos/Yugal68/my-vault/contents/PATH" --jq '.sha')
CONTENT=$(base64 -i /path/to/local/file)
gh api --method PUT "repos/Yugal68/my-vault/contents/PATH" \
  --field message="commit message" \
  --field content="$CONTENT" \
  --field sha="$SHA"
```
Files in remote repo root match local vault-app/ directory (not nested further).
