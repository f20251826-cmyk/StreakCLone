const { supabase } = require('../../lib/supabase');
const { refreshAccessToken, sendEmail, checkForReply } = require('../../lib/gmail');

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
      .eq('status', 'pending');

    if (error) throw error;
    if (!pendingEmails || pendingEmails.length === 0) {
      return res.status(200).json({ processed: 0, message: 'No pending emails' });
    }

    // 2. Group by user_id to optimize token refreshes
    const userIds = [...new Set(pendingEmails.map(e => e.user_id))];
    const { data: users, error: userErr } = await supabase
      .from('users')
      .select('id, refresh_token, email')
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

    // 3. Process each email
    let successCount = 0;
    let failCount = 0;

    for (const email of pendingEmails) {
      const accessToken = accessTokenMap[email.user_id];
      const user = users.find(u => u.id === email.user_id);

      if (!accessToken) {
        await markEmailFailed(email.id, 'No valid access token or refresh token expired');
        failCount++;
        continue;
      }

      try {
        // If it's a followup, check for reply first
        if (email.is_followup && email.thread_id) {
          const replied = await checkForReply(accessToken, email.thread_id, user.email);
          if (replied) {
            await supabase.from('emails').update({ status: 'skipped_replied' }).eq('id', email.id);
            continue; // Skip sending
          }
        }

        // Send the email via Gmail API
        const result = await sendEmail(
          accessToken,
          email.to_email,
          email.subject,
          email.body,
          email.thread_id,
          email.rfc_message_id
        );

        // Update email record as sent
        await supabase.from('emails').update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          thread_id: result.threadId,
          message_id: result.id
        }).eq('id', email.id);
        successCount++;

        // If this campaign has a follow-up delay, generate the next email in sequence
        const delayHours = email.campaigns?.followup_delay_hours;
        if (!email.is_followup && delayHours) {
          // Calculate when the followup should send
          const nextDate = new Date();
          nextDate.setHours(nextDate.getHours() + delayHours);

          // Get the followup template from the campaign record (if implemented)
          // For simplicity, we could fetch from campaigns or expect it pre-generated.
          // In Stroke, if action == 'threadedFollowup', it is already handled.
          // Wait, 'action' defines if we should do anything. We don't auto-create followups here unless 
          // we specifically designed it that way. Actually, the frontend handles creating all records at once, 
          // or we can just let users schedule them directly. We'll skip auto-creating follow-ups here. 
        }

      } catch (sendErr) {
        console.error(`Failed to send email ${email.id}:`, sendErr.message);
        await markEmailFailed(email.id, sendErr.message);
        failCount++;
      }
    }

    res.status(200).json({ processed: pendingEmails.length, success: successCount, failed: failCount });
  } catch (err) {
    console.error('Process cron error:', err);
    res.status(500).send('Cron processing failed');
  }
};

async function markEmailFailed(id, errorMsg) {
  await supabase.from('emails').update({ status: 'failed', error: errorMsg }).eq('id', id);
}
