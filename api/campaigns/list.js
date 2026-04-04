const { supabase } = require('../_lib/supabase');
const jwt = require('jsonwebtoken');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).send('Method Not Allowed');

  try {
    const cookies = req.headers.cookie || '';
    const strokeToken = cookies.split('; ').find(row => row.startsWith('stroke_token='))?.split('=')[1];
    if (!strokeToken) return res.status(401).json({ error: 'Unauthorized' });
    
    const user = jwt.verify(strokeToken, process.env.JWT_SECRET || 'fallback-secret');
    if (!user || !user.id) return res.status(401).json({ error: 'Invalid token' });

    // Fetch campaigns
    const { data: campaigns, error } = await supabase
      .from('campaigns')
      .select('id, action, scheduled_at, status, created_at, followup_delay_hours, subject_template, body_template, followup_config')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Fetch email stats for these campaigns
    const { data: emails, error: emailsErr } = await supabase
      .from('emails')
      .select('campaign_id, status')
      .in('campaign_id', campaigns.map(c => c.id));

    if (emailsErr) throw emailsErr;

    // Attach stats to campaigns
    const enriched = campaigns.map(c => {
      const campEmails = emails.filter(e => e.campaign_id === c.id);
      return {
        ...c,
        total_emails: campEmails.length,
        sent: campEmails.filter(e => e.status === 'sent').length,
        pending: campEmails.filter(e => e.status === 'pending').length,
        failed: campEmails.filter(e => e.status === 'failed').length,
        skipped: campEmails.filter(e => e.status === 'skipped_replied').length
      };
    });

    res.status(200).json(enriched);

  } catch (err) {
    console.error('List campaigns error:', err);
    res.status(500).json({ error: 'Failed to fetch campaigns' });
  }
};
