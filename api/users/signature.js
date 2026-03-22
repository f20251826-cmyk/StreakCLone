const { supabase } = require('../lib/supabase');
const jwt = require('jsonwebtoken');

module.exports = async (req, res) => {
  try {
    // 1. Authenticate user
    const cookies = req.headers.cookie || '';
    const strokeToken = cookies.split('; ').find(row => row.startsWith('stroke_token='))?.split('=')[1];
    if (!strokeToken) return res.status(401).json({ error: 'Unauthorized' });
    
    const user = jwt.verify(strokeToken, process.env.JWT_SECRET || 'fallback-secret');
    if (!user || !user.id) return res.status(401).json({ error: 'Invalid token' });

    if (req.method === 'GET') {
      // Fetch signature
      const { data, error } = await supabase
        .from('users')
        .select('signature')
        .eq('id', user.id)
        .single();
      
      if (error && error.code !== 'PGRST116') throw error; // ignore not found
      return res.status(200).json({ signature: data?.signature || '' });
    } 
    else if (req.method === 'POST') {
      // Update signature
      const { signature } = req.body;
      const { error } = await supabase
        .from('users')
        .update({ signature: signature || null })
        .eq('id', user.id);
        
      if (error) throw error;
      return res.status(200).json({ success: true, signature });
    }
    
    res.status(405).send('Method Not Allowed');

  } catch (err) {
    console.error('Signature API error:', err);
    res.status(500).json({ error: 'Failed to process signature', message: err.message });
  }
};