const { getOAuthClient } = require('../lib/gmail');

module.exports = async (req, res) => {
  try {
    const oAuth2Client = getOAuthClient();
    
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline', // Critical: gets a refresh token
      scope: [
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/userinfo.email'
      ],
      prompt: 'consent' // Force consent to guarantee we receive a refresh token
    });
    
    res.redirect(authUrl);
  } catch (err) {
    console.error("Login crash:", err);
    res.status(500).json({ error: "Login crash", message: err.message, stack: err.stack });
  }
};
