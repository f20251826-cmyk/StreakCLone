const { supabase } = require('../lib/supabase');

/**
 * Cleanup old email records and campaign CSV data to stay within
 * Supabase free-tier storage limits.
 */
async function runCleanup() {
  try {
    // Determine the 7-day cutoff from right now
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const cutoff = sevenDaysAgo.toISOString();

    console.log(`Starting cleanup sweep for items scheduled before ${cutoff}`);

    // 1. Delete completed, failed, or skipped emails that are older than 7 days
    const { error: emailErr } = await supabase
      .from('emails')
      .delete()
      .in('status', ['sent', 'failed', 'skipped_replied'])
      .lt('scheduled_at', cutoff);

    if (emailErr) throw emailErr;

    // 2. Clear out the massive csv_data JSON array from campaigns older than 7 days 
    // This safely keeps your metadata and UI campaign history without destroying the 500MB DB Limit
    const { error: campErr } = await supabase
      .from('campaigns')
      .update({ csv_data: null })
      .lt('scheduled_at', cutoff)
      .not('csv_data', 'is', null);

    if (campErr) console.error('Error clearing campaign csv_data:', campErr.message);

    console.log('Database self-cleanup sweep complete');
    return { success: true, message: 'Database self-cleanup sweep complete' };
  } catch (err) {
    console.error('Cleanup cron error:', err);
    throw err;
  }
}

module.exports = { runCleanup };
