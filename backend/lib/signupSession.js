const { signSessionToken, verifySessionToken } = require('./sessionToken');

// A short-lived pass given to someone who has just proved they own a @daystar.ac.ke
// email (by entering the emailed code) but has no student account yet. Its only use is
// POST /api/auth/complete-profile. It is never accepted as a student or staff session.
const SIGNUP_SESSION_TTL_SECONDS = 15 * 60;

function signSignupSession({ email }, nowSeconds = Math.floor(Date.now() / 1000)) {
  return signSessionToken({ aud: 'signup', email }, SIGNUP_SESSION_TTL_SECONDS, nowSeconds);
}

function verifySignupSession(token, nowSeconds = Math.floor(Date.now() / 1000)) {
  const payload = verifySessionToken(token, nowSeconds);
  if (!payload || payload.aud !== 'signup' || !payload.email) return null;
  return payload;
}

module.exports = {
  SIGNUP_SESSION_TTL_SECONDS,
  signSignupSession,
  verifySignupSession
};
