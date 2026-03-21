const { getOAuthClient } = require('../../lib/gmail');
const { supabase } = require('../../lib/supabase');
const { google } = require('googleapis');
const jwt = require('jsonwebtoken');
const cookie = require('cookie');

module.exports = async (req, res) => {
  const code = req.query.code;
  if (!code) {
    return res.status(400).send('No code provided');
  }

  try {
    const oAuth2Client = getOAuthClient();
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);

    // Get user profile
    const oauth2 = google.oauth2({ version: 'v2', auth: oAuth2Client });
    const userInfo = await oauth2.userinfo.get();
    
    // Check if user exists in Supabase, else create
    let { data: user, error } = await supabase
      .from('users')
      .select('id, refresh_token')
      .eq('email', userInfo.data.email)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Supabase error:', error);
      return res.status(500).send('Database error');
    }

    let userId;
    const refreshToken = tokens.refresh_token || (user ? user.refresh_token : null);

    if (!user) {
      // New user
      const { data: newUser, error: insertError } = await supabase
        .from('users')
        .insert([{
          email: userInfo.data.email,
          name: userInfo.data.name,
          avatar_url: userInfo.data.picture,
          refresh_token: refreshToken
        }])
        .select()
        .single();
        
      if (insertError) throw insertError;
      userId = newUser.id;
    } else {
      // Existing user, update refresh token if we got a new one
      userId = user.id;
      if (tokens.refresh_token) {
        await supabase
          .from('users')
          .update({
            name: userInfo.data.name,
            avatar_url: userInfo.data.picture,
            refresh_token: tokens.refresh_token
          })
          .eq('id', userId);
      }
    }

    // Create session token
    const token = jwt.sign(
      { id: userId, email: userInfo.data.email, name: userInfo.data.name, avatar: userInfo.data.picture },
      process.env.JWT_SECRET || 'fallback-secret',
      { expiresIn: '7d' }
    );

    // Set cookie
    res.setHeader('Set-Cookie', cookie.serialize('stroke_token', token, {
      httpOnly: false, // allow JS to read it for UI
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 7, // 1 week
      path: '/'
    }));

    // Redirect to dashboard
    res.redirect('/');

  } catch (error) {
    console.error('Callback error:', error);
    res.status(500).send('Authentication failed');
  }
};
