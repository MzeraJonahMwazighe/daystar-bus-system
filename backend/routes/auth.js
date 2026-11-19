const express = require('express');
const Booking = require('../models/Booking');
const Student = require('../models/Student');
const { acquireOtpRateLimit, releaseOtpRateLimit } = require('../lib/otpRateLimit');
const { issueOtp, consumeOtp } = require('../lib/otp');
const { validatePhoneNumber } = require('../lib/bookingHelpers');
const { readCookie } = require('../lib/cookies');
const { signStudentSession } = require('../lib/studentSession');
const { signSignupSession, verifySignupSession, SIGNUP_SESSION_TTL_SECONDS } = require('../lib/signupSession');
const { requireStudentAuth } = require('../middleware/requireStudentAuth');

const router = express.Router();
const GENERIC_OTP_RESPONSE = { message: 'If the email is eligible, an OTP has been sent.' };
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const STUDENT_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/'
};
const SIGNUP_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/api/auth'
};
const MAX_NAME_LENGTH = 80;
const EMAIL_UNAVAILABLE_MESSAGE = "We couldn't send the email right now. Please try again in a moment.";

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

// The logged-in student's own full profile (includes their phone number).
function serializeOwnProfile(student) {
  return {
    ...serializeStudent(student),
    phone_number: student.phone_number || null
  };
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isDaystarEmail(email) {
  return /^[a-z0-9._%+-]+@daystar\.ac\.ke$/i.test(email);
}

// Student emails end in the admission number, e.g. jonahmzera251582@daystar.ac.ke -> "251582".
// Returns null when the part before @ does not end in digits.
function admissionNumberFromEmail(email) {
  const match = /(\d{4,})@daystar\.ac\.ke$/i.exec(email);
  return match ? match[1] : null;
}

function cleanName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function setStudentSessionCookie(res, student) {
  const sessionToken = signStudentSession({ studentId: String(student._id), email: student.email });
  res.cookie('student_session', sessionToken, { ...STUDENT_COOKIE_OPTIONS, maxAge: SESSION_MAX_AGE_MS });
}

// Any @daystar.ac.ke email gets a code, whether or not it has an account yet.
// This is how new students sign up, and the response never reveals whether an account exists.
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

    try {
      await issueOtp(email, 'student');
    } catch (error) {
      if (error.code === 'OTP_DELIVERY_FAILED') {
        await releaseOtpRateLimit(email, rateLimitResult.rateLimit).catch(() => {});
        return res.status(503).json({ error: EMAIL_UNAVAILABLE_MESSAGE });
      }
      throw error;
    }

    return res.status(200).json(GENERIC_OTP_RESPONSE);
  } catch (error) {
    console.error('OTP request failed:', error.message);
    return res.status(500).json({ error: 'Unable to process OTP request' });
  }
});

// Correct code + existing account  -> logged in (student_session cookie).
// Correct code + no account yet    -> 15-minute signup_session cookie; the page then asks
//                                     for name and phone and calls /complete-profile.
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
      res.cookie('signup_session', signSignupSession({ email }), {
        ...SIGNUP_COOKIE_OPTIONS,
        maxAge: SIGNUP_SESSION_TTL_SECONDS * 1000
      });
      return res.json({
        verified: true,
        needs_profile: true,
        email,
        admission_number: admissionNumberFromEmail(email)
      });
    }

    setStudentSessionCookie(res, student);
    return res.json({
      verified: true,
      student: serializeStudent(student)
    });
  } catch (error) {
    console.error('OTP verification failed:', error.message);
    return res.status(500).json({ error: 'Unable to verify OTP' });
  }
});

// Creates the student account. Only works with a valid signup_session cookie, i.e. within
// 15 minutes of proving ownership of the email. The email always comes from that cookie,
// never from the request body.
router.post('/complete-profile', async (req, res) => {
  const signup = verifySignupSession(readCookie(req, 'signup_session'));
  if (!signup) {
    return res.status(401).json({ error: 'Your sign-up session has expired. Please request a new code.' });
  }

  const email = normalizeEmail(signup.email);
  const name = cleanName(req.body?.name);
  const phoneNumber = String(req.body?.phone_number || '').trim();
  const derivedAdmissionNumber = admissionNumberFromEmail(email);
  const admissionNumber = derivedAdmissionNumber || String(req.body?.admission_number || '').trim();

  if (!name || name.length > MAX_NAME_LENGTH) {
    return res.status(400).json({ error: 'Please enter your full name' });
  }
  if (!validatePhoneNumber(phoneNumber)) {
    return res.status(400).json({ error: 'Please enter a valid phone number (07XXXXXXXX)' });
  }
  if (!/^[A-Za-z0-9\-\/]{3,20}$/.test(admissionNumber)) {
    return res.status(400).json({ error: 'Please enter your admission number' });
  }

  try {
    const student = await Student.create({
      email,
      name,
      admission_number: admissionNumber,
      phone_number: phoneNumber,
      has_bus_pass: false
    });

    res.clearCookie('signup_session', SIGNUP_COOKIE_OPTIONS);
    setStudentSessionCookie(res, student);
    return res.status(201).json({ created: true, student: serializeOwnProfile(student.toObject()) });
  } catch (error) {
    // Unique email index: the account already exists (e.g. completed in another tab).
    if (error.code === 11000) {
      res.clearCookie('signup_session', SIGNUP_COOKIE_OPTIONS);
      return res.status(409).json({ error: 'An account already exists for this email. Please log in.' });
    }
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: Object.values(error.errors).map((item) => item.message).join('; ') });
    }
    console.error('Complete profile failed:', error.message);
    return res.status(500).json({ error: 'Unable to create your account' });
  }
});

router.get('/session', requireStudentAuth, (req, res) => {
  return res.json({ authenticated: true, student: serializeStudent(req.student) });
});

router.get('/me', requireStudentAuth, (req, res) => {
  return res.json({ student: serializeOwnProfile(req.student) });
});

// Students can change their name and phone. Email and admission number stay fixed.
router.patch('/me', requireStudentAuth, async (req, res) => {
  const updates = {};

  if (req.body?.name !== undefined) {
    const name = cleanName(req.body.name);
    if (!name || name.length > MAX_NAME_LENGTH) {
      return res.status(400).json({ error: 'Please enter your full name' });
    }
    updates.name = name;
  }

  if (req.body?.phone_number !== undefined) {
    const phoneNumber = String(req.body.phone_number || '').trim();
    if (!validatePhoneNumber(phoneNumber)) {
      return res.status(400).json({ error: 'Please enter a valid phone number (07XXXXXXXX)' });
    }
    updates.phone_number = phoneNumber;
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Nothing to update' });
  }

  try {
    const student = await Student.findOneAndUpdate(
      { _id: req.student._id },
      { $set: updates },
      { new: true, runValidators: true }
    ).lean();
    return res.json({ student: serializeOwnProfile(student) });
  } catch (error) {
    console.error('Profile update failed:', error.message);
    return res.status(500).json({ error: 'Unable to update your profile' });
  }
});

// The student's own bookings, newest first. Guest bookings are never linked to an account.
router.get('/me/bookings', requireStudentAuth, async (req, res) => {
  try {
    const bookings = await Booking.find({ student: req.student._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate('bus', 'plate')
      .populate('trip', 'trip_date departure_time')
      .lean();

    return res.json(bookings.map((booking) => ({
      booking_id: booking.booking_id,
      bus_id: booking.bus?.plate || null,
      seats: booking.seats,
      boardingStop: booking.boardingStop,
      alightingStop: booking.alightingStop,
      total_amount: booking.total_amount,
      status: booking.status,
      payment_method: booking.payment_method || 'mpesa',
      trip_date: booking.trip?.trip_date || null,
      departure_time: booking.trip?.departure_time || null,
      created_at: booking.createdAt
    })));
  } catch (error) {
    console.error('Booking history failed:', error.message);
    return res.status(500).json({ error: 'Unable to load your bookings' });
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie('student_session', STUDENT_COOKIE_OPTIONS);
  res.clearCookie('signup_session', SIGNUP_COOKIE_OPTIONS);
  return res.json({ loggedOut: true });
});

module.exports = router;
