const { signSessionToken, verifySessionToken } = require('./sessionToken');

const STAFF_SESSION_TTL_SECONDS = 12 * 60 * 60;

// The token only identifies the staff member. Their role and active status are
// re-read from the database on every request (see requireStaffAuth.js), so a
// role change or deactivation takes effect immediately.
function signStaffSession({ staffId, email }, nowSeconds = Math.floor(Date.now() / 1000)) {
  return signSessionToken({ aud: 'staff', staffId, email }, STAFF_SESSION_TTL_SECONDS, nowSeconds);
}

function verifyStaffSession(token, nowSeconds = Math.floor(Date.now() / 1000)) {
  const payload = verifySessionToken(token, nowSeconds);
  if (!payload || payload.aud !== 'staff') return null;
  if (!payload.staffId || !payload.email) return null;
  return payload;
}

module.exports = {
  STAFF_SESSION_TTL_SECONDS,
  signStaffSession,
  verifyStaffSession
};
