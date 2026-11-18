const { signSessionToken, verifySessionToken } = require('./sessionToken');

const STUDENT_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

function signStudentSession({ studentId, email }, nowSeconds = Math.floor(Date.now() / 1000)) {
  return signSessionToken({ aud: 'student', studentId, email }, STUDENT_SESSION_TTL_SECONDS, nowSeconds);
}

function verifyStudentSession(token, nowSeconds = Math.floor(Date.now() / 1000)) {
  const payload = verifySessionToken(token, nowSeconds);
  if (!payload) return null;

  // Tokens issued before the `aud` claim existed have none; they were all student tokens.
  // A token that names any other audience (e.g. a staff token) is never accepted here.
  if (payload.aud !== undefined && payload.aud !== 'student') return null;
  if (!payload.studentId || !payload.email) return null;

  return payload;
}

module.exports = {
  signStudentSession,
  verifyStudentSession
};
