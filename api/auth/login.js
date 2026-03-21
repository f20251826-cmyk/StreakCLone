const { getOAuthClient } = require('../../lib/gmail');

module.exports = async (req, res) => {
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
};
