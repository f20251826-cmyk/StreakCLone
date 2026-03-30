const { supabase } = require('../lib/supabase');
const jwt = require('jsonwebtoken');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const cookies = req.headers.cookie || '';
    const strokeToken = cookies.split('; ').find(row => row.startsWith('stroke_token='))?.split('=')[1];
    
    if (!strokeToken) return res.status(401).json({ error: 'Unauthorized' });
    
    const user = jwt.verify(strokeToken, process.env.JWT_SECRET || 'fallback-secret');
    if (!user || !user.id) return res.status(401).json({ error: 'Invalid token' });

    const { campaignId, subjectTemplate, bodyTemplate } = req.body;
    if (!campaignId) return res.status(400).json({ error: 'Missing campaignId' });

    // 1. Fetch Campaign to verify ownership and get csv_data
    const { data: campaign, error: campErr } = await supabase
      .from('campaigns')
      .select('*')
      .eq('id', campaignId)
      .eq('user_id', user.id)
      .single();

    if (campErr || !campaign) {
      return res.status(404).json({ error: 'Campaign not found or unauthorized' });
    }

    if (!campaign.csv_data || !campaign.headers) {
      return res.status(400).json({ error: 'Cannot edit this campaign. The original data might have been cleaned up.' });
    }

    // 2. Fetch pending emails for this campaign
    const { data: pendingEmails, error: emailsErr } = await supabase
      .from('emails')
      .select('id, to_email, is_followup')
      .eq('campaign_id', campaignId)
      .eq('status', 'pending');

    if (emailsErr) throw emailsErr;

    // Helper functions for re-templating
    const resolveTemplate = (tpl, row) => {
      let out = tpl || '';
      campaign.headers.forEach((header, i) => {
        const val = row[i] || '';
        const regex = new RegExp(`{{\\s*${header}\\s*}}`, 'gi');
        out = out.replace(regex, val);
      });
      return out;
    };
    
    const normalizeBody = (body) => {
      if (!body) return '';
      const hasHtml = /<\/?[a-z][\s\S]*>/i.test(body);
      if (hasHtml) {
        return body.replace(/\r\n/g, '\n');
      }
      return body
        .replace(/\n/g, '<br/>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    };

    const emailHeaderIdx = campaign.headers.findIndex(h => h.toLowerCase().includes('email'));

    // 3. Prepare updates for pending main emails
    const emailUpdates = [];
    for (const email of pendingEmails) {
      // Find the row for this email
      const row = campaign.csv_data.find(r => (r[emailHeaderIdx] || '').trim() === email.to_email);
      if (!row) continue;

      if (!email.is_followup) {
         const resolvedSubject = resolveTemplate(subjectTemplate, row);
         const resolvedBody = normalizeBody(resolveTemplate(bodyTemplate, row));
         
         emailUpdates.push({
            id: email.id,
            subject: resolvedSubject,
            body: resolvedBody
         });
      }
      // Note: As designed, threaded followups use the same subject initially, but editing them 
      // dynamically gets extremely complex if we don't know the exact step template. We will just 
      // update the main email template (is_followup = false) as the MVP.
    }

    // Update emails one by one
    for (const update of emailUpdates) {
       await supabase.from('emails').update({ subject: update.subject, body: update.body }).eq('id', update.id);
    }

    // 4. Update Campaign Record
    await supabase.from('campaigns').update({
       subject_template: subjectTemplate,
       body_template: bodyTemplate
    }).eq('id', campaignId);

    res.status(200).json({ success: true, updatedEmails: emailUpdates.length });

  } catch (err) {
    console.error('Update campaign error:', err);
    res.status(500).json({ error: 'Failed to update campaign' });
  }
};
