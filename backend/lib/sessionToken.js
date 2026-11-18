const crypto = require('crypto');

// Shared HS256 token signing for student and staff sessions.
// Each token carries an `aud` claim ('student' or 'staff'); the wrappers in
// studentSession.js and staffSession.js refuse tokens meant for the other audience.

function getSecret() {
  const secret = String(process.env.JWT_SECRET || '').trim();
  if (!secret) {
    throw new Error('JWT_SECRET is not configured');
  }
  return secret;
}

const JWT_SECRET = getSecret();

function signSessionToken(claims, ttlSeconds, nowSeconds = Math.floor(Date.now() / 1000)) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    ...claims,
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds
  })).toString('base64url');
  const signingInput = `${header}.${payload}`;
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(signingInput).digest('base64url');
  return `${signingInput}.${signature}`;
}

// Returns the payload only if the signature is valid and the token has not expired.
function verifySessionToken(token, nowSeconds = Math.floor(Date.now() / 1000)) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;

  try {
    const [headerPart, payloadPart, signaturePart] = parts;
    const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8'));
    if (header.alg !== 'HS256' || header.typ !== 'JWT') return null;

    const signingInput = `${headerPart}.${payloadPart}`;
    const expectedSignature = crypto.createHmac('sha256', JWT_SECRET).update(signingInput).digest();
    const receivedSignature = Buffer.from(signaturePart, 'base64url');
    // Only accept the exact encoding this server produces. The last base64url character of a
    // 32-byte signature carries unused padding bits, so e.g. "...A" and "...B" decode to the same
    // bytes; without this check both spellings of one token would be accepted.
    if (receivedSignature.toString('base64url') !== signaturePart) {
      return null;
    }
    if (expectedSignature.length !== receivedSignature.length || !crypto.timingSafeEqual(expectedSignature, receivedSignature)) {
      return null;
    }

    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
    if (!payload || !Number.isInteger(payload.exp) || payload.exp <= nowSeconds) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

module.exports = {
  signSessionToken,
  verifySessionToken
};
