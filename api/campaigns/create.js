const { supabase } = require('../_lib/supabase');
const jwt = require('jsonwebtoken');
const { getUTCFromIST } = require('../_lib/timezone');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    // 1. Authenticate user via Stroke JWT cookie
    const cookies = req.headers.cookie || '';
    const strokeToken = cookies.split('; ').find(row => row.startsWith('stroke_token='))?.split('=')[1];
    
    if (!strokeToken) return res.status(401).json({ error: 'Unauthorized' });
    
    const user = jwt.verify(strokeToken, process.env.JWT_SECRET || 'fallback-secret');
    if (!user || !user.id) return res.status(401).json({ error: 'Invalid token' });

    const { action, subjectTemplate, bodyTemplate, csvData, headers, scheduledAt, followupDelayHours, followups } = req.body;

    // 2. Validate input
    if (!csvData || !Array.isArray(csvData) || csvData.length === 0) {
      return res.status(400).json({ error: 'No CSV data provided' });
    }

    // 2.b Validate total 7-day duration rule
    const maxFollowupDayOffset = Array.isArray(followups) && followups.length > 0
      ? Math.max(...followups.map(step => Number(step.dayOffset || 0)))
      : 0;

    const startMs = scheduledAt ? new Date(scheduledAt).getTime() : Date.now();
    const endMs = startMs + (maxFollowupDayOffset * 24 * 60 * 60 * 1000);
    const maxAllowedEndMs = Date.now() + (7 * 24 * 60 * 60 * 1000);

    if (endMs > maxAllowedEndMs) {
      return res.status(400).json({ error: 'Campaign total timeframe (schedule delay + max follow-up day offset) cannot exceed 7 days from today.' });
    }

    const emailHeaderIdx = headers.findIndex(h => h.toLowerCase().includes('email'));
    if (emailHeaderIdx === -1) return res.status(400).json({ error: 'No Email column found' });
    if (action === 'threadedFollowup') {
      const hasThreadCol = headers.some(h => String(h).toLowerCase().includes('threadid'));
      if (!hasThreadCol) return res.status(400).json({ error: "Follow-up CSV must include 'threadId' column from send log." });
    }

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
        followup_config: (Array.isArray(followups) && followups.length > 0) ? followups : null,
        status: 'pending' // we will mark it done once processed
      }])
      .select()
      .single();

    if (campErr) throw campErr;

    const resolveTemplate = (tpl, row) => {
      let out = tpl || '';
      headers.forEach((header, i) => {
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

    // 4. Create Individual Email Records (Batched insert)
    const emailsToInsert = [];
    const threadIdx = headers.findIndex(h => String(h).toLowerCase().includes('threadid'));
    const rfcIdx = headers.findIndex(h => String(h).toLowerCase().includes('rfcmessageid'));
    const now = new Date();

    for (const row of csvData) {
      const toEmail = (row[emailHeaderIdx] || '').trim();
      if (!toEmail) continue;

      // Threaded follow-up mode: create multiple follow-ups with custom templates.
      if (action === 'threadedFollowup') {
        let threadId = threadIdx !== -1 ? (row[threadIdx] || '').trim() : '';
        let rfcMessageId = rfcIdx !== -1 ? (row[rfcIdx] || '').trim() : '';
        
        // Defensively strip quotes if any remain
        threadId = threadId.replace(/^["']|["']$/g, '');
        rfcMessageId = rfcMessageId.replace(/^["']|["']$/g, '');
        
        // If user accidentally pasted a full Gmail URL, extract just the ID
        if (threadId.includes('mail.google.com') || threadId.includes('/')) {
          threadId = threadId.split('/').pop().split('?')[0].split('#').pop().trim();
        }

        if (!threadId) continue;

        const followupSteps = Array.isArray(followups) && followups.length ? followups : [{
          dayOffset: 0,
          time: null,
          subjectTemplate: subjectTemplate || 'Follow up',
          bodyTemplate: bodyTemplate || ''
        }];

        for (let stepIdx = 0; stepIdx < followupSteps.length; stepIdx++) {
          const step = followupSteps[stepIdx] || {};
          const stepBodyTemplate = step.bodyTemplate || bodyTemplate || '';
          const resolvedSubject = resolveTemplate(subjectTemplate || 'Follow up', row);
          const resolvedBody = normalizeBody(resolveTemplate(stepBodyTemplate, row));

          const sendAt = getUTCFromIST(step.dayOffset, step.time);

          emailsToInsert.push({
            campaign_id: campaign.id,
            user_id: user.id,
            to_email: toEmail,
            subject: resolvedSubject,
            body: resolvedBody,
            thread_id: threadId,
            rfc_message_id: rfcMessageId,
            scheduled_at: sendAt.toISOString(),
            status: 'pending',
            is_followup: true
          });
        }
        continue;
      }

      // Bulk send mode: one immediate/scheduled email per row.
      const resolvedSubject = resolveTemplate(subjectTemplate, row);
      const resolvedBody = normalizeBody(resolveTemplate(bodyTemplate, row));

      // Pre-resolve follow-up templates per row if followups are configured
      let followupData = null;
      if (Array.isArray(followups) && followups.length > 0) {
        followupData = followups.map(step => ({
          dayOffset: Number(step.dayOffset || 0),
          time: step.time || '10:00',
          body: normalizeBody(resolveTemplate(step.bodyTemplate || bodyTemplate || '', row))
        }));
      }

      emailsToInsert.push({
        campaign_id: campaign.id,
        user_id: user.id,
        to_email: toEmail,
        subject: resolvedSubject,
        body: resolvedBody,
        scheduled_at: campaign.scheduled_at,
        status: 'pending',
        is_followup: false,
        followup_data: followupData
      });
    }

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
