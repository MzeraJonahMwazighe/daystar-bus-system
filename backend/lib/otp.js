const crypto = require('crypto');
const nodemailer = require('nodemailer');
const OtpCode = require('../models/OtpCode');

// Shared one-time-code logic for student login (routes/auth.js) and staff login
// (routes/staffAuth.js). Moved here unchanged from routes/auth.js; the only addition
// is the `audience` argument, which keeps student codes and staff codes apart.

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;
const OTP_AUDIENCES = ['student', 'staff'];

function assertAudience(audience) {
  if (!OTP_AUDIENCES.includes(audience)) {
    throw new Error(`Unknown OTP audience: ${audience}`);
  }
}

// Codes created before the `audience` field existed have no value stored.
// They were all student codes, so "student" matches anything that is not "staff".
function audienceFilter(audience) {
  return audience === 'staff' ? { audience: 'staff' } : { audience: { $ne: 'staff' } };
}

function getOtpHash(email, code, audience = 'student') {
  const secret = process.env.OTP_HMAC_SECRET;
  if (!secret) {
    throw new Error('OTP_HMAC_SECRET is not configured');
  }

  // Student input is unchanged (`email:code`) so codes already issued keep working.
  // Staff codes are hashed with a different prefix, so a hash can never be valid for both.
  const input = audience === 'staff' ? `staff:${email}:${code}` : `${email}:${code}`;
  return crypto.createHmac('sha256', secret).update(input).digest('hex');
}

function generateOtpCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function createSmtpTransport() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS || !process.env.SMTP_FROM) {
    throw new Error('SMTP_HOST, SMTP_USER, SMTP_PASS, and SMTP_FROM are required');
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

async function deliverOtp(email, code, audience = 'student') {
  if (process.env.OTP_DELIVERY_MODE === 'console' && process.env.NODE_ENV !== 'production') {
    console.log(`OTP console delivery: ${email} ${code}`);
    return;
  }

  const isStaff = audience === 'staff';
  const transporter = createSmtpTransport();
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: email,
    subject: isStaff ? 'Daystar Bus System staff sign-in code' : 'Daystar Bus System verification code',
    text: isStaff
      ? `Your Daystar Bus System staff sign-in code is ${code}. It expires in 10 minutes.`
      : `Your Daystar Bus System verification code is ${code}. It expires in 10 minutes.`
  });
}

// Invalidates any unused code for this email + audience, stores a new hashed code and sends it.
// If delivery fails, the new code is invalidated before the error is rethrown.
async function issueOtp(email, audience) {
  assertAudience(audience);
  const code = generateOtpCode();
  const codeHash = getOtpHash(email, code, audience);

  await OtpCode.updateMany(
    { email, used: false, ...audienceFilter(audience) },
    { $set: { used: true } }
  );
  await OtpCode.create({
    email,
    audience,
    code_hash: codeHash,
    expires_at: new Date(Date.now() + OTP_TTL_MS)
  });

  try {
    await deliverOtp(email, code, audience);
  } catch (error) {
    await OtpCode.updateMany(
      { email, used: false, code_hash: codeHash, ...audienceFilter(audience) },
      { $set: { used: true } }
    );
    throw error;
  }
}

// Returns true only for the request that atomically claims a matching, unexpired, unused code.
// 1. Atomically counts the attempt on the newest live code (max 5 attempts per code).
// 2. Compares hashes in constant time.
// 3. Atomically flips used:false -> used:true; if two requests race, only one sees modifiedCount 1.
async function consumeOtp(email, code, audience) {
  assertAudience(audience);

  const otp = await OtpCode.findOneAndUpdate(
    {
      email,
      ...audienceFilter(audience),
      used: false,
      expires_at: { $gt: new Date() },
      attempts: { $lt: MAX_VERIFY_ATTEMPTS }
    },
    { $inc: { attempts: 1 } },
    { new: true, sort: { createdAt: -1 } }
  ).lean();

  if (!otp) return false;

  const expectedHash = Buffer.from(otp.code_hash, 'hex');
  const receivedHash = Buffer.from(getOtpHash(email, code, audience), 'hex');
  const matches = expectedHash.length === receivedHash.length && crypto.timingSafeEqual(expectedHash, receivedHash);
  if (!matches) return false;

  const usedResult = await OtpCode.updateOne(
    { _id: otp._id, used: false },
    { $set: { used: true } }
  );

  return usedResult.modifiedCount === 1;
}

module.exports = {
  OTP_AUDIENCES,
  getOtpHash,
  issueOtp,
  consumeOtp
};
