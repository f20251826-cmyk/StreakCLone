/* ──────────────────────────────────────
   StreakClone — Multi-User Gmail Frontend
   Uses Google OAuth2 + Gmail API directly.
   No backend server needed.
   ────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', () => {

  /* ── Element refs ── */
  const $ = id => document.getElementById(id);
  const clientIdInput = $('client-id-input');
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

  /* ── State ── */
  let accessToken = null;
  let tokenClient = null;
  let csvRaw = null;
  let headers = [];
  let rows = [];
  let previewIdx = 0;
  let logs = [];

  /* ──────────────────────────────────
     Google OAuth2 (Token Model)
     ────────────────────────────────── */

  btnSignIn.addEventListener('click', () => {
    const clientId = clientIdInput.value.trim();
    if (!clientId) {
      alert('Please enter your Google OAuth Client ID first.');
      return;
    }

    // Save client ID for convenience
    localStorage.setItem('streakclone_client_id', clientId);

    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email',
      callback: handleTokenResponse,
    });

    tokenClient.requestAccessToken();
  });

  // Restore saved client ID
  const savedClientId = localStorage.getItem('streakclone_client_id');
  if (savedClientId) clientIdInput.value = savedClientId;

  function handleTokenResponse(resp) {
    if (resp.error) {
      console.error('OAuth error:', resp);
      alert('Sign-in failed: ' + (resp.error_description || resp.error));
      return;
    }
    accessToken = resp.access_token;
    fetchUserInfo();
  }

  async function fetchUserInfo() {
    try {
      const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: 'Bearer ' + accessToken }
      });
      const info = await res.json();

      userName.textContent = info.name || 'User';
      userEmailEl.textContent = info.email || '';
      userAvatar.src = info.picture || '';

      signedOutView.style.display = 'none';
      signedInView.style.display = 'flex';
      btnSend.disabled = false;
    } catch (e) {
      console.error('Failed to fetch user info:', e);
    }
  }

  btnSignOut.addEventListener('click', () => {
    if (accessToken) {
      google.accounts.oauth2.revoke(accessToken);
    }
    accessToken = null;
    signedOutView.style.display = 'block';
    signedInView.style.display = 'none';
    btnSend.disabled = true;
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
    const body = replaceVars(bodyTpl.value || '', row);
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
     Gmail API — Direct REST Calls
     ────────────────────────────────── */

  // Build RFC 2822 raw email
  function buildRawEmail(to, subject, htmlBody, extraHeaders = {}) {
    const boundary = 'streak_' + Date.now();
    let parts = [];

    parts.push('MIME-Version: 1.0');
    parts.push(`To: ${to}`);
    parts.push(`Subject: ${subject}`);

    // Extra headers (In-Reply-To, References, etc.)
    for (const [key, val] of Object.entries(extraHeaders)) {
      if (val) parts.push(`${key}: ${val}`);
    }

    parts.push('Content-Type: text/html; charset=UTF-8');
    parts.push('');
    parts.push(htmlBody);

    const raw = parts.join('\r\n');
    // base64url encode
    return btoa(unescape(encodeURIComponent(raw)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  // Send a single email via Gmail API
  async function gmailSend(to, subject, htmlBody, threadId = null, extraHeaders = {}) {
    const raw = buildRawEmail(to, subject, htmlBody, extraHeaders);
    const body = { raw };
    if (threadId) body.threadId = threadId;

    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error?.message || `HTTP ${res.status}`);
    }
    return res.json();
  }

  // Get message headers (to extract Message-ID)
  async function gmailGetMessage(msgId) {
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=metadata&metadataHeaders=Message-ID`,
      { headers: { Authorization: 'Bearer ' + accessToken } }
    );
    if (!res.ok) return null;
    return res.json();
  }

  // Get thread messages (for reply detection)
  async function gmailGetThread(threadId) {
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=metadata&metadataHeaders=From`,
      { headers: { Authorization: 'Bearer ' + accessToken } }
    );
    if (!res.ok) return null;
    return res.json();
  }

  function extractHeader(msg, headerName) {
    if (!msg?.payload?.headers) return '';
    const h = msg.payload.headers.find(h => h.name.toLowerCase() === headerName.toLowerCase());
    return h ? h.value : '';
  }

  /* ──────────────────────────────────
     Send / Follow-up / Check Replies
     ────────────────────────────────── */

  btnSend.addEventListener('click', async () => {
    if (!accessToken) { alert('Please sign in with Google first.'); return; }
    if (!rows.length) { alert('Upload a CSV file first.'); return; }

    const action = actionSel.value;

    btnSend.disabled = true;
    progressArea.style.display = 'block';
    resultsArea.style.display = 'none';
    btnDownload.style.display = 'none';
    progressFill.style.background = '';
    logs = [];

    try {
      if (action === 'bulkSend') {
        await doBulkSend();
      } else if (action === 'threadedFollowup') {
        await doThreadedFollowup();
      } else if (action === 'checkReplies') {
        await doCheckReplies();
      }

      progressFill.style.width = '100%';
      progressText.textContent = `✅ Done — ${logs.length} records processed.`;
      renderResults(logs);
      btnDownload.style.display = 'inline-flex';
    } catch (err) {
      progressFill.style.width = '100%';
      progressFill.style.background = 'var(--danger)';
      progressText.textContent = '❌ Error: ' + err.message;
    } finally {
      btnSend.disabled = false;
    }
  });

  async function doBulkSend() {
    const emailIdx = findCol('email');
    if (emailIdx === -1) throw new Error("CSV must contain an 'email' column.");

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const to = (row[emailIdx] || '').trim();
      if (!to) continue;

      const pct = Math.round(((i + 1) / rows.length) * 100);
      progressFill.style.width = pct + '%';
      progressText.textContent = `Sending ${i + 1} of ${rows.length}…`;

      const subject = replaceVars(subjectTpl.value, row);
      const body = replaceVars(bodyTpl.value, row);

      try {
        const result = await gmailSend(to, subject, body);

        // Get the RFC Message-ID for threading
        let rfcMessageId = '';
        const msgData = await gmailGetMessage(result.id);
        if (msgData) rfcMessageId = extractHeader(msgData, 'Message-ID');

        logs.push({
          email: to,
          subject,
          threadId: result.threadId,
          messageId: result.id,
          rfcMessageId,
          status: 'sent'
        });
      } catch (err) {
        logs.push({ email: to, status: 'error', error: err.message });
      }

      // Small delay to avoid rate-limits
      await sleep(300);
    }
  }

  async function doThreadedFollowup() {
    const emailIdx   = findCol('email');
    const threadIdx  = findCol('threadid');
    const rfcIdx     = findCol('rfcmessageid');
    const subjectIdx = findCol('subject');

    if (emailIdx === -1 || threadIdx === -1)
      throw new Error("CSV must have 'email' and 'threadId' columns.");

    const myEmail = userEmailEl.textContent.toLowerCase();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const to       = (row[emailIdx]  || '').trim();
      const threadId = (row[threadIdx] || '').trim();
      const rfcRef   = rfcIdx !== -1 ? (row[rfcIdx] || '').trim() : '';
      const subject  = subjectIdx !== -1 ? (row[subjectIdx] || '').trim() : 'Follow up';
      if (!to || !threadId) continue;

      const pct = Math.round(((i + 1) / rows.length) * 100);
      progressFill.style.width = pct + '%';
      progressText.textContent = `Processing ${i + 1} of ${rows.length}…`;

      // Check for replies (auto-stop)
      const hasReply = await checkThreadForReply(threadId, myEmail);
      if (hasReply) {
        logs.push({ email: to, threadId, status: 'skipped_replied' });
        continue;
      }

      const body = replaceVars(bodyTpl.value, row);

      try {
        const result = await gmailSend(to, 'Re: ' + subject, body, threadId, {
          'In-Reply-To': rfcRef,
          'References': rfcRef
        });
        logs.push({ email: to, threadId, newMessageId: result.id, status: 'followed_up' });
      } catch (err) {
        logs.push({ email: to, threadId, status: 'error', error: err.message });
      }
      await sleep(300);
    }
  }

  async function doCheckReplies() {
    const threadIdx = findCol('threadid');
    const emailIdx  = findCol('email');
    if (threadIdx === -1) throw new Error("CSV must have a 'threadId' column.");

    const myEmail = userEmailEl.textContent.toLowerCase();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const threadId = (row[threadIdx] || '').trim();
      const email    = emailIdx !== -1 ? (row[emailIdx] || '').trim() : '';
      if (!threadId) continue;

      const pct = Math.round(((i + 1) / rows.length) * 100);
      progressFill.style.width = pct + '%';
      progressText.textContent = `Checking ${i + 1} of ${rows.length}…`;

      const hasReply = await checkThreadForReply(threadId, myEmail);
      logs.push({ email, threadId, replied: hasReply ? 'Yes' : 'No' });
      await sleep(100);
    }
  }

  async function checkThreadForReply(threadId, myEmail) {
    try {
      const thread = await gmailGetThread(threadId);
      if (!thread || !thread.messages || thread.messages.length <= 1) return false;

      for (let i = 1; i < thread.messages.length; i++) {
        const from = extractHeader(thread.messages[i], 'From').toLowerCase();
        if (!from.includes(myEmail)) return true; // Reply from someone else
      }
    } catch (_) {}
    return false;
  }

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
    a.download = `streakclone_log_${Date.now()}.csv`;
    a.click();
  });

});
