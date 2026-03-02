// app.js — State management and main logic
// State is the single source of truth; UI reads from it, writes through it

const App = (() => {
  // ── State ────────────────────────────────────────────────────────────────
  let state = {
    locked: true,
    password: null,           // held in memory only while unlocked
    vault: null,              // { version, tables: { name: {columns, rows} } }
    activeTable: null,        // table name string
    searchQuery: '',
    pendingSync: false
  };

  let lockTimer = null;
  const LOCK_TIMEOUT_MS = 5 * 60 * 1000;   // 5 minutes
  let pendingSyncLog = null;  // deferred sync log (to avoid infinite persist loop)

  // ── Logging helpers ─────────────────────────────────────────────────────

  const SENSITIVE_RE = /password|pass|pwd|secret|pin|cvv|token/i;

  function isSensitiveColumn(colName) {
    return SENSITIVE_RE.test(colName);
  }

  function maskValue(val) {
    return val ? '••••••' : '';
  }

  function addLog(action, tableName, details) {
    if (!state.vault) return;
    if (!state.vault.logs) state.vault.logs = [];
    const entry = { t: Date.now(), a: action };
    if (tableName) entry.tbl = tableName;
    if (details) entry.d = details;
    state.vault.logs.push(entry);
  }

  function purgeLogs() {
    if (!state.vault || !state.vault.logs) return;
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    state.vault.logs = state.vault.logs.filter(e => e.t > cutoff);
  }

  async function logAndSave(action, tableName, details) {
    addLog(action, tableName, details);
    await persistVault();
  }

  function getLogs() {
    return (state.vault && state.vault.logs) ? state.vault.logs : [];
  }

  // ── Vault helpers ────────────────────────────────────────────────────────

  function emptyVault() {
    return { version: 1, tables: {} };
  }

  function getTableNames() {
    if (!state.vault) return [];
    const pinned = state.vault.pinnedTables || [];
    const all = Object.keys(state.vault.tables);
    const pinnedSet = new Set(pinned);
    const pinnedNames = all.filter(n => pinnedSet.has(n)).sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase())
    );
    const unpinnedNames = all.filter(n => !pinnedSet.has(n)).sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase())
    );
    return [...pinnedNames, ...unpinnedNames];
  }

  async function togglePinTable(name) {
    if (!state.vault) return;
    if (!state.vault.pinnedTables) state.vault.pinnedTables = [];
    const idx = state.vault.pinnedTables.indexOf(name);
    const wasPinned = idx !== -1;
    if (wasPinned) state.vault.pinnedTables.splice(idx, 1);
    else state.vault.pinnedTables.push(name);
    addLog(wasPinned ? 'unpin_table' : 'pin_table', name);
    await persistVault();
  }

  function isTablePinned(name) {
    return (state.vault?.pinnedTables || []).includes(name);
  }

  function getTable(name) {
    return state.vault?.tables[name] ?? null;
  }

  function filteredTableNames() {
    const q = state.searchQuery.trim().toLowerCase();
    if (!q) return getTableNames();
    return getTableNames().filter(name => {
      if (name.toLowerCase().includes(q)) return true;
      const tbl = getTable(name);
      return tbl.rows.some(row => row.some(cell =>
        String(cell).toLowerCase().includes(q)
      ));
    });
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  async function persistVault() {
    if (!state.vault || !state.password) return;
    // Inject deferred sync log from previous persist (avoids infinite loop)
    if (pendingSyncLog) {
      if (!state.vault.logs) state.vault.logs = [];
      state.vault.logs.push(pendingSyncLog);
      pendingSyncLog = null;
    }
    const json = JSON.stringify(state.vault);
    const encrypted = await Crypto.encrypt(json, state.password);
    const result = await Storage.save(encrypted);
    state.pendingSync = Storage.hasPending();
    UI.updateSyncStatus();
    // Queue sync log for next persist
    if (result.synced) {
      pendingSyncLog = { t: Date.now(), a: 'sync_ok' };
    } else {
      pendingSyncLog = { t: Date.now(), a: 'sync_fail' };
    }
  }

  // ── Auth ─────────────────────────────────────────────────────────────────

  async function unlock(password) {
    const payload = await Storage.load();

    if (!payload) {
      // First run — create new vault
      state.password = password;
      state.vault = emptyVault();
      state.locked = false;
      addLog('unlock');
      await persistVault();
      resetLockTimer();
      UI.showTableList();
      return { ok: true, firstRun: true };
    }

    const ok = await Crypto.verify(payload, password);
    if (!ok) return { ok: false };

    const json = await Crypto.decrypt(payload, password);
    state.vault    = JSON.parse(json);
    state.password = password;
    state.locked   = false;
    purgeBin();   // auto-remove bin items older than 30 days
    purgeLogs();  // auto-remove log entries older than 30 days
    addLog('unlock');
    await persistVault();
    resetLockTimer();
    // Flush pending local changes to GitHub if any
    if (Storage.hasPending()) {
      persistVault().catch(() => {});  // best-effort, don't block unlock
    }
    UI.showTableList();
    return { ok: true, firstRun: false };
  }

  async function lock(manual) {
    if (manual === undefined) manual = true;
    // Persist lock log before wiping state
    if (state.vault && state.password) {
      addLog('lock', null, manual ? null : { auto: true });
      await persistVault();
    }
    state.locked   = true;
    state.password = null;
    state.vault    = null;
    state.activeTable = null;
    state.searchQuery = '';
    clearTimeout(lockTimer);
    UI.showLogin();
  }

  function resetLockTimer() {
    if (state.locked) return;   // Don't schedule a re-lock when already locked
    clearTimeout(lockTimer);
    lockTimer = setTimeout(() => lock(false), LOCK_TIMEOUT_MS);
  }

  // Reset timer on any user activity
  document.addEventListener('touchstart', resetLockTimer, { passive: true });
  document.addEventListener('keydown',    resetLockTimer, { passive: true });
  document.addEventListener('click',      resetLockTimer, { passive: true });

  // ── Table CRUD ────────────────────────────────────────────────────────────

  async function createTable(name) {
    name = name.trim();
    if (!name || state.vault.tables[name]) return false;
    state.vault.tables[name] = { columns: ['Column 1'], rows: [] };
    addLog('create_table', name);
    await persistVault();
    return true;
  }

  async function renameTable(oldName, newName) {
    newName = newName.trim();
    if (!newName || newName === oldName || state.vault.tables[newName]) return false;
    state.vault.tables[newName] = state.vault.tables[oldName];
    delete state.vault.tables[oldName];
    if (state.activeTable === oldName) state.activeTable = newName;
    // Update pinned reference
    if (state.vault.pinnedTables) {
      const pi = state.vault.pinnedTables.indexOf(oldName);
      if (pi !== -1) state.vault.pinnedTables[pi] = newName;
    }
    addLog('rename_table', newName, { from: oldName });
    await persistVault();
    return true;
  }

  async function deleteTable(name) {
    const tbl = state.vault.tables[name];
    if (!tbl) return;
    // Soft-delete: move to recycle bin
    if (!state.vault.bin) state.vault.bin = [];
    state.vault.bin.push({
      name,
      columns: tbl.columns,
      rows: tbl.rows,
      deletedAt: Date.now()
    });
    delete state.vault.tables[name];
    // Remove from pinned if applicable
    if (state.vault.pinnedTables) {
      const pi = state.vault.pinnedTables.indexOf(name);
      if (pi !== -1) state.vault.pinnedTables.splice(pi, 1);
    }
    if (state.activeTable === name) state.activeTable = null;
    addLog('delete_table', name);
    await persistVault();
  }

  // ── Recycle Bin ──────────────────────────────────────────────────────────

  function getRecycleBin() {
    return state.vault?.bin || [];
  }

  async function restoreTable(deletedAt) {
    const bin = state.vault.bin || [];
    const idx = bin.findIndex(e => e.deletedAt === deletedAt);
    if (idx === -1) return false;
    const entry = bin[idx];
    let name = entry.name;
    if (state.vault.tables[name]) name = name + ' (Restored)';
    state.vault.tables[name] = { columns: entry.columns, rows: entry.rows };
    state.vault.bin.splice(idx, 1);
    addLog('restore_table', name);
    await persistVault();
    return name;
  }

  async function permanentlyDelete(deletedAt) {
    const bin = state.vault.bin || [];
    const entry = bin.find(e => e.deletedAt === deletedAt);
    const name = entry ? entry.name : 'Unknown';
    state.vault.bin = bin.filter(e => e.deletedAt !== deletedAt);
    addLog('perm_delete', name);
    await persistVault();
  }

  function purgeBin() {
    if (!state.vault.bin) return;
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    state.vault.bin = state.vault.bin.filter(e => e.deletedAt > cutoff);
  }

  // ── Column CRUD ───────────────────────────────────────────────────────────

  async function addColumn(tableName, colName) {
    const tbl = state.vault.tables[tableName];
    if (!tbl) return;
    colName = colName.trim() || `Column ${tbl.columns.length + 1}`;
    tbl.columns.push(colName);
    tbl.rows.forEach(row => row.push(''));
    addLog('add_col', tableName, { col: colName });
    await persistVault();
  }

  async function renameColumn(tableName, colIndex, newName) {
    const tbl = state.vault.tables[tableName];
    if (!tbl || colIndex < 0 || colIndex >= tbl.columns.length) return;
    const oldName = tbl.columns[colIndex];
    tbl.columns[colIndex] = newName.trim() || oldName;
    addLog('rename_col', tableName, { from: oldName, to: tbl.columns[colIndex] });
    await persistVault();
  }

  async function deleteColumn(tableName, colIndex) {
    const tbl = state.vault.tables[tableName];
    if (!tbl || tbl.columns.length <= 1) return;  // keep at least 1 column
    const colName = tbl.columns[colIndex];
    tbl.columns.splice(colIndex, 1);
    tbl.rows.forEach(row => row.splice(colIndex, 1));
    addLog('delete_col', tableName, { col: colName });
    await persistVault();
  }

  // ── Row CRUD ──────────────────────────────────────────────────────────────

  async function addRow(tableName) {
    const tbl = state.vault.tables[tableName];
    if (!tbl) return;
    tbl.rows.push(new Array(tbl.columns.length).fill(''));
    addLog('add_row', tableName);
    await persistVault();
  }

  async function updateCell(tableName, rowIndex, colIndex, value) {
    const tbl = state.vault.tables[tableName];
    if (!tbl) return;
    const colName = tbl.columns[colIndex] || '';
    const oldVal = tbl.rows[rowIndex][colIndex];
    tbl.rows[rowIndex][colIndex] = value;
    const sensitive = isSensitiveColumn(colName);
    addLog('edit_cell', tableName, {
      col: colName,
      row: rowIndex + 1,
      old: sensitive ? maskValue(oldVal) : oldVal,
      new: sensitive ? maskValue(value) : value
    });
    await persistVault();
  }

  async function deleteRow(tableName, rowIndex) {
    const tbl = state.vault.tables[tableName];
    if (!tbl) return;
    tbl.rows.splice(rowIndex, 1);
    addLog('delete_row', tableName, { row: rowIndex + 1 });
    await persistVault();
  }

  async function moveRow(tableName, fromIndex, toIndex) {
    const tbl = state.vault.tables[tableName];
    if (!tbl || fromIndex < 0 || toIndex < 0 || fromIndex >= tbl.rows.length || toIndex >= tbl.rows.length) return;
    const [row] = tbl.rows.splice(fromIndex, 1);
    tbl.rows.splice(toIndex, 0, row);
    addLog('move_row', tableName, { from: fromIndex + 1, to: toIndex + 1 });
    await persistVault();
  }

  async function pinRowToTop(tableName, rowIndex) {
    const tbl = state.vault.tables[tableName];
    if (!tbl || rowIndex <= 0 || rowIndex >= tbl.rows.length) return;
    const [row] = tbl.rows.splice(rowIndex, 1);
    tbl.rows.unshift(row);
    addLog('move_row', tableName, { from: rowIndex + 1, to: 1 });
    await persistVault();
  }

  // ── Import / Export ───────────────────────────────────────────────────────

  async function importCSV(tableName, csvText) {
    const lines = csvText.trim().split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 1) return false;
    const parseRow = line => {
      // Handle quoted fields
      const result = [];
      let cur = '', inQ = false;
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '"') { inQ = !inQ; continue; }
        if (line[i] === ',' && !inQ) { result.push(cur); cur = ''; continue; }
        cur += line[i];
      }
      result.push(cur);
      return result;
    };
    const columns = parseRow(lines[0]);
    const rows    = lines.slice(1).map(parseRow);
    tableName = tableName.trim() || 'Imported Table';
    // If table exists, append rows; otherwise create
    if (state.vault.tables[tableName]) {
      state.vault.tables[tableName].rows.push(...rows);
    } else {
      state.vault.tables[tableName] = { columns, rows };
    }
    await persistVault();
    return true;
  }

  function exportAllJSON() {
    return JSON.stringify(state.vault, null, 2);
  }

  async function importAllJSON(jsonText) {
    let parsed;
    try { parsed = JSON.parse(jsonText); } catch { return false; }
    if (!parsed || typeof parsed.tables !== 'object') return false;
    state.vault = parsed;
    await persistVault();
    return true;
  }

  function exportCSV(tableName) {
    const tbl = getTable(tableName);
    if (!tbl) return '';
    const escape = v => (String(v).includes(',') || String(v).includes('"'))
      ? `"${String(v).replace(/"/g, '""')}"` : String(v);
    const lines = [
      tbl.columns.map(escape).join(','),
      ...tbl.rows.map(row => row.map(escape).join(','))
    ];
    return lines.join('\n');
  }

  // ── GitHub setup ──────────────────────────────────────────────────────────

  async function setupGitHub(owner, repo, token) {
    const ok = await GitHub.testConnection(owner, repo, token);
    if (!ok) return false;
    GitHub.setConfig(owner, repo, token);
    // If GitHub already has vault data → pull it (new device joining existing sync)
    // If GitHub is empty → push local vault (first device setting up sync)
    const remote = await GitHub.pull();
    if (remote) {
      const json = await Crypto.decrypt(remote, state.password);
      state.vault = JSON.parse(json);
      Storage.saveLocal(remote);
    } else {
      await persistVault();
    }
    return true;
  }

  // ── Visibility tracking ──────────────────────────────────────────────────

  document.addEventListener('visibilitychange', () => {
    if (state.locked || !state.vault) return;
    addLog(document.hidden ? 'bg' : 'fg');
    // Don't persist here — rides on next mutation save
  });

  // ── Public API ────────────────────────────────────────────────────────────

  return {
    // state accessors
    get locked()       { return state.locked; },
    get activeTable()  { return state.activeTable; },
    set activeTable(v) { state.activeTable = v; },
    get searchQuery()  { return state.searchQuery; },
    set searchQuery(v) { state.searchQuery = v; },
    get pendingSync()  { return state.pendingSync; },
    getTableNames, getTable, filteredTableNames, togglePinTable, isTablePinned,
    // auth
    unlock, lock, hasVault: () => Storage.hasLocal(),
    // table
    createTable, renameTable, deleteTable, getRecycleBin, restoreTable, permanentlyDelete,
    // column
    addColumn, renameColumn, deleteColumn,
    // row
    addRow, updateCell, deleteRow, moveRow, pinRowToTop,
    // io
    importCSV, exportCSV, exportAllJSON, importAllJSON,
    // github
    setupGitHub,
    gitHubConfigured: () => GitHub.isConfigured(),
    gitHubConfig: () => GitHub.getConfig(),
    clearGitHub: () => GitHub.clearConfig(),
    // logging
    addLog, logAndSave, getLogs, isSensitiveColumn
  };
})();
