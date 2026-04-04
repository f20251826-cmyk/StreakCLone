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
  const followupConfig = $('followup-config');
  const followupCount = $('followup-count');
  const followupList = $('followup-list');
  const csvInput      = $('csv-file');
  const dropZone      = $('file-drop-zone');
  const dropText      = $('file-drop-text');
  const detectedVars  = $('detected-vars');
  const varChips      = $('var-chips');
  const subjectGroup  = $('subject-group');
  const bodyGroup     = $('body-group');
  const subjectTpl    = $('subject-tpl');
  const bodyEditor    = $('body-editor');
  const bodyToolbar   = $('body-toolbar');
  const sigSelect     = $('signature-select');
  const btnManageSig  = $('btn-manage-sig');
  const previewPane   = $('preview-pane');
  const previewCount  = $('preview-counter');
  const btnPrev       = $('prev-row');
  const btnNext       = $('next-row');
  const btnSend       = $('btn-send');
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
  const sigToolbar    = $('sig-toolbar');
  const sigEditId     = $('sig-edit-id');
  const btnSaveSig    = $('btn-save-sig');
  const btnCancelEditSig = $('btn-cancel-edit-sig');
  const btnCloseSigModal = $('btn-close-sig-modal');
  const sigEditorTitle= $('sig-editor-title');
  
  const manageSection = $('manage-section');
  const campaignsTbody = $('campaigns-tbody');
  const editCampModal = $('edit-campaign-modal');
  const btnCloseEditModal = $('btn-close-edit-modal');
  const editCampId = $('edit-camp-id');
  const editCampSubject = $('edit-camp-subject');
  const editCampBody = $('edit-camp-body');
  const editCampToolbar = $('edit-camp-toolbar');
  const btnSaveCampaign = $('btn-save-campaign');
  const btnCancelCampaign = $('btn-cancel-campaign');
  const editCampStatus = $('edit-camp-status');
  
  const editCampFollowupsContainer = $('edit-camp-followups-container');
  const editCampFollowupsList = $('edit-camp-followups-list');
  let currentEditFollowups = [];

  /* ── Auth State & Cookie Parsing ── */
  let userSignatures = [];
  let csvRaw = null;
  let headers = [];
  let rows = [];
  let previewIdx = 0;
  let logs = [];
  let followupDrafts = [];
  let lastFocusedInput = null;

  document.addEventListener('focusin', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
      lastFocusedInput = e.target;
    }
  });

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

  let bgWorkerInterval = null;

  if (user) {
    userName.textContent = user.name || 'User';
    userEmailEl.textContent = user.email || '';
    userAvatar.src = user.avatar || '';

    signedOutView.style.display = 'none';
    signedInView.style.display = 'flex';
    btnSend.disabled = false;

    // Load saved signatures
    fetchSignatures();
    fetchCampaigns();
    startBackgroundWorker();
    
    document.getElementById('bg-worker-status').style.display = 'inline-flex';
    manageSection.style.display = 'block';

  } else {
    signedOutView.style.display = 'block';
    signedInView.style.display = 'none';
    btnSend.disabled = true;
    document.getElementById('bg-worker-status').style.display = 'none';
  }

  function startBackgroundWorker() {
    if (bgWorkerInterval) return;
    fetch('/api/cron/process').catch(() => {}); // trigger once immediately on load
    bgWorkerInterval = setInterval(() => {
      fetch('/api/cron/process').catch(e => console.error('Auto CRON error:', e));
    }, 60000); // exactly every 60 seconds
  }

  btnSignOut.addEventListener('click', () => {
    document.cookie = 'stroke_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    window.location.href = '/'; // Reload
  });

  // Sign in via backend OAuth route. If backend is not running, show a clear error.
  btnSignIn?.addEventListener('click', async () => {
    btnSignIn.disabled = true;
    try {
      const res = await fetch('/api/auth/login', { method: 'GET', redirect: 'manual' });
      if (res.status === 404 || res.status === 500) {
        throw new Error('Auth API is not available on this host');
      }
      window.location.href = '/api/auth/login';
    } catch (err) {
      alert(
        'Google Sign-In backend is not reachable.\n\n' +
        'You are likely running only static files (python server).\n' +
        'Run this app with its API routes (Vercel/Node) and set OAuth env vars:\n' +
        'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SUPABASE_URL, SUPABASE_KEY, JWT_SECRET.'
      );
    } finally {
      btnSignIn.disabled = false;
    }
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
        else if (c === '\n' || c === '\r') {
          row.push(field.trim());
          if (row.some(f => f !== '')) result.push(row);
          row = []; field = '';
          if (c === '\r' && text[i + 1] === '\n') i++;
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
      chip.title = 'Click to insert into the email body';
      chip.addEventListener('click', () => insertVariableToken(`{{${h}}}`));
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
  csvInput.addEventListener('change', e => { 
    if (e.target.files[0]) {
      readFile(e.target.files[0]); 
      e.target.value = ''; 
    }
  });
  function readFile(file) { const r = new FileReader(); r.onload = ev => loadCSV(ev.target.result); r.readAsText(file); }

  /* ──────────────────────────────────
     Variable Engine (case-insensitive)
     ────────────────────────────────── */
  function replaceVars(template, row) {
    let out = template || '';
    out = out.replace(/<span[^>]*class="email-var"[^>]*>(.*?)<\/span>/gi, '$1');
    headers.forEach((h, i) => {
      const rx = new RegExp('\\{\\{\\s*' + escapeRegex(h) + '\\s*\\}\\}', 'gi');
      out = out.replace(rx, row[i] || '');
    });
    return out;
  }
  function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function cleanPasteHtml(html, text) {
    if (!html) return escapeHtml(text).replace(/\n/g, '<br/>');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const allowed = ['A', 'B', 'STRONG', 'I', 'EM', 'U', 'BR', 'P', 'UL', 'OL', 'LI', 'DIV', 'SPAN', 'IMG', 'TABLE', 'TBODY', 'THEAD', 'TR', 'TD', 'TH', 'CODE', 'PRE', 'BLOCKQUOTE'];
    const nodes = Array.from(doc.body.getElementsByTagName('*')).reverse();
    
    for (const node of nodes) {
      if (node.tagName === 'SCRIPT' || node.tagName === 'STYLE') {
        node.parentNode.removeChild(node);
      } else if (!allowed.includes(node.tagName)) {
        while (node.firstChild) node.parentNode.insertBefore(node.firstChild, node);
        node.parentNode.removeChild(node);
      } else {
        const allowedAttrs = ['style', 'href', 'src', 'alt', 'width', 'height', 'cellpadding', 'cellspacing', 'border', 'valign', 'align'];
        for (const attr of Array.from(node.attributes)) {
          if (!allowedAttrs.includes(attr.name.toLowerCase())) {
            node.removeAttribute(attr.name);
          }
        }
      }
    }
    return doc.body.innerHTML || escapeHtml(text).replace(/\n/g, '<br/>');
  }

  function markdownToHtml(text) {
    if (!text) return '';
    let html = escapeHtml(String(text).replace(/\r\n/g, '\n'));
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;" />');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    return html.replace(/\n/g, '<br/>');
  }

  function isEmptyRichHtml(html) {
    const normalized = (html || '')
      .replace(/<br\s*\/?>/gi, '')
      .replace(/&nbsp;/gi, '')
      .replace(/<p>\s*<\/p>/gi, '')
      .trim();
    return !normalized;
  }

  function getBodyTemplateHtml() {
    const raw = bodyEditor?.innerHTML || '';
    return isEmptyRichHtml(raw) ? '' : raw;
  }

  function getEditorHtml(editor) {
    if (!editor) return '';
    const raw = editor.innerHTML || '';
    return isEmptyRichHtml(raw) ? '' : raw;
  }

  function getSelectedSignatureContent() {
    const selectedSigId = sigSelect.value;
    if (!selectedSigId) return '';
    const sigObj = userSignatures.find(s => s.id === selectedSigId);
    return sigObj?.content || '';
  }

  function joinEmailSections(sections) {
    return sections.filter(Boolean).join('<div style="height:16px; line-height:16px;">&nbsp;</div>');
  }

  function buildEmailTemplateHtml() {
    const rawSig = getSelectedSignatureContent();
    const sigHtml = /<\/?[a-z][\s\S]*>/i.test(rawSig) ? rawSig : markdownToHtml(rawSig);
    return joinEmailSections([
      getBodyTemplateHtml() ? `<div>${getBodyTemplateHtml()}</div>` : '',
      rawSig ? `<div>${sigHtml}</div>` : ''
    ]);
  }

  function buildFollowupTemplateHtml(bodyText) {
    const rawSig = getSelectedSignatureContent();
    const sigHtml = /<\/?[a-z][\s\S]*>/i.test(rawSig) ? rawSig : markdownToHtml(rawSig);
    return joinEmailSections([
      bodyText ? `<div>${bodyText}</div>` : '',
      rawSig ? `<div>${sigHtml}</div>` : ''
    ]);
  }

  function insertVariableToken(token) {
    const target = lastFocusedInput || bodyEditor;
    
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
      const start = target.selectionStart || 0;
      const end = target.selectionEnd || 0;
      const val = target.value;
      target.value = val.slice(0, start) + token + val.slice(end);
      target.selectionStart = target.selectionEnd = start + token.length;
      target.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      target.focus();
      const selection = window.getSelection();
      
      const span = document.createElement('span');
      span.className = 'email-var';
      span.contentEditable = 'false';
      span.textContent = token;

      if (!selection || !selection.rangeCount || !target.contains(selection.anchorNode)) {
        target.append(span);
        target.append(document.createTextNode('\u00A0'));
      } else {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        
        const spaceNode = document.createTextNode('\u00A0');
        range.insertNode(spaceNode);
        range.insertNode(span);
        
        range.setStartAfter(spaceNode);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      target.dispatchEvent(new Event('input', { bubbles: true }));
    }
    renderPreview();
  }

  function runRichCommand(editor, command) {
    if (!editor) return;
    editor.focus();
    if (command === 'createLink') {
      const url = window.prompt('Enter the full URL for this link:', 'https://');
      if (!url) return;
      document.execCommand('createLink', false, url);
      return;
    }
    document.execCommand(command, false, null);
  }

  /* ──────────────────────────────────
     Preview
     ────────────────────────────────── */
  function renderPreview() {
    if (!rows.length) return;
    const row = rows[previewIdx];
    const subj = replaceVars(subjectTpl.value || '(no subject)', row);
    const body = replaceVars(buildEmailTemplateHtml(), row);
    
    let html = `
      <div class="preview-subject">Subject: ${escapeHtml(subj)}</div>
      <div class="preview-body">${body || '<em style="opacity:.4">Body is empty</em>'}</div>
    `;

    const action = actionSel.value;
    if ((action === 'bulkSend' || action === 'threadedFollowup') && followupDrafts.length > 0) {
      followupDrafts.forEach((step, i) => {
        if (!step.bodyTemplate) return;
        const stepBody = replaceVars(buildFollowupTemplateHtml(step.bodyTemplate || ''), row);
        html += `
          <div style="margin: 20px 0; border-top: 1px dashed var(--surface-border); padding-top: 16px;">
             <strong>Follow-up ${i + 1}</strong> <small style="color:var(--text-dim)">(After ${step.dayOffset} days at ${step.time} — same thread/subject)</small>
          </div>
          <div class="preview-body">${stepBody || '<em style="opacity:.4">Body is empty</em>'}</div>
        `;
      });
    }

    previewPane.innerHTML = html;
    previewCount.textContent = `${previewIdx + 1} / ${rows.length}`;
    btnPrev.disabled = previewIdx <= 0;
    btnNext.disabled = previewIdx >= rows.length - 1;
  }

  btnPrev.addEventListener('click', () => { if (previewIdx > 0) { previewIdx--; renderPreview(); } });
  btnNext.addEventListener('click', () => { if (previewIdx < rows.length - 1) { previewIdx++; renderPreview(); } });
  subjectTpl.addEventListener('input', renderPreview);
  sigSelect.addEventListener('change', renderPreview);
  bodyEditor?.addEventListener('input', renderPreview);
  bodyEditor?.addEventListener('paste', (event) => {
    event.preventDefault();
    const html = event.clipboardData?.getData('text/html');
    const text = event.clipboardData?.getData('text/plain') || '';
    const cleaned = cleanPasteHtml(html, text);
    document.execCommand('insertHTML', false, cleaned);
    renderPreview();
  });
  bodyToolbar?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-command]');
    if (!button) return;
    runRichCommand(bodyEditor, button.dataset.command);
    renderPreview();
  });

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
    const bodyHtml = /<\/?[a-z][\s\S]*>/i.test(s.content) ? s.content : markdownToHtml(s.content);
    sigContent.innerHTML = bodyHtml;
    sigEditorTitle.textContent = 'Edit Signature';
    btnCancelEditSig.style.display = 'inline-block';
  };

  sigContent?.addEventListener('paste', (event) => {
    event.preventDefault();
    const html = event.clipboardData?.getData('text/html');
    const text = event.clipboardData?.getData('text/plain') || '';
    const cleaned = cleanPasteHtml(html, text);
    document.execCommand('insertHTML', false, cleaned);
  });
  
  sigToolbar?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-command]');
    if (!button) return;
    runRichCommand(sigContent, button.dataset.command);
  });

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
    if (sigContent) sigContent.innerHTML = '';
    sigEditorTitle.textContent = 'Add New Signature';
    btnCancelEditSig.style.display = 'none';
  }

  btnSaveSig.addEventListener('click', () => {
    const name = sigName.value.trim();
    const content = getEditorHtml(sigContent);
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
    followupConfig.style.display = (v === 'bulkSend' || v === 'threadedFollowup') ? 'block' : 'none';
    // Toggle help text
    const helpBulk = document.getElementById('followup-help-bulk');
    const helpThreaded = document.getElementById('followup-help-threaded');
    if (helpBulk) helpBulk.style.display = v === 'bulkSend' ? '' : 'none';
    if (helpThreaded) helpThreaded.style.display = v === 'threadedFollowup' ? '' : 'none';
    const label = { bulkSend: 'Send Emails', threadedFollowup: 'Send Follow-ups', checkReplies: 'Check Replies' }[v];
    btnSend.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2 11 13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
      ${label}
    `;
  });
  // Trigger change on load to show follow-up planner for default (bulkSend)
  actionSel.dispatchEvent(new Event('change'));

  function renderFollowupBuilder() {
    const count = Math.min(10, Math.max(0, parseInt(followupCount.value || '0', 10)));
    followupCount.value = count;
    const defaultDays = [1, 2, 3, 4, 5, 6, 7];
    followupList.innerHTML = Array.from({ length: count }, (_, i) => {
      const existing = followupDrafts[i] || {};
      const dayOffset = existing.dayOffset ?? defaultDays[i] ?? (defaultDays[defaultDays.length - 1] + 7 * (i - defaultDays.length + 1));
      const time = existing.time || '10:00';
      const body = existing.bodyTemplate || (i === 0
        ? 'Hi {{name}},\n\nFollowing up on my previous email.\n\nBest,\nYour Name'
        : 'Hi {{name}},\n\nSharing a quick follow-up in case this got buried.\n\nBest,\nYour Name');
      const bodyHtml = /<\/?[a-z][\s\S]*>/i.test(body)
        ? body
        : markdownToHtml(body);

      return `
      <div class="followup-item">
        <div class="followup-row">
          <strong>Follow-up ${i + 1}</strong>
          <label>After <input type="number" class="fu-days" data-idx="${i}" min="0" max="7" value="${dayOffset}" /> day(s)</label>
          <label>At <input type="time" class="fu-time" data-idx="${i}" value="${time}" /></label>
        </div>
        <div class="field">
          <label>Body</label>
          <div class="rich-editor followup-editor-wrap">
            <div class="rich-toolbar followup-toolbar" data-idx="${i}">
              <button class="icon-btn toolbar-btn" type="button" data-command="bold" title="Bold"><strong>B</strong></button>
              <button class="icon-btn toolbar-btn" type="button" data-command="italic" title="Italic"><em>I</em></button>
              <button class="icon-btn toolbar-btn" type="button" data-command="underline" title="Underline"><span style="text-decoration:underline;">U</span></button>
              <button class="icon-btn toolbar-btn" type="button" data-command="insertUnorderedList" title="Bulleted list">&bull;</button>
              <button class="icon-btn toolbar-btn" type="button" data-command="insertOrderedList" title="Numbered list">1.</button>
              <button class="icon-btn toolbar-btn" type="button" data-command="createLink" title="Add hyperlink">Link</button>
              <button class="icon-btn toolbar-btn" type="button" data-command="removeFormat" title="Clear formatting">Clear</button>
            </div>
            <div class="rich-input fu-body" contenteditable="true" data-idx="${i}" data-placeholder="Write and format follow-up ${i + 1} here.">${bodyHtml}</div>
          </div>
        </div>
      </div>`;
    }).join('');

    const sync = () => {
      followupDrafts = Array.from({ length: count }, (_, i) => ({
        dayOffset: Number(followupList.querySelector(`.fu-days[data-idx="${i}"]`)?.value || 0),
        time: followupList.querySelector(`.fu-time[data-idx="${i}"]`)?.value || '10:00',
        bodyTemplate: getEditorHtml(followupList.querySelector(`.fu-body[data-idx="${i}"]`))
      }));
      renderPreview();
    };
    followupList.querySelectorAll('input').forEach(el => el.addEventListener('input', sync));
    followupList.querySelectorAll('.fu-body').forEach(editor => {
      editor.addEventListener('input', sync);
      editor.addEventListener('paste', (event) => {
        event.preventDefault();
        const html = event.clipboardData?.getData('text/html');
        const text = event.clipboardData?.getData('text/plain') || '';
        const cleaned = cleanPasteHtml(html, text);
        document.execCommand('insertHTML', false, cleaned);
        sync();
      });
    });
    followupList.querySelectorAll('.followup-toolbar').forEach(toolbar => {
      toolbar.addEventListener('click', (event) => {
        const button = event.target.closest('[data-command]');
        if (!button) return;
        const idx = toolbar.dataset.idx;
        const editor = followupList.querySelector(`.fu-body[data-idx="${idx}"]`);
        runRichCommand(editor, button.dataset.command);
        sync();
      });
    });
    sync();
  }
  followupCount?.addEventListener('input', renderFollowupBuilder);
  renderFollowupBuilder();

  // Timing toggle logic
  const timingRadios = document.querySelectorAll('input[name="sendTiming"]');
  const scheduleTimeInput = $('schedule-time');
  timingRadios.forEach(r => r.addEventListener('change', () => {
    scheduleTimeInput.style.display = r.value === 'schedule' ? 'block' : 'none';
  }));

  /* ──────────────────────────────────
     Schedule Campaign via Backend
     ────────────────────────────────── */

  btnSend.addEventListener('click', async () => {
    if (!user) { alert('Please sign in with Google first.'); return; }
    if (!rows.length) { alert('Upload a CSV file first.'); return; }

    const action = actionSel.value;
    const isSchedule = document.querySelector('input[name="sendTiming"]:checked').value === 'schedule';
    const scheduleInput = isSchedule ? scheduleTimeInput.value : '';
    const scheduledAt = scheduleInput ? new Date(scheduleInput).toISOString() : new Date().toISOString();

    btnSend.disabled = true;
    progressArea.style.display = 'block';
    resultsArea.style.display = 'none';
    progressFill.style.background = '';
    progressFill.style.width = '30%';
    progressText.textContent = scheduleInput ? 'Scheduling campaign...' : 'Sending immediately...';

    try {
      const fullBody = buildEmailTemplateHtml();
      const payload = {
        action,
        subjectTemplate: subjectTpl.value,
        bodyTemplate: fullBody,
        csvData: rows,
        headers: headers,
        scheduledAt
      };
      if (action === 'threadedFollowup') {
        const hasThreadId = headers.some(h => String(h).toLowerCase().includes('threadid'));
        if (!hasThreadId) throw new Error("For follow-ups, upload send log CSV that contains 'threadId'.");
        payload.followups = followupDrafts.length ? followupDrafts.map(step => ({
          ...step,
          bodyTemplate: buildFollowupTemplateHtml(step.bodyTemplate || '')
        })) : [{
          isImplicit: true,
          subjectTemplate: subjectTpl.value || 'Follow up',
          bodyTemplate: fullBody
        }];
      }

      // Attach follow-ups for bulkSend if user configured any
      if (action === 'bulkSend' && followupDrafts.length > 0) {
        const nonEmptyFollowups = followupDrafts.filter(step =>
          step.bodyTemplate || step.subjectTemplate
        );
        if (nonEmptyFollowups.length > 0) {
          payload.followups = nonEmptyFollowups.map(step => ({
            ...step,
            bodyTemplate: buildFollowupTemplateHtml(step.bodyTemplate || '')
          }));
        }
      }

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
     Campaign Management
     ────────────────────────────────── */
  function fetchCampaigns() {
    fetch('/api/campaigns/list', { headers: { 'cookie': document.cookie } })
      .then(r => r.json())
      .then(data => {
         if (data.error) throw new Error(data.error);
         renderCampaigns(data || []);
      })
      .catch(e => {
         campaignsTbody.innerHTML = `<tr><td colspan="5" style="color:var(--danger)">Failed to load campaigns: ${escapeHtml(e.message)}</td></tr>`;
      });
  }

  function renderCampaigns(campaigns) {
    if (!campaigns.length) {
      campaignsTbody.innerHTML = `<tr><td colspan="5" style="text-align:center; opacity:0.5;">No campaigns found.</td></tr>`;
      return;
    }
    window.allCampaignsData = campaigns;
    campaignsTbody.innerHTML = campaigns.map(c => {
       const actionMap = { bulkSend: 'Bulk Blast', threadedFollowup: 'Thread Follow-up', checkReplies: 'Inbox Check' };
       const type = actionMap[c.action] || c.action;
       
       let manageBtn = `<div style="display:flex; gap:10px; align-items:center;">
          <a href="/api/campaigns/export?campaignId=${c.id}" target="_blank" class="btn btn-ghost btn-sm" title="Download Send Log (includes threadId)">⬇ CSV</a>`;
          
       if (c.status !== 'cancelled' && (c.pending > 0)) {
          manageBtn += `<button class="btn btn-ghost btn-sm" onclick="window.openEditCampaign('${c.id}')">Edit</button></div>`;
       } else {
          manageBtn += `<span style="opacity:0.5; font-size:0.8rem;">Finished</span></div>`;
       }
       
       return `<tr>
         <td><strong>${escapeHtml(type)}</strong></td>
         <td><span class="status-${c.status}">${escapeHtml(c.status)}</span></td>
         <td>${c.sent || 0} Sent / ${c.pending || 0} Pend</td>
         <td>${new Date(c.created_at).toLocaleString()}</td>
         <td>${manageBtn}</td>
       </tr>`;
    }).join('');
  }

  window.openEditCampaign = (id) => {
    const c = (window.allCampaignsData || []).find(x => x.id === id);
    if (!c) return;
    editCampId.value = c.id;
    editCampSubject.value = c.subject_template || '';
    editCampBody.innerHTML = c.body_template ? (/<\/?[a-z][\s\S]*>/i.test(c.body_template) ? c.body_template : markdownToHtml(c.body_template)) : '';
    editCampStatus.textContent = '';
    
    currentEditFollowups = c.followup_config || [];
    if (currentEditFollowups.length > 0) {
      editCampFollowupsContainer.style.display = 'block';
      editCampFollowupsList.innerHTML = currentEditFollowups.map((step, i) => {
        const bodyContent = step.bodyTemplate ? (/<\/?[a-z][\s\S]*>/i.test(step.bodyTemplate) ? step.bodyTemplate : markdownToHtml(step.bodyTemplate)) : '';
        return `
          <div class="edit-fu-item">
            <div style="margin-bottom:5px;"><strong>Follow-up ${i+1}</strong> <small style="color:var(--text-dim)">(After ${step.dayOffset} days)</small></div>
            <div class="rich-editor">
              <div class="rich-toolbar edit-fu-toolbar" data-idx="${i}">
                <button class="icon-btn toolbar-btn" type="button" data-command="bold"><strong>B</strong></button>
                <button class="icon-btn toolbar-btn" type="button" data-command="italic"><em>I</em></button>
                <button class="icon-btn toolbar-btn" type="button" data-command="underline"><span style="text-decoration:underline;">U</span></button>
                <button class="icon-btn toolbar-btn" type="button" data-command="createLink">Link</button>
                <button class="icon-btn toolbar-btn" type="button" data-command="removeFormat">Clear</button>
              </div>
              <div class="rich-input edit-fu-body" contenteditable="true" data-idx="${i}" style="min-height:80px;">${bodyContent}</div>
            </div>
          </div>
        `;
      }).join('');
      
      editCampFollowupsList.querySelectorAll('.edit-fu-toolbar').forEach(toolbar => {
        toolbar.addEventListener('click', (event) => {
          const button = event.target.closest('[data-command]');
          if (!button) return;
          const idx = toolbar.dataset.idx;
          const editor = editCampFollowupsList.querySelector(`.edit-fu-body[data-idx="${idx}"]`);
          runRichCommand(editor, button.dataset.command);
        });
      });
      
    } else {
      editCampFollowupsContainer.style.display = 'none';
      editCampFollowupsList.innerHTML = '';
    }

    btnCancelCampaign.style.display = 'inline-block';
    btnSaveCampaign.disabled = false;
    editCampModal.style.display = 'block';
  };

  btnCloseEditModal.addEventListener('click', () => { editCampModal.style.display = 'none'; });

  editCampToolbar?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-command]');
    if (!button) return;
    runRichCommand(editCampBody, button.dataset.command);
  });
  
  editCampBody?.addEventListener('paste', (event) => {
    event.preventDefault();
    const html = event.clipboardData?.getData('text/html');
    const text = event.clipboardData?.getData('text/plain') || '';
    const cleaned = cleanPasteHtml(html, text);
    document.execCommand('insertHTML', false, cleaned);
  });

  btnSaveCampaign.addEventListener('click', async () => {
    const campaignId = editCampId.value;
    const subjectTemplate = editCampSubject.value.trim();
    const bodyTemplate = getEditorHtml(editCampBody);
    
    if (!subjectTemplate && !bodyTemplate) return alert('Templates cannot be completely empty.');

    const updatedFollowups = currentEditFollowups.map((step, i) => {
       const editor = editCampFollowupsList.querySelector(`.edit-fu-body[data-idx="${i}"]`);
       return {
          ...step,
          bodyTemplate: getEditorHtml(editor)
       };
    });
    
    btnSaveCampaign.disabled = true;
    editCampStatus.textContent = 'Updating pending emails...';
    
    try {
       const res = await fetch('/api/campaigns/update', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ 
           campaignId, 
           subjectTemplate, 
           bodyTemplate, 
           followups: currentEditFollowups.length ? updatedFollowups : undefined 
         })
       });
       const data = await res.json();
       if (!res.ok) throw new Error(data.error || 'Server error');
       
       editCampStatus.textContent = `✅ Updated ${data.updatedEmails} emails`;
       fetchCampaigns(); // refresh list
       setTimeout(() => { editCampModal.style.display = 'none'; }, 2000);
    } catch(err) {
       editCampStatus.textContent = `❌ Error: ${err.message}`;
       btnSaveCampaign.disabled = false;
    }
  });

  btnCancelCampaign.addEventListener('click', async () => {
    if (!confirm('Are you absolutely sure? This will prematurely cancel all pending emails in this campaign.')) return;
    try {
      btnCancelCampaign.disabled = true;
      const res = await fetch('/api/campaigns/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: editCampId.value })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to cancel');
      editCampModal.style.display = 'none';
      fetchCampaigns();
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      btnCancelCampaign.disabled = false;
    }
  });

});
