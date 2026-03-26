const IST_OFFSET_MINUTES = 330; // IST is UTC +05:30

/**
 * Automatic converter between UTC and IST.
 * Takes a day offset and an IST time string (e.g. '10:00' or null).
 * Returns an absolute UTC Date object for the correctly scheduled IST time.
 */
function getUTCFromIST(dayOffset, timeStr) {
  const now = new Date();
  
  // 1. Shift current absolute UTC time to a local IST representation
  const istNow = new Date(now.getTime() + IST_OFFSET_MINUTES * 60000);
  
  // 2. Add day offset in IST space
  istNow.setUTCDate(istNow.getUTCDate() + Number(dayOffset || 0));
  
  // 3. Apply the time mapping in IST space
  if (timeStr && /^\d{2}:\d{2}$/.test(timeStr)) {
    const [hh, mm] = timeStr.split(':').map(Number);
    istNow.setUTCHours(hh, mm, 0, 0);
  }
  
  // 4. Shift back to absolute UTC time
  const absoluteUTC = new Date(istNow.getTime() - IST_OFFSET_MINUTES * 60000);
  
  // 5. Ensure the resulting time is strictly in the future
  if (absoluteUTC <= now) {
    absoluteUTC.setTime(now.getTime() + 60 * 1000);
  }
  
  return absoluteUTC;
}

module.exports = { getUTCFromIST };
