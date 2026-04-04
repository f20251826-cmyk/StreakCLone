const { supabase } = require('../_lib/supabase');
const jwt = require('jsonwebtoken');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const cookies = req.headers.cookie || '';
    const strokeToken = cookies.split('; ').find(row => row.startsWith('stroke_token='))?.split('=')[1];
    
    if (!strokeToken) return res.status(401).json({ error: 'Unauthorized' });
    
    const user = jwt.verify(strokeToken, process.env.JWT_SECRET || 'fallback-secret');
    if (!user || !user.id) return res.status(401).json({ error: 'Invalid token' });

    const { campaignId } = req.body;
    if (!campaignId) return res.status(400).json({ error: 'Missing campaignId' });

    // 1. Fetch Campaign to verify ownership
    const { data: campaign, error: campErr } = await supabase
      .from('campaigns')
      .select('id')
      .eq('id', campaignId)
      .eq('user_id', user.id)
      .single();

    if (campErr || !campaign) {
      return res.status(404).json({ error: 'Campaign not found or unauthorized' });
    }

    // 2. Delete all pending emails for this campaign
    const { error: emailsErr } = await supabase
      .from('emails')
      .delete()
      .eq('campaign_id', campaignId)
      .eq('status', 'pending');

    if (emailsErr) throw emailsErr;

    // 3. Mark Campaign Record as cancelled
    await supabase.from('campaigns').update({
       status: 'cancelled'
    }).eq('id', campaignId);

    res.status(200).json({ success: true });

  } catch (err) {
    console.error('Delete campaign error:', err);
    res.status(500).json({ error: 'Failed to cancel campaign' });
  }
};
