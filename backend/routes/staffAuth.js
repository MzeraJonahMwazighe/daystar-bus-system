const express = require('express');
const Staff = require('../models/Staff');
const { acquireOtpRateLimit } = require('../lib/otpRateLimit');
const { issueOtp, consumeOtp } = require('../lib/otp');
const { signStaffSession, STAFF_SESSION_TTL_SECONDS } = require('../lib/staffSession');
const { requireStaff } = require('../middleware/requireStaffAuth');

const router = express.Router();
const GENERIC_OTP_RESPONSE = { message: 'If the email belongs to an active staff account, a sign-in code has been sent.' };
const STAFF_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/'
};

function serializeStaff(staff) {
  return {
    id: String(staff._id),
    email: staff.email,
    name: staff.name,
    role: staff.role,
    campus: staff.campus || null
  };
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

// Staff accounts are created by a super admin (or the create-staff script), never here.
// Unknown or inactive emails get the same response as real ones.
router.post('/request-otp', async (req, res) => {
  const email = normalizeEmail(req.body?.email);

  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'A valid email is required' });
  }

  try {
    const rateLimitResult = await acquireOtpRateLimit(email);
    if (!rateLimitResult.allowed) {
      return res.status(429).json({ error: 'Please wait before requesting another code' });
    }

    const staff = await Staff.findOne({ email, active: true }).select({ _id: 1 }).lean();
    if (!staff) {
      return res.status(200).json(GENERIC_OTP_RESPONSE);
    }

    await issueOtp(email, 'staff');
    return res.status(200).json(GENERIC_OTP_RESPONSE);
  } catch (error) {
    console.error('Staff OTP request failed:', error.message);
    return res.status(500).json({ error: 'Unable to process sign-in code request' });
  }
});

router.post('/verify-otp', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const code = String(req.body?.code || '').trim();

  if (!isValidEmail(email) || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: 'Invalid sign-in request' });
  }

  try {
    const otpAccepted = await consumeOtp(email, code, 'staff');
    if (!otpAccepted) {
      return res.status(401).json({ error: 'Invalid or expired code' });
    }

    const staff = await Staff.findOne({ email, active: true }).lean();
    if (!staff) {
      return res.status(401).json({ error: 'Invalid or expired code' });
    }

    const sessionToken = signStaffSession({ staffId: String(staff._id), email: staff.email });
    res.cookie('staff_session', sessionToken, {
      ...STAFF_COOKIE_OPTIONS,
      maxAge: STAFF_SESSION_TTL_SECONDS * 1000
    });

    return res.json({ verified: true, staff: serializeStaff(staff) });
  } catch (error) {
    console.error('Staff OTP verification failed:', error.message);
    return res.status(500).json({ error: 'Unable to verify code' });
  }
});

router.get('/session', requireStaff(), (req, res) => {
  return res.json({ authenticated: true, staff: serializeStaff(req.staff) });
});

router.post('/logout', (req, res) => {
  res.clearCookie('staff_session', STAFF_COOKIE_OPTIONS);
  return res.json({ loggedOut: true });
});

module.exports = router;
module.exports.serializeStaff = serializeStaff;
