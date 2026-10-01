const crypto = require('crypto');
const express = require('express');
const nodemailer = require('nodemailer');
const OtpCode = require('../models/OtpCode');
const Student = require('../models/Student');
const { acquireOtpRateLimit } = require('../lib/otpRateLimit');
const { signStudentSession } = require('../lib/studentSession');
const { requireStudentAuth } = require('../middleware/requireStudentAuth');

const router = express.Router();
const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;
const GENERIC_OTP_RESPONSE = { message: 'If the email is eligible, an OTP has been sent.' };
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function serializeStudent(student) {
  return {
    email: student.email,
    name: student.name,
    admission_number: student.admission_number,
    has_bus_pass: student.has_bus_pass,
    pass_valid_from: student.pass_valid_from,
    pass_valid_until: student.pass_valid_until,
    pass_route: student.pass_route
  };
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isDaystarEmail(email) {
  return /^[a-z0-9._%+-]+@daystar\.ac\.ke$/i.test(email);
}

function getOtpHash(email, code) {
  const secret = process.env.OTP_HMAC_SECRET;
  if (!secret) {
    throw new Error('OTP_HMAC_SECRET is not configured');
  }

  return crypto.createHmac('sha256', secret).update(`${email}:${code}`).digest('hex');
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

async function deliverOtp(email, code) {
  if (process.env.OTP_DELIVERY_MODE === 'console' && process.env.NODE_ENV !== 'production') {
    console.log(`OTP console delivery: ${email} ${code}`);
    return;
  }

  const transporter = createSmtpTransport();
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: email,
    subject: 'Daystar Bus System verification code',
    text: `Your Daystar Bus System verification code is ${code}. It expires in 10 minutes.`
  });
}

router.post('/request-otp', async (req, res) => {
  const email = normalizeEmail(req.body?.email);

  if (!isDaystarEmail(email)) {
    return res.status(400).json({ error: 'A valid @daystar.ac.ke email is required' });
  }

  try {
    const rateLimitResult = await acquireOtpRateLimit(email);
    if (!rateLimitResult.allowed) {
      return res.status(429).json({ error: 'Please wait before requesting another OTP' });
    }

    const student = await Student.findOne({ email }).select({ _id: 1 }).lean();
    if (!student) {
      return res.status(200).json(GENERIC_OTP_RESPONSE);
    }

    const code = generateOtpCode();
    await OtpCode.updateMany(
      { email, used: false },
      { $set: { used: true } }
    );
    await OtpCode.create({
      email,
      code_hash: getOtpHash(email, code),
      expires_at: new Date(Date.now() + OTP_TTL_MS)
    });

    try {
      await deliverOtp(email, code);
    } catch (error) {
      await OtpCode.updateMany(
        { email, used: false, code_hash: getOtpHash(email, code) },
        { $set: { used: true } }
      );
      throw error;
    }

    return res.status(200).json(GENERIC_OTP_RESPONSE);
  } catch (error) {
    console.error('OTP request failed:', error.message);
    return res.status(500).json({ error: 'Unable to process OTP request' });
  }
});

router.post('/verify-otp', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const code = String(req.body?.code || '').trim();

  if (!isDaystarEmail(email) || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: 'Invalid OTP verification request' });
  }

  try {
    const otp = await OtpCode.findOneAndUpdate(
      {
        email,
        used: false,
        expires_at: { $gt: new Date() },
        attempts: { $lt: MAX_VERIFY_ATTEMPTS }
      },
      { $inc: { attempts: 1 } },
      { new: true, sort: { createdAt: -1 } }
    ).lean();

    if (!otp) {
      return res.status(401).json({ error: 'Invalid or expired OTP' });
    }

    const expectedHash = Buffer.from(otp.code_hash, 'hex');
    const receivedHash = Buffer.from(getOtpHash(email, code), 'hex');
    const matches = expectedHash.length === receivedHash.length && crypto.timingSafeEqual(expectedHash, receivedHash);

    if (!matches) {
      return res.status(401).json({ error: 'Invalid or expired OTP' });
    }

    const usedResult = await OtpCode.updateOne(
      { _id: otp._id, used: false },
      { $set: { used: true } }
    );

    if (usedResult.modifiedCount !== 1) {
      return res.status(401).json({ error: 'Invalid or expired OTP' });
    }

    const student = await Student.findOne({ email }).lean();
    if (!student) {
      return res.status(401).json({ error: 'Invalid or expired OTP' });
    }

    const sessionToken = signStudentSession({ studentId: String(student._id), email: student.email });
    res.cookie('student_session', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: SESSION_MAX_AGE_MS,
      path: '/'
    });

    return res.json({
      verified: true,
      student: serializeStudent(student)
    });
  } catch (error) {
    console.error('OTP verification failed:', error.message);
    return res.status(500).json({ error: 'Unable to verify OTP' });
  }
});

router.get('/session', requireStudentAuth, (req, res) => {
  return res.json({ authenticated: true, student: serializeStudent(req.student) });
});

module.exports = router;