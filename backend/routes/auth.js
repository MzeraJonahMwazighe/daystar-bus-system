const express = require('express');
const Student = require('../models/Student');
const { acquireOtpRateLimit } = require('../lib/otpRateLimit');
const { issueOtp, consumeOtp } = require('../lib/otp');
const { signStudentSession } = require('../lib/studentSession');
const { requireStudentAuth } = require('../middleware/requireStudentAuth');

const router = express.Router();
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

    await issueOtp(email, 'student');

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
    const otpAccepted = await consumeOtp(email, code, 'student');
    if (!otpAccepted) {
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