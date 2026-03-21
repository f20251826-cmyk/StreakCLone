const { google } = require('googleapis');

function getOAuthClient() {
  const oAuth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    // Provide a valid fallback for local dev if VERCEL_URL is not set
    process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}/api/auth/callback` 
      : 'http://localhost:3000/api/auth/callback'
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

  const raw = buildRawEmail(to, subject, bodyHtml, threadId, replyToMessageId);

  try {
    const res = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: raw,
        threadId: threadId || undefined
      }
    });
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
    for (let i = 1; i < messages.length; i++) {
      const msg = messages[i];
      const headers = msg.payload.headers;
      const fromHeader = headers.find(h => h.name.toLowerCase() === 'from');
      if (fromHeader && !fromHeader.value.includes(senderEmail)) {
        return true; // Someone else replied
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
