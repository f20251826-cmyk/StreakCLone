#!/usr/bin/env node

/**
 * StreakClone CLI
 * Trigger mail merges from the command line by passing a CSV path,
 * templates, and your Google Apps Script Web App URL.
 *
 * Usage:
 *   node index.js <webAppUrl> <action> <csvFile> [subjectTemplate] [bodyFileOrString]
 *
 * Actions: bulkSend | threadedFollowup | checkReplies
 */

import fs from 'fs';
import path from 'path';

/* ── Helpers ── */

function bold(s)  { return `\x1b[1m${s}\x1b[0m`; }
function green(s) { return `\x1b[32m${s}\x1b[0m`; }
function red(s)   { return `\x1b[31m${s}\x1b[0m`; }
function cyan(s)  { return `\x1b[36m${s}\x1b[0m`; }
function dim(s)   { return `\x1b[2m${s}\x1b[0m`; }

function printBanner() {
  console.log('');
  console.log(cyan(bold('  ⚡ StreakClone CLI')));
  console.log(dim('  Bulk outreach · Threaded follow-ups · Reply detection'));
  console.log('');
}

function printUsage() {
  printBanner();
  console.log(bold('  USAGE'));
  console.log('    node index.js <webAppUrl> <action> <csvFile> [subject] [bodyFile] [--from email] [--name "Name"]');
  console.log('');
  console.log(bold('  ACTIONS'));
  console.log(green('    bulkSend          ') + '  Send initial emails to every row in the CSV');
  console.log(green('    threadedFollowup  ') + '  Send threaded replies (needs threadId column in CSV)');
  console.log(green('    checkReplies      ') + '  Check which threads received replies');
  console.log('');
  console.log(bold('  ARGUMENTS'));
  console.log('    webAppUrl    Your deployed Google Apps Script Web App URL');
  console.log('    action       One of the actions listed above');
  console.log('    csvFile      Path to a local .csv file');
  console.log('    subject      Subject line template (bulkSend only). Use {{col}} placeholders.');
  console.log('    bodyFile     Path to an HTML file for the body template, or a literal string.');
  console.log('');
  console.log(bold('  FLAGS'));
  console.log('    --from       Gmail address or "Send As" alias to send from (e.g. you@gmail.com)');
  console.log('    --name       Display name for the sender (e.g. "Your Name")');
  console.log('');
  console.log(bold('  EXAMPLES'));
  console.log(dim('    # Initial blast from a specific Gmail'));
  console.log('    node index.js https://script.google.com/.../exec bulkSend contacts.csv "Hi {{name}}!" body.html --from you@gmail.com --name "Shashwat"');
  console.log('');
  console.log(dim('    # Threaded follow-up'));
  console.log('    node index.js https://script.google.com/.../exec threadedFollowup log.csv "" followup.html --from you@gmail.com');
  console.log('');
  console.log(dim('    # Check replies'));
  console.log('    node index.js https://script.google.com/.../exec checkReplies log.csv');
  console.log('');
}

/* ── Main ── */

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 3 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  // Parse flags (--from, --name)
  const flagArgs = process.argv.slice(2);
  let senderEmail = '';
  let senderName  = '';
  const fromIdx = flagArgs.indexOf('--from');
  if (fromIdx !== -1 && flagArgs[fromIdx + 1]) senderEmail = flagArgs[fromIdx + 1];
  const nameIdx = flagArgs.indexOf('--name');
  if (nameIdx !== -1 && flagArgs[nameIdx + 1]) senderName = flagArgs[nameIdx + 1];

  // Positional args (filter out flags)
  const positional = flagArgs.filter((a, i) => {
    if (a === '--from' || a === '--name') return false;
    if (i > 0 && (flagArgs[i-1] === '--from' || flagArgs[i-1] === '--name')) return false;
    return true;
  });

  const [webAppUrl, action, csvPath, subjectTemplate, bodyArg] = positional;

  // Validate action
  const validActions = ['bulkSend', 'threadedFollowup', 'checkReplies'];
  if (!validActions.includes(action)) {
    console.error(red(`Invalid action "${action}". Must be one of: ${validActions.join(', ')}`));
    process.exit(1);
  }

  // Read CSV
  const resolved = path.resolve(csvPath);
  if (!fs.existsSync(resolved)) {
    console.error(red(`CSV file not found: ${resolved}`));
    process.exit(1);
  }
  const csvData = fs.readFileSync(resolved, 'utf-8');
  const rowCount = csvData.trim().split('\n').length - 1;

  // Read body template
  let bodyTemplate = '';
  if (bodyArg) {
    const bodyPath = path.resolve(bodyArg);
    if (fs.existsSync(bodyPath)) {
      bodyTemplate = fs.readFileSync(bodyPath, 'utf-8');
    } else {
      bodyTemplate = bodyArg; // treat as literal string
    }
  }

  printBanner();
  console.log(`  ${bold('Action:')}   ${green(action)}`);
  if (senderEmail) console.log(`  ${bold('From:')}     ${senderEmail}${senderName ? ' (' + senderName + ')' : ''}`);
  console.log(`  ${bold('CSV:')}      ${csvPath} (${rowCount} data rows)`);
  if (action === 'bulkSend') {
    console.log(`  ${bold('Subject:')}  ${subjectTemplate || '(none)'}`);
  }
  console.log(`  ${bold('Body:')}     ${bodyArg ? (fs.existsSync(path.resolve(bodyArg)) ? bodyArg + ' (file)' : '(literal)') : '(none)'}`);
  console.log('');

  // Build payload
  const payload = { action, csvData };
  if (senderEmail) payload.senderEmail = senderEmail;
  if (senderName)  payload.senderName  = senderName;

  if (action === 'bulkSend') {
    payload.subjectTemplate = subjectTemplate || '';
    payload.bodyTemplate = bodyTemplate;
  } else if (action === 'threadedFollowup') {
    payload.bodyTemplate = bodyTemplate;
  } else if (action === 'checkReplies') {
    // Parse CSV to extract threadIds
    const lines = csvData.trim().split('\n');
    const hdrs = lines[0].split(',').map(h => h.trim().toLowerCase());
    const tidIdx = hdrs.findIndex(h => h.includes('threadid'));
    if (tidIdx === -1) {
      console.error(red("CSV must have a 'threadId' column for checkReplies."));
      process.exit(1);
    }
    payload.threadIds = lines.slice(1)
      .map(l => l.split(',')[tidIdx]?.trim())
      .filter(Boolean);
  }

  // Send request
  console.log(dim('  Sending request to GAS backend…'));
  const startTime = Date.now();

  try {
    const res = await fetch(webAppUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      console.error(red(`  HTTP ${res.status}: ${res.statusText}`));
      process.exit(1);
    }

    const json = await res.json();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (json.error) {
      console.error(red('  ❌ Backend error: ') + json.error);
      process.exit(1);
    }

    // Success
    const records = json.logs || (json.replies ? Object.entries(json.replies).map(([t, r]) => ({ threadId: t, replied: r })) : []);
    const count = Array.isArray(records) ? records.length : 0;
    console.log(green(`  ✅ Success — ${count} records processed in ${elapsed}s`));

    // Write log
    const logFile = `${action}_log_${Date.now()}.json`;
    fs.writeFileSync(logFile, JSON.stringify(records, null, 2));
    console.log(`  ${bold('Log:')} ${logFile}`);

    // Also write CSV log for bulkSend / followup
    if (action !== 'checkReplies' && records.length) {
      const keys = Object.keys(records[0]);
      const csvLog = [
        keys.join(','),
        ...records.map(r => keys.map(k => `"${String(r[k] || '').replace(/"/g, '""')}"`).join(','))
      ].join('\n');
      const csvLogFile = `${action}_log_${Date.now()}.csv`;
      fs.writeFileSync(csvLogFile, csvLog);
      console.log(`  ${bold('CSV Log:')} ${csvLogFile}`);
    }

    console.log('');
  } catch (err) {
    console.error(red('  ❌ Network error: ') + err.message);
    process.exit(1);
  }
}

main();
