const crypto = require('crypto');

function getSecret() {
  const secret = String(process.env.JWT_SECRET || '').trim();
  if (!secret) {
    throw new Error('JWT_SECRET is not configured');
  }
  return secret;
}

const JWT_SECRET = getSecret();

function signStudentSession({ studentId, email }, nowSeconds = Math.floor(Date.now() / 1000)) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    studentId,
    email,
    iat: nowSeconds,
    exp: nowSeconds + 7 * 24 * 60 * 60
  })).toString('base64url');
  const signingInput = `${header}.${payload}`;
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(signingInput).digest('base64url');
  return `${signingInput}.${signature}`;
}

function verifyStudentSession(token, nowSeconds = Math.floor(Date.now() / 1000)) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;

  try {
    const [headerPart, payloadPart, signaturePart] = parts;
    const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8'));
    if (header.alg !== 'HS256' || header.typ !== 'JWT') return null;

    const signingInput = `${headerPart}.${payloadPart}`;
    const expectedSignature = crypto.createHmac('sha256', JWT_SECRET).update(signingInput).digest();
    const receivedSignature = Buffer.from(signaturePart, 'base64url');
    if (expectedSignature.length !== receivedSignature.length || !crypto.timingSafeEqual(expectedSignature, receivedSignature)) {
      return null;
    }

    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
    if (!payload.studentId || !payload.email || !Number.isInteger(payload.exp) || payload.exp <= nowSeconds) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

module.exports = {
  signStudentSession,
  verifyStudentSession
};