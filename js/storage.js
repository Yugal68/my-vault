// storage.js — Local vault persistence (Phase 1: localStorage, Phase 2: GitHub)
// Vault on disk is always the encrypted payload {salt, iv, ciphertext}

const Storage = (() => {
  const VAULT_KEY = 'mv_vault';          // localStorage key for encrypted blob
  const PENDING_KEY = 'mv_pending';      // localStorage key for offline-queue flag

  // ── Local ────────────────────────────────────────────────────────────────

  function saveLocal(encryptedPayload) {
    localStorage.setItem(VAULT_KEY, JSON.stringify(encryptedPayload));
  }

  function loadLocal() {
    const raw = localStorage.getItem(VAULT_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  function hasLocal() {
    return !!localStorage.getItem(VAULT_KEY);
  }

  function clearLocal() {
    localStorage.removeItem(VAULT_KEY);
    localStorage.removeItem(PENDING_KEY);
  }

  // ── Pending sync flag ────────────────────────────────────────────────────

  function markPending() {
    localStorage.setItem(PENDING_KEY, '1');
  }

  function clearPending() {
    localStorage.removeItem(PENDING_KEY);
  }

  function hasPending() {
    return !!localStorage.getItem(PENDING_KEY);
  }

  // ── GitHub (Phase 2 — stubs for now) ─────────────────────────────────────

  async function syncToGitHub(encryptedPayload) {
    // Implemented in github.js — called after saveLocal
    if (typeof GitHub !== 'undefined' && GitHub.isConfigured()) {
      return GitHub.push(encryptedPayload);
    }
  }

  async function syncFromGitHub() {
    if (typeof GitHub !== 'undefined' && GitHub.isConfigured()) {
      return GitHub.pull();
    }
    return null;
  }

  // ── High-level save/load used by app.js ──────────────────────────────────

  async function save(encryptedPayload) {
    saveLocal(encryptedPayload);
    try {
      await syncToGitHub(encryptedPayload);
      clearPending();
    } catch {
      markPending();  // Will retry on next successful network save
    }
  }

  async function load() {
    // Try GitHub first for freshest data; fall back to local cache
    try {
      const remote = await syncFromGitHub();
      if (remote) {
        saveLocal(remote);
        return remote;
      }
    } catch { /* offline — use local */ }
    return loadLocal();
  }

  return { save, load, hasLocal, clearLocal, hasPending, markPending, clearPending, saveLocal, loadLocal };
})();
