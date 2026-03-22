const { supabase } = require('../lib/supabase');
const jwt = require('jsonwebtoken');

module.exports = async (req, res) => {
  try {
    const cookies = req.headers.cookie || '';
    const strokeToken = cookies.split('; ').find(row => row.startsWith('stroke_token='))?.split('=')[1];
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
};