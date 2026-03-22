const { supabase } = require('../lib/supabase');
const jwt = require('jsonwebtoken');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    // 1. Authenticate user via Stroke JWT cookie
    const cookies = req.headers.cookie || '';
    const strokeToken = cookies.split('; ').find(row => row.startsWith('stroke_token='))?.split('=')[1];
    
    if (!strokeToken) return res.status(401).json({ error: 'Unauthorized' });
    
    const user = jwt.verify(strokeToken, process.env.JWT_SECRET || 'fallback-secret');
    if (!user || !user.id) return res.status(401).json({ error: 'Invalid token' });

    const { action, subjectTemplate, bodyTemplate, csvData, headers, scheduledAt, followupDelayHours } = req.body;

    // 2. Validate input
    if (!csvData || !Array.isArray(csvData) || csvData.length === 0) {
      return res.status(400).json({ error: 'No CSV data provided' });
    }

    const emailHeaderIdx = headers.findIndex(h => h.toLowerCase().includes('email'));
    if (emailHeaderIdx === -1) return res.status(400).json({ error: 'No Email column found' });

    // 3. Create Campaign Record
    const { data: campaign, error: campErr } = await supabase
      .from('campaigns')
      .insert([{
        user_id: user.id,
        action,
        subject_template: subjectTemplate,
        body_template: bodyTemplate,
        csv_data: csvData,
        headers,
        scheduled_at: scheduledAt || new Date().toISOString(),
        followup_delay_hours: followupDelayHours || null,
        status: 'pending' // we will mark it done once processed
      }])
      .select()
      .single();

    if (campErr) throw campErr;

    // 4. Create Individual Email Records (Batched insert)
    const emailsToInsert = csvData.map(row => {
      const toEmail = row[emailHeaderIdx].trim();
      let subject = subjectTemplate;
      let body = bodyTemplate;

      // Simple template interpolation
      headers.forEach((header, i) => {
        const val = row[i] || '';
        const regex = new RegExp(`{{${header}}}`, 'gi');
        if (subject) subject = subject.replace(regex, val);
        if (body) body = body.replace(regex, val);
      });

      // Convert line breaks and markdown links into HTML
      if (body) {
        body = body.replace(/\n/g, '<br/>');
        // Convert simple [text](url) to HTML links
        body = body.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
      }

      return {
        campaign_id: campaign.id,
        user_id: user.id,
        to_email: toEmail,
        subject,
        body,
        scheduled_at: campaign.scheduled_at,
        status: 'pending'
      };
    });

    const { error: emailsErr } = await supabase
      .from('emails')
      .insert(emailsToInsert);

    if (emailsErr) throw emailsErr;

    res.status(200).json({ success: true, campaignId: campaign.id, count: emailsToInsert.length });

  } catch (err) {
    console.error('Create campaign error:', err);
    res.status(500).json({ error: 'Failed to schedule campaign' });
  }
};
