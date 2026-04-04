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
      .select('id, to_email, is_followup, scheduled_at, status')
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
    const followupsArr = req.body.followups || [];

    // Group pending emails by to_email to safely remap already-spawned follow-ups
    const emailsByUser = {};
    for (const email of pendingEmails) {
       if (!emailsByUser[email.to_email]) emailsByUser[email.to_email] = { main: null, fup: [] };
       if (!email.is_followup) emailsByUser[email.to_email].main = email;
       else emailsByUser[email.to_email].fup.push(email);
    }

    // 3. Prepare updates for pending main emails
    const emailUpdates = [];
    for (const to_email of Object.keys(emailsByUser)) {
      const row = campaign.csv_data.find(r => (r[emailHeaderIdx] || '').trim() === to_email);
      if (!row) continue;

      const group = emailsByUser[to_email];

      // Update the main email (if it is still pending)
      if (group.main) {
         const resolvedSubject = resolveTemplate(subjectTemplate, row);
         const resolvedBody = normalizeBody(resolveTemplate(bodyTemplate, row));
         
         let newFollowupData = null;
         if (followupsArr.length > 0) {
            newFollowupData = followupsArr.map(step => ({
              dayOffset: Number(step.dayOffset || 0),
              time: step.time || '10:00',
              body: normalizeBody(resolveTemplate(step.bodyTemplate || '', row))
            }));
         }
         
         emailUpdates.push({
            id: group.main.id,
            subject: resolvedSubject,
            body: resolvedBody,
            followup_data: newFollowupData,
            status: group.main.status
         });
      }

      // Update already-spawned follow-up emails (if they are pending)
      if (group.fup.length > 0 && followupsArr.length > 0) {
         // Sort pending followups functionally by their scheduled time
         group.fup.sort((a,b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
         
         // The number of pending followups corresponds strictly to the last N items in the config array
         const numPending = group.fup.length;
         const templatesToApply = followupsArr.slice(-numPending); 
         
         for (let i = 0; i < group.fup.length; i++) {
            const fuEmail = group.fup[i];
            const tpl = templatesToApply[i] || followupsArr[0]; // fallback
            
            const resolvedBody = normalizeBody(resolveTemplate(tpl.bodyTemplate || bodyTemplate, row));
            const subTpl = tpl.subjectTemplate || subjectTemplate || 'Follow up';
            const resolvedSubject = resolveTemplate(subTpl, row);

            emailUpdates.push({
               id: fuEmail.id,
               subject: resolvedSubject,
               body: resolvedBody
            });
         }
      }
    }

    // Update emails one by one
    for (const update of emailUpdates) {
       const emailUpdateObj = { subject: update.subject, body: update.body };
       if (update.followup_data !== undefined) {
         emailUpdateObj.followup_data = update.followup_data;
       }
       await supabase.from('emails').update(emailUpdateObj).eq('id', update.id);
    }

    // 4. Update Campaign Record
    const campUpdateObj = {
       subject_template: subjectTemplate,
       body_template: bodyTemplate
    };
    if (followupsArr.length > 0) campUpdateObj.followup_config = followupsArr;
    
    await supabase.from('campaigns').update(campUpdateObj).eq('id', campaignId);

    res.status(200).json({ success: true, updatedEmails: emailUpdates.length });

  } catch (err) {
    console.error('Update campaign error:', err);
    res.status(500).json({ error: 'Failed to update campaign' });
  }
};
