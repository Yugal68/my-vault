// ui.js — All rendering and DOM event wiring

const UI = (() => {
  const root = () => document.getElementById('app');
  let editMode = false;

  // ── Helpers ───────────────────────────────────────────────────────────────

  function el(tag, attrs = {}, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    children.flat().forEach(c =>
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c)
    );
    return e;
  }

  function toast(msg, type = 'info') {
    const t = el('div', { class: `toast toast-${type}` }, msg);
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('toast-show'), 10);
    setTimeout(() => { t.classList.remove('toast-show'); setTimeout(() => t.remove(), 300); }, 2500);
  }

  function confirm(msg) {
    return window.confirm(msg);
  }

  // Clipboard — called directly from user gesture handlers only (iOS Safari requirement)
  function copyToClipboard(text) {
    navigator.clipboard.writeText(text)
      .then(() => toast('Copied to clipboard', 'success'))
      .catch(() => toast('Copy failed', 'error'));
  }

  // ── Log formatting ──────────────────────────────────────────────────

  function formatLogEntry(entry) {
    const t = entry.tbl ? `"${entry.tbl}"` : '';
    const d = entry.d || {};
    switch (entry.a) {
      case 'unlock':       return 'Unlocked vault';
      case 'lock':         return d.auto ? 'Auto-locked (timeout)' : 'Locked vault';
      case 'open_table':   return `Opened ${t}`;
      case 'create_table': return `Created table ${t}`;
      case 'rename_table': return `Renamed "${d.from}" → ${t}`;
      case 'delete_table': return `Deleted ${t} to bin`;
      case 'add_row':      return `Added row in ${t}`;
      case 'edit_cell':    return `Edited ${t} row ${d.row} [${d.col}]: ${d.old || '(empty)'} → ${d.new || '(empty)'}`;
      case 'delete_row':   return `Deleted row ${d.row} in ${t}`;
      case 'move_row':     return `Moved row ${d.from} → ${d.to} in ${t}`;
      case 'add_col':      return `Added column "${d.col}" in ${t}`;
      case 'rename_col':   return `Renamed column "${d.from}" → "${d.to}" in ${t}`;
      case 'delete_col':   return `Deleted column "${d.col}" in ${t}`;
      case 'pin_table':    return `Pinned ${t}`;
      case 'unpin_table':  return `Unpinned ${t}`;
      case 'restore_table':return `Restored ${t} from bin`;
      case 'perm_delete':  return `Permanently deleted ${t}`;
      case 'change_pw':    return 'Changed master password';
      case 'sync_ok':      return 'Synced to GitHub';
      case 'sync_fail':    return 'GitHub sync failed';
      case 'bg':           return 'App backgrounded';
      case 'fg':           return 'App foregrounded';
      default:             return entry.a;
    }
  }

  // ── Sync status pill ─────────────────────────────────────────────────────

  function updateSyncStatus() {
    const pill = document.getElementById('sync-status');
    if (!pill) return;
    if (!App.gitHubConfigured()) {
      pill.textContent = 'Local only';
      pill.className = 'sync-pill sync-local';
    } else if (App.pendingSync) {
      pill.textContent = '⏳ Pending sync';
      pill.className = 'sync-pill sync-pending';
    } else {
      pill.textContent = '✓ Synced';
      pill.className = 'sync-pill sync-ok';
    }
  }

  // ── Login screen ──────────────────────────────────────────────────────────

  function showLogin() {
    editMode = false;
    const isFirst = !App.hasVault();
    root().innerHTML = '';

    const pwInput = el('input', {
      type: 'password',
      placeholder: isFirst ? 'Set a master password' : 'Master password',
      autocomplete: isFirst ? 'new-password' : 'off',
      class: 'pw-input',
      id: 'pw-input'
    });

    const confirmInput = isFirst ? el('input', {
      type: 'password',
      placeholder: 'Confirm master password',
      autocomplete: 'new-password',
      class: 'pw-input'
    }) : null;

    const errEl = el('p', { class: 'error-msg' });
    const btn   = el('button', { type: 'submit', class: 'btn-primary' },
      isFirst ? 'Create Vault' : 'Unlock'
    );

    // Single submit handler — validation + unlock in one place (no stopImmediatePropagation bug)
    const form = el('form', { class: 'login-form', onsubmit: async e => {
      e.preventDefault();
      const pw = pwInput.value;
      errEl.textContent = '';

      // First-run validation
      if (isFirst) {
        if (pw.length < 8) {
          errEl.textContent = 'Password must be at least 8 characters.';
          return;
        }
        if (pw !== confirmInput.value) {
          errEl.textContent = 'Passwords do not match.';
          return;
        }
      }

      if (!pw) {
        errEl.textContent = 'Please enter your master password.';
        pwInput.focus();
        return;
      }
      btn.disabled = true;
      btn.textContent = isFirst ? 'Creating…' : 'Unlocking…';
      try {
        const result = await App.unlock(pw);
        if (!result.ok) {
          errEl.textContent = '❌ Wrong password. Try again.';
          errEl.style.fontSize = '15px';
          toast('Wrong password — try again', 'error');
          btn.disabled = false;
          btn.textContent = 'Unlock';
          pwInput.value = '';
          pwInput.focus();
        }
      } catch (err) {
        errEl.textContent = 'Error: ' + err.message;
        toast('Error: ' + err.message, 'error');
        btn.disabled = false;
        btn.textContent = isFirst ? 'Create Vault' : 'Unlock';
      }
    }});

    const logo = el('div', { class: 'login-logo' }, '🔐');
    const title = el('h1', { class: 'login-title' }, 'my-vault');
    const sub   = el('p',  { class: 'login-sub' },
      isFirst ? 'Set a master password to create your vault.' : 'Enter your master password to unlock.'
    );

    form.append(pwInput);
    if (confirmInput) form.append(confirmInput);
    form.append(errEl, btn);
    root().append(logo, title, sub, form);
    pwInput.focus();
  }

  // ── Table list ────────────────────────────────────────────────────────────

  function showTableList() {
    root().innerHTML = '';

    const binCount = App.getRecycleBin().length;
    const binLabel = binCount > 0 ? `\u{1F5D1} ${binCount}` : '\u{1F5D1}';
    const header = el('header', { class: 'app-header' },
      el('span', { class: 'app-title' }, 'my-vault'),
      el('div', { class: 'header-actions' },
        el('span', { id: 'sync-status', class: 'sync-pill' }),
        el('button', {
          class: 'icon-btn' + (binCount > 0 ? ' bin-has-items' : ''),
          title: 'Recycle Bin',
          onclick: showRecycleBin
        }, binLabel),
        el('button', {
          class: 'icon-btn' + (editMode ? ' edit-active' : ''),
          title: editMode ? 'Edit Mode ON – tap to disable' : 'Edit Mode OFF – tap to enable',
          onclick: () => { editMode = !editMode; showTableList(); }
        }, '✏'),
        el('button', { class: 'icon-btn', title: 'Settings', onclick: showSettings }, '⚙'),
        el('button', { class: 'icon-btn', title: 'Lock', onclick: () => App.lock(true) }, '🔒')
      )
    );

    const searchBox = el('input', {
      type: 'search',
      class: 'search-box',
      placeholder: 'Search tables and values…',
      value: App.searchQuery,
      oninput: e => {
        App.searchQuery = e.target.value;
        renderList();
      }
    });

    const countEl = el('div', { class: 'table-count', id: 'table-count' });
    const listEl = el('ul', { class: 'table-list', id: 'table-list' });

    function renderList() {
      listEl.innerHTML = '';
      const names = App.filteredTableNames();
      const total = App.getTableNames().length;
      if (App.searchQuery.trim()) {
        countEl.textContent = `${names.length} of ${total} tables`;
      } else {
        countEl.textContent = `${total} table${total !== 1 ? 's' : ''}`;
      }
      if (!names.length) {
        listEl.appendChild(el('li', { class: 'empty-state' },
          App.searchQuery ? 'No matches.' : 'No tables yet. Add one below.'
        ));
        return;
      }
      names.forEach(name => {
        const tbl  = App.getTable(name);
        const pinned = App.isTablePinned(name);
        const meta = el('span', { class: 'tbl-meta' },
          `${tbl.columns.length} cols · ${tbl.rows.length} rows`
        );
        const pinBtn = el('button', {
          class: 'pin-btn' + (pinned ? ' pinned' : ''),
          title: pinned ? 'Unpin' : 'Pin to top',
          onclick: e => {
            e.stopPropagation();
            App.togglePinTable(name).then(renderList);
          }
        }, '\u{1F4CC}');
        const item = el('li', {
          class: 'tbl-item',
          onclick: () => showTable(name)
        },
          pinBtn,
          el('span', { class: 'tbl-name' }, name),
          meta,
          el('span', { class: 'tbl-arrow' }, '›')
        );
        listEl.appendChild(item);
      });
    }

    root().append(header, searchBox, countEl, listEl);
    if (editMode) {
      root().append(el('button', { class: 'fab', title: 'New table', onclick: promptNewTable }, '+'));
    }
    renderList();
    updateSyncStatus();
  }

  async function promptNewTable() {
    const name = window.prompt('Table name:');
    if (!name || !name.trim()) return;
    const ok = await App.createTable(name);
    if (!ok) { toast('A table with that name already exists.', 'error'); return; }
    showTable(name.trim());
  }

  // ── Table editor ──────────────────────────────────────────────────────────

  function showTable(tableName) {
    App.activeTable = tableName;
    App.logAndSave('open_table', tableName).catch(() => {});  // best-effort
    root().innerHTML = '';

    function rebuildTable() {
      const tbl = App.getTable(tableName);
      if (!tbl) { showTableList(); return; }

      // Update counter
      const countEl = document.getElementById('row-count');
      if (countEl) countEl.textContent = `${tbl.rows.length} rows · ${tbl.columns.length} cols`;

      // Grid
      const thead = el('thead');
      const hrow  = el('tr');
      hrow.appendChild(el('th', { class: 'row-num' }, '#'));
      tbl.columns.forEach((col, ci) => {
        const th = el('th', {},
          el('span', {
            class: 'col-name',
            onclick: () => promptRenameColumn(tableName, ci, col, rebuildTable)
          }, col)
        );
        if (editMode) {
          th.appendChild(el('button', {
            class: 'col-del',
            title: 'Delete column',
            onclick: () => promptDeleteColumn(tableName, ci, col, rebuildTable)
          }, '×'));
        }
        hrow.appendChild(th);
      });
      // Add-column button as last header cell (edit mode only)
      if (editMode) {
        hrow.appendChild(el('th', {},
          el('button', {
            class: 'add-col-btn',
            title: 'Add column',
            onclick: () => promptAddColumn(tableName, rebuildTable)
          }, '+')
        ));
      }
      thead.appendChild(hrow);

      const tbody = el('tbody');
      tbl.rows.forEach((row, ri) => {
        const tr = el('tr');
        if (editMode) {
          const rowActions = el('td', { class: 'row-num row-actions' });
          if (ri > 0) {
            rowActions.appendChild(el('button', {
              class: 'row-move-btn', title: 'Move up',
              onclick: () => App.moveRow(tableName, ri, ri - 1).then(rebuildTable)
            }, '\u25B2'));
            rowActions.appendChild(el('button', {
              class: 'row-move-btn', title: 'Pin to top',
              onclick: () => App.pinRowToTop(tableName, ri).then(rebuildTable)
            }, '\u{1F4CC}'));
          }
          if (ri < tbl.rows.length - 1) {
            rowActions.appendChild(el('button', {
              class: 'row-move-btn', title: 'Move down',
              onclick: () => App.moveRow(tableName, ri, ri + 1).then(rebuildTable)
            }, '\u25BC'));
          }
          rowActions.appendChild(el('button', {
            class: 'del-row-btn', title: 'Delete row',
            onclick: () => {
              if (!confirm('Delete this row?')) return;
              App.deleteRow(tableName, ri).then(rebuildTable);
            }
          }, '\u00D7'));
          tr.appendChild(rowActions);
        } else {
          tr.appendChild(el('td', { class: 'row-num' },
            el('span', { class: 'row-num-static' }, String(ri + 1))
          ));
        }
        row.forEach((cell, ci) => {
          const td = el('td');
          const colName = tbl.columns[ci] || '';
          const isSensitive = /password|pass|pwd|secret|pin|cvv|token/i.test(colName);
          const span = el('span', {
            class: 'cell-val' + (isSensitive ? ' cell-hidden' : '')
          }, isSensitive && cell ? '••••••' : cell);

          // Long-press to copy — measured in touchend (a real user gesture, no setTimeout)
          // This fixes the iOS Safari "not allowed by user agent" crash
          let touchStartTime = 0;
          let longPressTriggered = false;
          span.addEventListener('touchstart', () => {
            touchStartTime = Date.now();
            longPressTriggered = false;
          }, { passive: true });
          span.addEventListener('touchend', () => {
            if (Date.now() - touchStartTime >= 600 && cell) {
              longPressTriggered = true;
              copyToClipboard(cell);
            }
          }, { passive: true });

          if (isSensitive && cell) {
            // Tap 1 → reveal value · Tap 2 → edit (edit mode only) · Long-press → copy
            let revealed = false;
            span.title = 'Tap to reveal · Long-press to copy';
            span.addEventListener('click', () => {
              if (longPressTriggered) { longPressTriggered = false; return; }
              if (!revealed) {
                revealed = true;
                span.textContent = cell;
                span.classList.remove('cell-hidden');
              } else if (editMode) {
                beginEdit(td, span, tableName, ri, ci, isSensitive, rebuildTable);
              }
            });
          } else {
            // Non-sensitive: single click to edit (edit mode only)
            span.addEventListener('click', () => {
              if (longPressTriggered) { longPressTriggered = false; return; }
              if (editMode) beginEdit(td, span, tableName, ri, ci, isSensitive, rebuildTable);
            });
          }

          td.appendChild(span);
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });

      const existingWrap = document.getElementById('tbl-wrap');
      const newWrap = el('div', { class: 'tbl-scroll', id: 'tbl-wrap' },
        el('table', { class: 'data-tbl' }, thead, tbody)
      );
      if (existingWrap) existingWrap.replaceWith(newWrap);
      else root().appendChild(newWrap);
    }

    const tbl = App.getTable(tableName);
    const headerActions = el('div', { class: 'header-actions' },
      el('button', {
        class: 'icon-btn' + (editMode ? ' edit-active' : ''),
        title: editMode ? 'Edit Mode ON – tap to disable' : 'Edit Mode OFF – tap to enable',
        onclick: () => { editMode = !editMode; showTable(tableName); }
      }, '✏'),
      el('button', { class: 'icon-btn', title: 'Export CSV',
        onclick: () => downloadCSV(tableName) }, '⬇')
    );
    if (editMode) {
      headerActions.appendChild(el('button', { class: 'icon-btn danger', title: 'Delete table',
        onclick: () => promptDeleteTable(tableName) }, '🗑'));
    }
    const titleEl = el('span', {
      class: 'app-title tbl-title' + (editMode ? '' : ' tbl-readonly'),
      onclick: editMode ? () => promptRenameTable(tableName) : null
    }, tableName);
    const header = el('header', { class: 'app-header' },
      el('button', { class: 'back-btn', onclick: showTableList }, '‹ Back'),
      titleEl,
      headerActions
    );

    const rowCount = el('span', { class: 'row-count', id: 'row-count' }, '');

    root().append(header, rowCount);
    if (editMode) {
      root().append(el('button', {
        class: 'btn-secondary add-row-btn',
        onclick: () => App.addRow(tableName).then(rebuildTable)
      }, '+ Add Row'));
    }
    rebuildTable();
  }

  function beginEdit(td, span, tableName, ri, ci, isSensitive, rebuildFn) {
    const currentVal = App.getTable(tableName).rows[ri][ci];
    const input = el('input', {
      type: isSensitive ? 'password' : 'text',
      class: 'cell-edit',
      value: currentVal
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { td.replaceChild(span, input); }
    });
    input.addEventListener('blur', async () => {
      const newVal = input.value;
      if (newVal !== currentVal) {
        await App.updateCell(tableName, ri, ci, newVal);
        rebuildFn();
      } else {
        td.replaceChild(span, input);
      }
    });
    td.replaceChild(input, span);
    input.focus();
    input.select();
  }

  async function promptRenameTable(name) {
    const newName = window.prompt('Rename table:', name);
    if (!newName || newName === name) return;
    const ok = await App.renameTable(name, newName);
    if (!ok) toast('That name is already taken.', 'error');
    else showTable(newName.trim());
  }

  async function promptDeleteTable(name) {
    if (!confirm(`Delete table "${name}"? It will move to the Recycle Bin for 30 days.`)) return;
    await App.deleteTable(name);
    toast(`"${name}" moved to Recycle Bin.`, 'info');
    showTableList();
  }

  async function promptAddColumn(tableName, rebuildFn) {
    const name = window.prompt('New column name:');
    if (!name) return;
    await App.addColumn(tableName, name);
    rebuildFn();
  }

  async function promptRenameColumn(tableName, ci, currentName, rebuildFn) {
    const newName = window.prompt('Rename column:', currentName);
    if (!newName || newName === currentName) return;
    await App.renameColumn(tableName, ci, newName);
    rebuildFn();
  }

  async function promptDeleteColumn(tableName, ci, colName, rebuildFn) {
    if (!confirm(`Delete column "${colName}" and all its data?`)) return;
    await App.deleteColumn(tableName, ci);
    rebuildFn();
  }

  function downloadCSV(tableName) {
    const csv  = App.exportCSV(tableName);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = el('a', { href: url, download: `${tableName}.csv` });
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // ── Recycle Bin ─────────────────────────────────────────────────────────

  function showRecycleBin() {
    root().innerHTML = '';
    const header = el('header', { class: 'app-header' },
      el('button', { class: 'back-btn', onclick: showTableList }, '‹ Back'),
      el('span', { class: 'app-title' }, 'Recycle Bin')
    );
    const bin = App.getRecycleBin();
    const list = el('ul', { class: 'table-list' });

    function renderBin() {
      list.innerHTML = '';
      const items = App.getRecycleBin();
      if (!items.length) {
        list.appendChild(el('li', { class: 'empty-state' }, 'Recycle bin is empty.'));
        return;
      }
      items.forEach(entry => {
        const daysLeft = Math.max(0, Math.ceil((entry.deletedAt + 30 * 24 * 60 * 60 * 1000 - Date.now()) / 86400000));
        const dateStr = new Date(entry.deletedAt).toLocaleDateString();
        const item = el('li', { class: 'tbl-item bin-item' },
          el('div', { class: 'bin-info' },
            el('span', { class: 'tbl-name' }, entry.name),
            el('span', { class: 'tbl-meta' }, `Deleted ${dateStr} \u00B7 ${daysLeft}d left`)
          ),
          el('div', { class: 'bin-actions' },
            el('button', { class: 'btn-secondary', onclick: async () => {
              const restoredAs = await App.restoreTable(entry.deletedAt);
              if (restoredAs) {
                toast(`"${restoredAs}" restored.`, 'success');
                renderBin();
              }
            }}, 'Restore'),
            el('button', { class: 'btn-danger', onclick: async () => {
              if (!confirm(`Permanently delete "${entry.name}"? Cannot be undone.`)) return;
              await App.permanentlyDelete(entry.deletedAt);
              renderBin();
            }}, 'Delete')
          )
        );
        list.appendChild(item);
      });
    }

    root().append(header, list);
    renderBin();
  }

  // ── Settings ──────────────────────────────────────────────────────────────

  function showSettings() {
    root().innerHTML = '';
    const cfg = App.gitHubConfig();

    const header = el('header', { class: 'app-header' },
      el('button', { class: 'back-btn', onclick: showTableList }, '‹ Back'),
      el('span', { class: 'app-title' }, 'Settings')
    );

    // Activity Log section
    const logSection = el('section', { class: 'settings-section' },
      el('h2', {}, 'Activity Log')
    );
    const logs = App.getLogs().slice().reverse();  // newest first
    if (!logs.length) {
      logSection.appendChild(el('p', { class: 'settings-note' }, 'No activity yet.'));
    } else {
      const logList = el('div', { class: 'log-list' });
      let lastDateStr = '';
      const today = new Date(); today.setHours(0,0,0,0);
      const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
      logs.forEach(entry => {
        const d = new Date(entry.t);
        const dDay = new Date(d); dDay.setHours(0,0,0,0);
        let dateLabel;
        if (dDay.getTime() === today.getTime()) dateLabel = 'Today';
        else if (dDay.getTime() === yesterday.getTime()) dateLabel = 'Yesterday';
        else dateLabel = d.toLocaleDateString();
        if (dateLabel !== lastDateStr) {
          logList.appendChild(el('div', { class: 'log-date-header' }, dateLabel));
          lastDateStr = dateLabel;
        }
        const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        logList.appendChild(el('div', { class: 'log-entry' },
          el('span', { class: 'log-time' }, timeStr),
          el('span', { class: 'log-desc' }, formatLogEntry(entry))
        ));
      });
      logSection.appendChild(logList);
    }

    // GitHub section
    const ghSection = el('section', { class: 'settings-section' },
      el('h2', {}, 'GitHub Sync')
    );

    if (cfg) {
      ghSection.append(
        el('p', { class: 'settings-note' }, `Connected: ${cfg.owner}/${cfg.repo}`),
        el('button', { class: 'btn-danger', onclick: () => {
          if (!confirm('Disconnect GitHub? Vault stays local.')) return;
          App.clearGitHub();
          toast('GitHub disconnected.', 'info');
          showSettings();
        }}, 'Disconnect GitHub')
      );
    } else {
      const ownerIn = el('input', { type: 'text', placeholder: 'GitHub username', class: 'settings-input' });
      const repoIn  = el('input', { type: 'text', placeholder: 'Repo name (e.g. my-vault)', class: 'settings-input' });
      const tokenIn = el('input', { type: 'password', placeholder: 'Personal Access Token', class: 'settings-input', autocomplete: 'off' });
      const ghErr   = el('p', { class: 'error-msg' });
      const ghBtn   = el('button', { class: 'btn-primary', onclick: async () => {
        ghBtn.disabled = true;
        ghBtn.textContent = 'Testing…';
        const ok = await App.setupGitHub(ownerIn.value, repoIn.value, tokenIn.value);
        if (ok) {
          toast('GitHub connected and vault pushed!', 'success');
          showSettings();
        } else {
          ghErr.textContent = 'Could not connect. Check username, repo name, and token.';
          ghBtn.disabled = false;
          ghBtn.textContent = 'Connect';
        }
      }}, 'Connect');
      const helpLink = el('a', {
        href: 'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-fine-grained-personal-access-token',
        target: '_blank',
        class: 'settings-link'
      }, 'How to create a token ↗');
      ghSection.append(
        el('p', { class: 'settings-note' }, 'Connect a private GitHub repo to sync your vault across devices.'),
        ownerIn, repoIn, tokenIn, ghErr, ghBtn, helpLink
      );
    }

    // Backup section
    const todayStr = new Date().toISOString().split('T')[0];
    const backupSection = el('section', { class: 'settings-section' },
      el('h2', {}, 'Backup'),
      el('p', { class: 'settings-note' },
        'Downloads ALL your tables as one file. Save it to iCloud Drive or Files app as a backup. ⚠️ This file is not encrypted — keep it private.'
      ),
      el('button', { class: 'btn-secondary', onclick: () => {
        const json = App.exportAllJSON();
        const blob = new Blob([json], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = el('a', { href: url, download: `vault-backup-${todayStr}.json` });
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        toast('Backup downloaded — store it somewhere safe.', 'success');
      }}, '⬇ Download All Tables'),
      el('p', { class: 'settings-note' }, 'To restore from a backup file, pick it below then tap Restore.'),
      el('input', { type: 'file', accept: '.json', class: 'settings-input', id: 'restore-file-input' }),
      el('button', { class: 'btn-secondary', onclick: async () => {
        const fileIn = document.getElementById('restore-file-input');
        const f = fileIn.files[0];
        if (!f) { toast('Pick a backup .json file first.', 'error'); return; }
        if (!confirm('This will REPLACE all current tables with the backup. Continue?')) return;
        const text = await f.text();
        const ok = await App.importAllJSON(text);
        if (ok) { toast('Vault restored from backup!', 'success'); showTableList(); }
        else toast('Invalid backup file.', 'error');
      }}, '⬆ Restore from Backup')
    );

    // Import CSV section
    const importSection = el('section', { class: 'settings-section' },
      el('h2', {}, 'Import from Excel / CSV'),
      el('p', { class: 'settings-note' },
        'Export each Excel table as CSV (File → Save As → CSV), then import here.'
      )
    );
    const tableNameIn = el('input', { type: 'text', placeholder: 'Table name (leave blank to use CSV filename)', class: 'settings-input' });
    const fileIn      = el('input', { type: 'file', accept: '.csv', class: 'settings-input', multiple: true });
    const importBtn   = el('button', { class: 'btn-primary', onclick: async () => {
      const files = Array.from(fileIn.files);
      if (!files.length) { toast('Pick a CSV file first.', 'error'); return; }
      let imported = 0;
      for (const f of files) {
        const text = await f.text();
        const name = tableNameIn.value.trim() || f.name.replace(/\.csv$/i, '');
        const ok   = await App.importCSV(name, text);
        if (ok) imported++;
      }
      toast(`Imported ${imported} table(s).`, 'success');
      tableNameIn.value = '';
      fileIn.value = '';
    }}, 'Import CSV');
    importSection.append(tableNameIn, fileIn, importBtn);

    // Change password section
    const pwSection = el('section', { class: 'settings-section' },
      el('h2', {}, 'Change Master Password')
    );
    const oldPw  = el('input', { type: 'password', placeholder: 'Current password', class: 'settings-input', autocomplete: 'off' });
    const newPw  = el('input', { type: 'password', placeholder: 'New password (min 8 chars)', class: 'settings-input', autocomplete: 'new-password' });
    const newPw2 = el('input', { type: 'password', placeholder: 'Confirm new password', class: 'settings-input', autocomplete: 'new-password' });
    const pwErr  = el('p', { class: 'error-msg' });
    const pwBtn  = el('button', { class: 'btn-primary', onclick: async () => {
      pwErr.textContent = '';
      if (newPw.value !== newPw2.value) { pwErr.textContent = 'New passwords do not match.'; return; }
      if (newPw.value.length < 8) { pwErr.textContent = 'Password must be at least 8 characters.'; return; }
      // Verify old password by trying to decrypt
      const payload = Storage.loadLocal();
      if (!payload) { pwErr.textContent = 'No vault found.'; return; }
      const ok = await Crypto.verify(payload, oldPw.value);
      if (!ok) { pwErr.textContent = 'Current password is wrong.'; return; }
      // Re-encrypt with new password — inject change_pw log into vault JSON
      const json = await Crypto.decrypt(payload, oldPw.value);
      const parsed = JSON.parse(json);
      if (!parsed.logs) parsed.logs = [];
      parsed.logs.push({ t: Date.now(), a: 'change_pw' });
      const newPayload = await Crypto.encrypt(JSON.stringify(parsed), newPw.value);
      await Storage.save(newPayload);
      // Update in-memory state by re-unlocking — use internal hack: call lock then unlock
      App.lock(true);
      toast('Password changed. Please unlock with your new password.', 'success');
    }}, 'Change Password');
    pwSection.append(oldPw, newPw, newPw2, pwErr, pwBtn);

    root().append(header, logSection, ghSection, backupSection, importSection, pwSection);
  }

  // ── Public ────────────────────────────────────────────────────────────────

  return { showLogin, showTableList, showTable, showSettings, updateSyncStatus, toast };
})();
