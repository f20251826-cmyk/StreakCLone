const { supabase } = require('../_lib/supabase');
const { refreshAccessToken, sendEmail, checkForReply } = require('../_lib/gmail');
const { getUTCFromIST } = require('../_lib/timezone');

module.exports = async (req, res) => {
  // Only allow GET requests for cron
  if (req.method !== 'GET') return res.status(405).send('Method Not Allowed');

  // Verify auth token from Vercel cron (if set up)
  const authHeader = req.headers.authorization;
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).send('Unauthorized');
  }

  try {
    // 1. Fetch pending emails whose scheduled time has passed
    const { data: pendingEmails, error } = await supabase
      .from('emails')
      .select('*, campaigns(id, followup_delay_hours, action)')
      .lte('scheduled_at', new Date().toISOString())
      .eq('status', 'pending')
      .order('scheduled_at', { ascending: true })
      .limit(100);

    if (error) throw error;
    if (!pendingEmails || pendingEmails.length === 0) {
      return res.status(200).json({ processed: 0, message: 'No pending emails' });
    }

    // 2. Group by user_id to optimize token refreshes
    const userIds = [...new Set(pendingEmails.map(e => e.user_id))];
    const { data: users, error: userErr } = await supabase
      .from('users')
      .select('id, refresh_token, email, name')
      .in('id', userIds);
    
    if (userErr) throw userErr;

    // Build a map of user ID -> access token
    const accessTokenMap = {};
    for (const user of users) {
      if (!user.refresh_token) continue;
      try {
        accessTokenMap[user.id] = await refreshAccessToken(user.refresh_token);
      } catch (err) {
        console.error(`Failed to refresh token for user ${user.id}:`, err.message);
      }
    }

    // 3. Process each email concurrently
    let successCount = 0;
    let failCount = 0;

    const emailPromises = pendingEmails.map(async (email) => {
      const accessToken = accessTokenMap[email.user_id];
      const user = users.find(u => u.id === email.user_id);

      if (!accessToken) {
        await markEmailFailed(email.id, 'No valid access token or refresh token expired');
        failCount++;
        return;
      }

      try {
        // If it's a followup, check for reply first
        if (email.is_followup && email.thread_id) {
          const replied = await checkForReply(accessToken, email.thread_id, user.email);
          if (replied) {
            await supabase.from('emails').update({ status: 'skipped_replied' }).eq('id', email.id);
            return; // Skip sending
          }
        }

        // Send the email via Gmail API
        const result = await sendEmail(
          accessToken,
          email.to_email,
          email.subject,
          email.body,
          email.thread_id,
          email.rfc_message_id,
          user.name,
          user.email
        );

        // Update email record as sent
        const { error: updateErr } = await supabase.from('emails').update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          thread_id: result.threadId,
          rfc_message_id: result.rfcMessageId || result.id
        }).eq('id', email.id);
        
        if (updateErr) {
          console.error(`Failed to update email ${email.id} after sending:`, updateErr.message);
        }
        successCount++;

        // If this initial email has follow-up data, auto-create follow-up email records
        if (!email.is_followup && Array.isArray(email.followup_data) && email.followup_data.length > 0) {
          const followupsToInsert = [];
          for (const step of email.followup_data) {
            const sendAt = getUTCFromIST(step.dayOffset, step.time);

            followupsToInsert.push({
              campaign_id: email.campaign_id,
              user_id: email.user_id,
              to_email: email.to_email,
              subject: step.subject || email.subject,
              body: step.body || email.body,
              thread_id: result.threadId,
              rfc_message_id: result.rfcMessageId || result.id,
              scheduled_at: sendAt.toISOString(),
              status: 'pending',
              is_followup: true
            });
          }
          if (followupsToInsert.length > 0) {
            const { error: fuErr } = await supabase.from('emails').insert(followupsToInsert);
            if (fuErr) console.error(`Failed to create follow-ups for email ${email.id}:`, fuErr.message);
          }
        }

      } catch (sendErr) {
        console.error(`Failed to send email ${email.id}:`, sendErr.message);
        await markEmailFailed(email.id, sendErr.message);
        failCount++;
      }
    });

    await Promise.allSettled(emailPromises);

    res.status(200).json({ processed: pendingEmails.length, success: successCount, failed: failCount });
  } catch (err) {
    console.error('Process cron error:', err);
    res.status(500).send('Cron processing failed');
  }
};

async function markEmailFailed(id, errorMsg) {
  await supabase.from('emails').update({ status: 'failed', error: errorMsg }).eq('id', id);
}
