// github.js — GitHub API sync for encrypted vault file
// Stores ONE file: vault.enc in a private repo
// Auth: Personal Access Token stored only in localStorage (never in vault)

const GitHub = (() => {
  const CFG_KEY    = 'mv_gh_cfg';           // {owner, repo, token}
  const FILE_PATH  = 'vault.enc';
  const API_BASE   = 'https://api.github.com';

  function getConfig() {
    const raw = localStorage.getItem(CFG_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  function setConfig(owner, repo, token) {
    localStorage.setItem(CFG_KEY, JSON.stringify({ owner, repo, token }));
  }

  function clearConfig() {
    localStorage.removeItem(CFG_KEY);
  }

  function isConfigured() {
    const cfg = getConfig();
    return !!(cfg && cfg.owner && cfg.repo && cfg.token);
  }

  function headers(token) {
    return {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    };
  }

  // Fetch current file SHA (needed for updating an existing file)
  async function getFileSha(cfg) {
    const url = `${API_BASE}/repos/${cfg.owner}/${cfg.repo}/contents/${FILE_PATH}`;
    const res = await fetch(url, { headers: headers(cfg.token) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub fetch failed: ${res.status}`);
    const data = await res.json();
    return data.sha;
  }

  // Push encrypted payload to GitHub
  async function push(encryptedPayload) {
    const cfg = getConfig();
    if (!cfg) throw new Error('GitHub not configured');

    const content = btoa(JSON.stringify(encryptedPayload));
    const sha = await getFileSha(cfg);

    const body = {
      message: 'vault update',
      content,
      ...(sha ? { sha } : {})
    };

    const url = `${API_BASE}/repos/${cfg.owner}/${cfg.repo}/contents/${FILE_PATH}`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: headers(cfg.token),
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`GitHub push failed: ${res.status}`);
  }

  // Pull encrypted payload from GitHub
  async function pull() {
    const cfg = getConfig();
    if (!cfg) return null;

    const url = `${API_BASE}/repos/${cfg.owner}/${cfg.repo}/contents/${FILE_PATH}`;
    const res = await fetch(url, { headers: headers(cfg.token) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub pull failed: ${res.status}`);

    const data = await res.json();
    // GitHub returns content as base64
    return JSON.parse(atob(data.content.replace(/\n/g, '')));
  }

  // Verify token works and repo exists
  async function testConnection(owner, repo, token) {
    const url = `${API_BASE}/repos/${owner}/${repo}`;
    const res = await fetch(url, { headers: headers(token) });
    return res.ok;
  }

  return { isConfigured, getConfig, setConfig, clearConfig, push, pull, testConnection };
})();
