# Stroke — CRM Outreach Tool

A Streak-inspired **bulk email outreach system** with dynamic variable templates, threaded follow-ups, and automatic reply detection — all powered by **Google Apps Script + Gmail**.

## Project Structure

```
Stroke/
├── backend/
│   ├── Code.gs            # Google Apps Script — paste into script.google.com
│   └── appsscript.json    # Manifest (enables Advanced Gmail API)
├── frontend/
│   ├── index.html          # Web Dashboard
│   ├── style.css           # Dark glassmorphism theme
│   └── script.js           # UI logic, live preview, CSV parsing
├── cli/
│   ├── index.js            # Node.js CLI tool
│   └── package.json
└── sample_data/
    ├── contacts.csv        # Example CSV
    └── template.html       # Example email body template
```

---

## Setup

### 1. Get a Google OAuth Client ID

Since Stroke runs entirely in your browser and connects directly to Gmail, you need a Client ID.

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (or use an existing one).
3. Go to **APIs & Services > Library** and enable the **Gmail API**.
4. Go to **APIs & Services > OAuth consent screen**:
   - Choose **External** (if you have a regular Gmail account) or Internal (for GSuite).
   - Fill in the required app name and support email.
   - Add your own email as a Test User.
5. Go to **APIs & Services > Credentials**:
   - Click **Create Credentials > OAuth client ID**.
   - Application type: **Web application**.
   - Authorized JavaScript origins: Add `http://localhost:5500` (or wherever you host the HTML).
   - Click Create and copy your **Client ID**.

### 2. Use the Web Dashboard

Just open `frontend/index.html` in any browser (via a local server like Live Server or Python).

1. Paste your Google OAuth Client ID and sign in with Google.
2. Upload a CSV (must include an `email` column).
3. Write your subject and body templates using `{{column_name}}` placeholders.
4. Preview the resolved email live with row-by-row navigation.
5. Hit **Send Emails** and download the success log.

### 3. Use the CLI

*(CLI usage remains unchanged — see `cli/README.md` for specific CLI setup if you still want to use the legacy GAS backend for CLI)*

# Threaded follow-up (CSV must include threadId + rfcMessageId columns from the send log)
node index.js https://script.google.com/.../exec threadedFollowup send_log.csv "" followup.html

# Check replies
node index.js https://script.google.com/.../exec checkReplies send_log.csv
```

---

## How It Works

| Feature | Implementation |
|---|---|
| **Variable Engine** | Case-insensitive regex `{{colName}}` replacement against all CSV headers |
| **Bulk Send** | `GmailApp.createDraft().send()` — returns `threadId`, `messageId`, `rfcMessageId` |
| **Threaded Follow-ups** | `Gmail.Users.Messages.send()` with raw RFC 2822 `In-Reply-To` + `References` headers |
| **Reply Detection** | `GmailApp.getThreadById()` — checks if any message is from someone other than you |
| **Success Log** | Downloadable CSV/JSON mapping each recipient to their thread for future follow-ups |

---

## CSV Format

### For Bulk Send
```csv
name,email,company,last_order
Rahul,rahul@example.com,TechnoSoft,Widget Pro
```

### For Follow-ups (use the log from bulk send)
```csv
email,subject,threadId,rfcMessageId
rahul@example.com,Hi Rahul!,18f2a3...,<CAB...@mail.gmail.com>
```
