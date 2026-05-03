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
  
  const daysToAdd = Number(dayOffset || 0);
  istNow.setUTCDate(istNow.getUTCDate() + daysToAdd);
  
  // 3. Apply the time mapping in IST space
  if (timeStr) {
    const timeMatch = timeStr.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (timeMatch) {
      const hh = Number(timeMatch[1]);
      const mm = Number(timeMatch[2]);
      istNow.setUTCHours(hh, mm, 0, 0);
    }
  }
  
  // 4. Shift back to absolute UTC time
  const absoluteUTC = new Date(istNow.getTime() - IST_OFFSET_MINUTES * 60000);
  
  // 4.5. Enforce minimum delay if dayOffset specifies full days.
  // Because of delayed execution of previous emails, computing '10:00 AM' the next calendar day
  // might result in a delay of less than 24 hours. We ensure minimum full delays.
  if (daysToAdd > 0) {
    const minRequiredTime = new Date(now.getTime() + (daysToAdd * 24 * 60 * 60 * 1000) - (5 * 60000));
    if (absoluteUTC < minRequiredTime) {
      // It shrinks the delay below the required 24hr chunks, so bump to next calendar day.
      absoluteUTC.setUTCDate(absoluteUTC.getUTCDate() + 1);
    }
  }
  
  // 5. Ensure the resulting time is strictly in the future
  if (absoluteUTC <= now) {
    absoluteUTC.setTime(now.getTime() + 60 * 1000);
  }
  
  return absoluteUTC;
}

module.exports = { getUTCFromIST };
