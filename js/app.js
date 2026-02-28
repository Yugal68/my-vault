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

  // ── Vault helpers ────────────────────────────────────────────────────────

  function emptyVault() {
    return { version: 1, tables: {} };
  }

  function getTableNames() {
    if (!state.vault) return [];
    return Object.keys(state.vault.tables).sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase())
    );
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
    const json = JSON.stringify(state.vault);
    const encrypted = await Crypto.encrypt(json, state.password);
    await Storage.save(encrypted);
    state.pendingSync = Storage.hasPending();
    UI.updateSyncStatus();
  }

  // ── Auth ─────────────────────────────────────────────────────────────────

  async function unlock(password) {
    const payload = await Storage.load();

    if (!payload) {
      // First run — create new vault
      state.password = password;
      state.vault = emptyVault();
      state.locked = false;
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
    resetLockTimer();
    UI.showTableList();
    return { ok: true, firstRun: false };
  }

  function lock() {
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
    lockTimer = setTimeout(lock, LOCK_TIMEOUT_MS);
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
    await persistVault();
    return true;
  }

  async function renameTable(oldName, newName) {
    newName = newName.trim();
    if (!newName || newName === oldName || state.vault.tables[newName]) return false;
    state.vault.tables[newName] = state.vault.tables[oldName];
    delete state.vault.tables[oldName];
    if (state.activeTable === oldName) state.activeTable = newName;
    await persistVault();
    return true;
  }

  async function deleteTable(name) {
    if (!state.vault.tables[name]) return;
    delete state.vault.tables[name];
    if (state.activeTable === name) state.activeTable = null;
    await persistVault();
  }

  // ── Column CRUD ───────────────────────────────────────────────────────────

  async function addColumn(tableName, colName) {
    const tbl = state.vault.tables[tableName];
    if (!tbl) return;
    colName = colName.trim() || `Column ${tbl.columns.length + 1}`;
    tbl.columns.push(colName);
    tbl.rows.forEach(row => row.push(''));
    await persistVault();
  }

  async function renameColumn(tableName, colIndex, newName) {
    const tbl = state.vault.tables[tableName];
    if (!tbl || colIndex < 0 || colIndex >= tbl.columns.length) return;
    tbl.columns[colIndex] = newName.trim() || tbl.columns[colIndex];
    await persistVault();
  }

  async function deleteColumn(tableName, colIndex) {
    const tbl = state.vault.tables[tableName];
    if (!tbl || tbl.columns.length <= 1) return;  // keep at least 1 column
    tbl.columns.splice(colIndex, 1);
    tbl.rows.forEach(row => row.splice(colIndex, 1));
    await persistVault();
  }

  // ── Row CRUD ──────────────────────────────────────────────────────────────

  async function addRow(tableName) {
    const tbl = state.vault.tables[tableName];
    if (!tbl) return;
    tbl.rows.push(new Array(tbl.columns.length).fill(''));
    await persistVault();
  }

  async function updateCell(tableName, rowIndex, colIndex, value) {
    const tbl = state.vault.tables[tableName];
    if (!tbl) return;
    tbl.rows[rowIndex][colIndex] = value;
    await persistVault();
  }

  async function deleteRow(tableName, rowIndex) {
    const tbl = state.vault.tables[tableName];
    if (!tbl) return;
    tbl.rows.splice(rowIndex, 1);
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

  // ── Public API ────────────────────────────────────────────────────────────

  return {
    // state accessors
    get locked()       { return state.locked; },
    get activeTable()  { return state.activeTable; },
    set activeTable(v) { state.activeTable = v; },
    get searchQuery()  { return state.searchQuery; },
    set searchQuery(v) { state.searchQuery = v; },
    get pendingSync()  { return state.pendingSync; },
    getTableNames, getTable, filteredTableNames,
    // auth
    unlock, lock, hasVault: () => Storage.hasLocal(),
    // table
    createTable, renameTable, deleteTable,
    // column
    addColumn, renameColumn, deleteColumn,
    // row
    addRow, updateCell, deleteRow,
    // io
    importCSV, exportCSV, exportAllJSON,
    // github
    setupGitHub,
    gitHubConfigured: () => GitHub.isConfigured(),
    gitHubConfig: () => GitHub.getConfig(),
    clearGitHub: () => GitHub.clearConfig()
  };
})();
