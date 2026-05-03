const express = require('express');
const jwt = require('jsonwebtoken');
const cookie = require('cookie');
const { supabase } = require('../lib/supabase');

const router = express.Router();

// ── GET /api/users/signatures ──
// ── POST /api/users/signatures ──
// ── DELETE /api/users/signatures ──
router.all('/signatures', async (req, res) => {
  try {
    let strokeToken = '';
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      strokeToken = authHeader.split(' ')[1];
    } else {
      const cookies = req.headers.cookie || '';
      strokeToken = cookies.split('; ').find(row => row.startsWith('stroke_token='))?.split('=')[1];
    }
    if (!strokeToken) return res.status(401).json({ error: 'Unauthorized' });
    
    const user = jwt.verify(strokeToken, process.env.JWT_SECRET || 'fallback-secret');
    if (!user || !user.id) return res.status(401).json({ error: 'Invalid token' });

    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('signatures')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true });
        
      if (error) throw error;
      return res.status(200).json(data || []);
    } 
    else if (req.method === 'POST') {
      const { id, name, content } = req.body;
      if (!name || !content) return res.status(400).json({ error: 'Missing name or content' });

      if (id) {
        const { data, error } = await supabase
          .from('signatures')
          .update({ name, content })
          .eq('id', id)
          .eq('user_id', user.id)
          .select().single();
        if (error) throw error;
        return res.status(200).json(data);
      } else {
        const { data, error } = await supabase
          .from('signatures')
          .insert([{ user_id: user.id, name, content }])
          .select().single();
        if (error) throw error;
        return res.status(200).json(data);
      }
    }
    else if (req.method === 'DELETE') {
      const { id } = req.body;
      const { error } = await supabase
        .from('signatures')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id);
      if (error) throw error;
      return res.status(200).json({ success: true });
    }
    
    res.status(405).send('Method Not Allowed');

  } catch (err) {
    console.error('Signatures API error:', err);
    res.status(500).json({ error: 'Failed to process signatures', message: err.message });
  }
});

// ── POST /api/users/update ──
router.post('/update', async (req, res) => {
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
});

module.exports = router;
