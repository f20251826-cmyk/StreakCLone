/* ──────────────────────────────────────
   Stroke — Multi-User Gmail Frontend
   Uses Google OAuth2 + Gmail API directly.
   No backend server needed.
   ────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', () => {

  /* ── Element refs ── */
  const $ = id => document.getElementById(id);
  const btnSignIn     = $('btn-signin');
  const btnSignOut    = $('btn-signout');
  const signedOutView = $('signed-out-view');
  const signedInView  = $('signed-in-view');
  const userAvatar    = $('user-avatar');
  const userName      = $('user-name');
  const userEmailEl   = $('user-email');
  const actionSel     = $('action-select');
  const csvInput      = $('csv-file');
  const dropZone      = $('file-drop-zone');
  const dropText      = $('file-drop-text');
  const detectedVars  = $('detected-vars');
  const varChips      = $('var-chips');
  const subjectGroup  = $('subject-group');
  const bodyGroup     = $('body-group');
  const subjectTpl    = $('subject-tpl');
  const bodyTpl       = $('body-tpl');
  const sigSelect     = $('signature-select');
  const btnManageSig  = $('btn-manage-sig');
  const previewPane   = $('preview-pane');
  const previewCount  = $('preview-counter');
  const btnPrev       = $('prev-row');
  const btnNext       = $('next-row');
  const btnSend       = $('btn-send');
  const btnDownload   = $('btn-download');
  const progressArea  = $('progress-area');
  const progressFill  = $('progress-fill');
  const progressText  = $('progress-text');
  const resultsArea   = $('results-area');
  const resultsThead  = $('results-thead');
  const resultsTbody  = $('results-tbody');
  
  // Modal Elements
  const sigModal      = $('sig-modal');
  const sigList       = $('sig-list');
  const sigName       = $('sig-name');
  const sigContent    = $('sig-content');
  const sigEditId     = $('sig-edit-id');
  const btnSaveSig    = $('btn-save-sig');
  const btnCancelEditSig = $('btn-cancel-edit-sig');
  const btnCloseSigModal = $('btn-close-sig-modal');
  const sigEditorTitle= $('sig-editor-title');

  /* ── Auth State & Cookie Parsing ── */
  let userSignatures = [];
  let csvRaw = null;
  let headers = [];
  let rows = [];
  let previewIdx = 0;
  let logs = [];

  function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
  }

  function parseJwt(token) {
    try {
      return JSON.parse(atob(token.split('.')[1]));
    } catch (e) { return null; }
  }

  const strokeToken = getCookie('stroke_token');
  const user = strokeToken ? parseJwt(strokeToken) : null;


  if (user) {
    userName.textContent = user.name || 'User';
    userEmailEl.textContent = user.email || '';
    userAvatar.src = user.avatar || '';

    signedOutView.style.display = 'none';
    signedInView.style.display = 'flex';
    btnSend.disabled = false;

    // Load saved signatures
    fetchSignatures();

  } else {
    signedOutView.style.display = 'block';
    signedInView.style.display = 'none';
    btnSend.disabled = true;
  }

  btnSignOut.addEventListener('click', () => {
    document.cookie = 'stroke_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    window.location.href = '/'; // Reload
  });

  /* ──────────────────────────────────
     CSV Parsing (handles quoted fields)
     ────────────────────────────────── */

  function parseCSV(text) {
    const result = [];
    let row = [];
    let inQuote = false;
    let field = '';

    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuote) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') { inQuote = false; }
        else { field += c; }
      } else {
        if (c === '"') { inQuote = true; }
        else if (c === ',') { row.push(field.trim()); field = ''; }
        else if (c === '\n' || (c === '\r' && text[i + 1] === '\n')) {
          row.push(field.trim());
          if (row.some(f => f !== '')) result.push(row);
          row = []; field = '';
          if (c === '\r') i++;
        } else { field += c; }
      }
    }
    row.push(field.trim());
    if (row.some(f => f !== '')) result.push(row);
    return result;
  }

  function loadCSV(text) {
    csvRaw = text;
    const parsed = parseCSV(text);
    if (parsed.length < 2) { alert('CSV must have a header + at least one data row.'); return; }
    headers = parsed[0];
    rows = parsed.slice(1);
    previewIdx = 0;

    varChips.innerHTML = '';
    headers.forEach(h => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = `{{${h}}}`;
      chip.title = 'Click to insert into body';
      chip.addEventListener('click', () => { bodyTpl.value += `{{${h}}}`; bodyTpl.focus(); renderPreview(); });
      varChips.appendChild(chip);
    });
    detectedVars.style.display = 'flex';
    dropText.innerHTML = `<strong>${headers.length}</strong> columns · <strong>${rows.length}</strong> rows loaded`;
    renderPreview();
  }

  /* ──────────────────────────────────
     Drag & Drop
     ────────────────────────────────── */
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('dragover'); if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); });
  csvInput.addEventListener('change', e => { if (e.target.files[0]) readFile(e.target.files[0]); });
  function readFile(file) { const r = new FileReader(); r.onload = ev => loadCSV(ev.target.result); r.readAsText(file); }

  /* ──────────────────────────────────
     Variable Engine (case-insensitive)
     ────────────────────────────────── */
  function replaceVars(template, row) {
    let out = template;
    headers.forEach((h, i) => {
      const rx = new RegExp('\\{\\{\\s*' + escapeRegex(h) + '\\s*\\}\\}', 'gi');
      out = out.replace(rx, row[i] || '');
    });
    return out;
  }
  function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /* ──────────────────────────────────
     Preview
     ────────────────────────────────── */
  function renderPreview() {
    if (!rows.length) return;
    const row = rows[previewIdx];
    const subj = replaceVars(subjectTpl.value || '(no subject)', row);
    let bodyRaw = bodyTpl.value || '';
    
    // Get Selected Signature
    let sigRaw = '';
    const selectedSigId = sigSelect.value;
    if (selectedSigId) {
      const sigObj = userSignatures.find(s => s.id === selectedSigId);
      if (sigObj) sigRaw = sigObj.content;
    }

    if (sigRaw) bodyRaw += '\n\n' + sigRaw;

    let body = replaceVars(bodyRaw, row);
    if (body) {
      body = body.replace(/\n/g, '<br/>');
      body = body.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;" />');
      body = body.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" style="color:var(--primary);text-decoration:underline;">$1</a>');
    }
    previewPane.innerHTML = `
      <div class="preview-subject">Subject: ${escapeHtml(subj)}</div>
      <div class="preview-body">${body || '<em style="opacity:.4">Body is empty</em>'}</div>
    `;
    previewCount.textContent = `${previewIdx + 1} / ${rows.length}`;
    btnPrev.disabled = previewIdx <= 0;
    btnNext.disabled = previewIdx >= rows.length - 1;
  }
  function escapeHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  btnPrev.addEventListener('click', () => { if (previewIdx > 0) { previewIdx--; renderPreview(); } });
  btnNext.addEventListener('click', () => { if (previewIdx < rows.length - 1) { previewIdx++; renderPreview(); } });
  subjectTpl.addEventListener('input', renderPreview);
  bodyTpl.addEventListener('input', renderPreview);
  sigSelect.addEventListener('change', renderPreview);

  /* ──────────────────────────────────
     Multi-Signature Management
     ────────────────────────────────── */
  function fetchSignatures() {
    fetch('/api/users/signatures', { headers: { 'cookie': document.cookie } })
      .then(r => r.json())
      .then(data => {
        userSignatures = data || [];
        // Populate select
        const currentSelection = sigSelect.value;
        sigSelect.innerHTML = '<option value="">-- No Signature --</option>';
        userSignatures.forEach(s => {
          const opt = document.createElement('option');
          opt.value = s.id;
          opt.textContent = s.name;
          sigSelect.appendChild(opt);
        });
        if (currentSelection && userSignatures.some(s => s.id === currentSelection)) {
          sigSelect.value = currentSelection;
        } else if (userSignatures.length > 0) {
          sigSelect.value = userSignatures[0].id;
        }
        renderPreview();
        renderSigList();
      }).catch(console.error);
  }

  function renderSigList() {
    if (!userSignatures.length) {
      sigList.innerHTML = '<li style="opacity:0.5;">No signatures found. Create one below!</li>';
      return;
    }
    sigList.innerHTML = userSignatures.map(s => `
      <li style="display:flex; justify-content:space-between; align-items:center; padding:0.5rem; border-bottom:1px solid var(--border-color);">
        <strong>${escapeHtml(s.name)}</strong>
        <div>
          <button class="btn btn-ghost btn-sm" onclick="window.editSig('${s.id}')">Edit</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--danger);" onclick="window.deleteSig('${s.id}')">Delete</button>
        </div>
      </li>
    `).join('');
  }

  btnManageSig.addEventListener('click', () => {
    sigModal.style.display = 'block';
    resetSigForm();
  });
  
  btnCloseSigModal.addEventListener('click', () => {
    sigModal.style.display = 'none';
  });

  window.editSig = (id) => {
    const s = userSignatures.find(x => x.id === id);
    if (!s) return;
    sigEditId.value = s.id;
    sigName.value = s.name;
    sigContent.value = s.content;
    sigEditorTitle.textContent = 'Edit Signature';
    btnCancelEditSig.style.display = 'inline-block';
  };

  window.deleteSig = (id) => {
    if (!confirm('Are you sure you want to delete this signature?')) return;
    fetch('/api/users/signatures', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    }).then(() => fetchSignatures());
  };

  btnCancelEditSig.addEventListener('click', resetSigForm);

  function resetSigForm() {
    sigEditId.value = '';
    sigName.value = '';
    sigContent.value = '';
    sigEditorTitle.textContent = 'Add New Signature';
    btnCancelEditSig.style.display = 'none';
  }

  btnSaveSig.addEventListener('click', () => {
    const name = sigName.value.trim();
    const content = sigContent.value.trim();
    if (!name || !content) return alert('Name and Content are required');
    
    btnSaveSig.disabled = true;
    fetch('/api/users/signatures', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: sigEditId.value || undefined, name, content })
    })
    .then(() => {
      resetSigForm();
      fetchSignatures();
    })
    .catch(err => alert('Error saving signature: ' + err.message))
    .finally(() => btnSaveSig.disabled = false);
  });

  /* ──────────────────────────────────
     Action toggle
     ────────────────────────────────── */
  actionSel.addEventListener('change', () => {
    const v = actionSel.value;
    subjectGroup.style.display = v === 'bulkSend' ? '' : 'none';
    bodyGroup.style.display = v === 'checkReplies' ? 'none' : '';
    const label = { bulkSend: 'Send Emails', threadedFollowup: 'Send Follow-ups', checkReplies: 'Check Replies' }[v];
    btnSend.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2 11 13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
      ${label}
    `;
  });

  /* ──────────────────────────────────
     Schedule Campaign via Backend
     ────────────────────────────────── */

  btnSend.addEventListener('click', async () => {
    if (!user) { alert('Please sign in with Google first.'); return; }
    if (!rows.length) { alert('Upload a CSV file first.'); return; }

    const action = actionSel.value;
    const scheduleInput = $('schedule-time').value;
    const scheduledAt = scheduleInput ? new Date(scheduleInput).toISOString() : new Date().toISOString();

    btnSend.disabled = true;
    progressArea.style.display = 'block';
    resultsArea.style.display = 'none';
    btnDownload.style.display = 'none';
    progressFill.style.background = '';
    progressFill.style.width = '30%';
    progressText.textContent = scheduleInput ? 'Scheduling campaign...' : 'Sending to queue...';

    try {
      let attachSig = '';
      const selectedSigId = sigSelect.value;
      if (selectedSigId) {
        const sigObj = userSignatures.find(s => s.id === selectedSigId);
        if (sigObj) attachSig = sigObj.content;
      }
      
      const fullBody = bodyTpl.value + (attachSig ? '\n\n' + attachSig : '');
      const payload = {
        action,
        subjectTemplate: subjectTpl.value,
        bodyTemplate: fullBody,
        csvData: rows,
        headers: headers,
        scheduledAt
      };

      const res = await fetch('/api/campaigns/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Server error');

      progressFill.style.width = '100%';
      progressText.textContent = `✅ Success! ${data.count} emails queued/scheduled.`;
      
      const msg = scheduleInput 
        ? `Campaign successfully scheduled for ${new Date(scheduleInput).toLocaleString()}.\n\nThe server will run automatically in the background — you can safely close this tab.` 
        : 'Campaign added to the queue! Processing them immediately...';
        
      alert(msg);

      // If scheduled for "right now", trigger the processing worker immediately!
      if (!scheduleInput) {
         fetch('/api/cron/process').catch(e => console.error('Immediate processing trigger info:', e));
      }

    } catch (err) {
      progressFill.style.width = '100%';
      progressFill.style.background = 'var(--danger)';
      progressText.textContent = '❌ Error: ' + err.message;
    } finally {
      btnSend.disabled = false;
    }
  });

  /* ──────────────────────────────────
     Helpers
     ────────────────────────────────── */

  function findCol(fragment) {
    return headers.findIndex(h => h.trim().toLowerCase().includes(fragment.toLowerCase()));
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  /* ──────────────────────────────────
     Results table
     ────────────────────────────────── */
  function renderResults(data) {
    if (!data.length) return;
    resultsArea.style.display = 'block';
    const keys = Object.keys(data[0]);
    resultsThead.innerHTML = keys.map(k => `<th>${k}</th>`).join('');
    resultsTbody.innerHTML = data.map(row =>
      '<tr>' + keys.map(k => {
        const val = row[k] ?? '';
        let cls = '';
        if (k === 'status') cls = `status-${val}`;
        return `<td class="${cls}">${val}</td>`;
      }).join('') + '</tr>'
    ).join('');
  }

  /* ──────────────────────────────────
     Download success log
     ────────────────────────────────── */
  btnDownload.addEventListener('click', () => {
    if (!logs.length) return;
    const keys = Object.keys(logs[0]);
    const csv = [
      keys.join(','),
      ...logs.map(r => keys.map(k => `"${String(r[k] || '').replace(/"/g, '""')}"`).join(','))
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `stroke_log_${Date.now()}.csv`;
    a.click();
  });

});
