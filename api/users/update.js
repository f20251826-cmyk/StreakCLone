const { supabase } = require('../_lib/supabase');
const jwt = require('jsonwebtoken');
const cookie = require('cookie');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const cookies = req.headers.cookie || '';
    const strokeToken = cookies.split('; ').find(row => row.startsWith('stroke_token='))?.split('=')[1];
    
    if (!strokeToken) return res.status(401).json({ error: 'Unauthorized' });
    
    const user = jwt.verify(strokeToken, process.env.JWT_SECRET || 'fallback-secret');
    if (!user || !user.id) return res.status(401).json({ error: 'Invalid token' });

    const { name } = req.body;
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'Invalid name provided' });
    }

    // Update in database
    const { error } = await supabase
      .from('users')
      .update({ name: name.trim() })
      .eq('id', user.id);

    if (error) throw error;

    // Issue a new token with updated name
    const newToken = jwt.sign(
      { id: user.id, email: user.email, name: name.trim(), avatar: user.avatar },
      process.env.JWT_SECRET || 'fallback-secret',
      { expiresIn: '7d' }
    );

    res.setHeader('Set-Cookie', cookie.serialize('stroke_token', newToken, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 7,
      path: '/'
    }));

    res.status(200).json({ success: true, name: name.trim() });
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ error: 'Failed to update user' });
  }
};
