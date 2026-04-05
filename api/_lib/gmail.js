const { google } = require('googleapis');

function getOAuthClient() {
  const oAuth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.APP_URL 
      ? `${process.env.APP_URL}/api/auth/callback`
      : (process.env.NODE_ENV === 'development' 
          ? 'http://localhost:3000/api/auth/callback' 
          : 'https://streakclone.vercel.app/api/auth/callback')
  );
  return oAuth2Client;
}

async function refreshAccessToken(refreshToken) {
  const oAuth2Client = getOAuthClient();
  oAuth2Client.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await oAuth2Client.refreshAccessToken();
  return credentials.access_token;
}

function buildRawEmail(to, subject, bodyHtml, threadId, messageId) {
  const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
  let messageParts = [
    `To: ${to}`,
    `Subject: ${utf8Subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8'
  ];

  if (threadId && messageId) {
    messageParts.push(`In-Reply-To: ${messageId}`);
    messageParts.push(`References: ${messageId}`);
  }

  messageParts.push('', bodyHtml);

  const message = messageParts.join('\r\n');
  return Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function sendEmail(accessToken, to, subject, bodyHtml, threadId = null, replyToMessageId = null) {
  const oAuth2Client = new google.auth.OAuth2();
  oAuth2Client.setCredentials({ access_token: accessToken });
  const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

  // Auto-fetch RFC Message ID from the thread if the user only provided a threadId
  if (threadId && !replyToMessageId) {
    try {
      const threadRes = await gmail.users.threads.get({
        userId: 'me',
        id: threadId,
        format: 'metadata',
        metadataHeaders: ['Message-ID']
      });
      if (threadRes.data.messages && threadRes.data.messages.length > 0) {
        const lastMsg = threadRes.data.messages[threadRes.data.messages.length - 1];
        const rfcHeader = (lastMsg.payload.headers || []).find(h => h.name.toLowerCase() === 'message-id');
        if (rfcHeader) {
          replyToMessageId = rfcHeader.value;
        }
      }
    } catch (e) {
      console.error('Failed to auto-fetch Message-ID for thread:', e.message);
    }
  }

  const raw = buildRawEmail(to, subject, bodyHtml, threadId, replyToMessageId);

  try {
    const res = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: raw,
        threadId: threadId || undefined
      }
    });

    try {
      const msg = await gmail.users.messages.get({
        userId: 'me',
        id: res.data.id,
        format: 'metadata',
        metadataHeaders: ['Message-ID']
      });
      const rfcHeader = msg.data.payload.headers.find(h => h.name.toLowerCase() === 'message-id');
      if (rfcHeader) {
        res.data.rfcMessageId = rfcHeader.value;
      }
    } catch (e) {
      console.error('Failed to fetch Message-ID for threading:', e.message);
    }

    return res.data;
  } catch (err) {
    console.error('Error sending email:', err);
    throw err;
  }
}

async function checkForReply(accessToken, threadId, senderEmail) {
  const oAuth2Client = new google.auth.OAuth2();
  oAuth2Client.setCredentials({ access_token: accessToken });
  const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

  try {
    const res = await gmail.users.threads.get({
      userId: 'me',
      id: threadId
    });

    const messages = res.data.messages;
    if (!messages || messages.length <= 1) return false;

    // Check if any message after the first one is from someone else
    // and looks like a human reply (ignore auto-generated responses).
    for (let i = 1; i < messages.length; i++) {
      const msg = messages[i];
      const headers = msg.payload.headers;
      const fromHeader = headers.find(h => h.name.toLowerCase() === 'from');
      const autoSubmitted = (headers.find(h => h.name.toLowerCase() === 'auto-submitted')?.value || '').toLowerCase();
      const precedence = (headers.find(h => h.name.toLowerCase() === 'precedence')?.value || '').toLowerCase();
      const xAutoResponseSuppress = (headers.find(h => h.name.toLowerCase() === 'x-auto-response-suppress')?.value || '').toLowerCase();
      const fromVal = (fromHeader?.value || '').toLowerCase();
      const senderVal = (senderEmail || '').toLowerCase();

      if (!fromVal || (senderVal && fromVal.includes(senderVal))) continue;

      const looksAuto =
        autoSubmitted.includes('auto') ||
        precedence.includes('bulk') ||
        precedence.includes('list') ||
        precedence.includes('junk') ||
        xAutoResponseSuppress.length > 0 ||
        fromVal.includes('no-reply') ||
        fromVal.includes('noreply') ||
        fromVal.includes('do-not-reply') ||
        fromVal.includes('mailer-daemon') ||
        fromVal.includes('postmaster');

      if (!looksAuto) {
        return true; // Human reply detected
      }
    }
    return false;
  } catch (err) {
    console.error('Error checking for reply:', err);
    return false;
  }
}

module.exports = {
  getOAuthClient,
  refreshAccessToken,
  sendEmail,
  checkForReply
};
