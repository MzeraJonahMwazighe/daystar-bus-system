// Real-database + real-HTTP checks for Phase 2 (student sign-up, profile, booking history).
// Run: node backend/scripts/test-student-signup.js
// Every document this script creates is tracked and removed afterwards with scoped filters.
require('dotenv').config();

const assert = require('node:assert/strict');
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const Bus = require('../models/Bus');
const OtpCode = require('../models/OtpCode');
const OtpRateLimit = require('../models/OtpRateLimit');
const Route = require('../models/Route');
const Student = require('../models/Student');
const Ticket = require('../models/Ticket');
const Trip = require('../models/Trip');

const EMAILS = {
  newStudent: 'signuptest240001@daystar.ac.ke',  // admission number 240001 comes from the email
  noDigits: 'signup-test-nodigits@daystar.ac.ke', // must type the admission number
  existing: 'signuptest240002@daystar.ac.ke',
  other: 'signuptest240003@daystar.ac.ke'
};
const ALL_TEST_EMAILS = Object.values(EMAILS);
const TEST_BUS_PLATE = 'SIGNUP-TEST-01';
const TEST_PHONES = ['0712888101', '0712888102', '0712888103', '0712888104'];
const created = { routeIds: [], busIds: [], tripIds: [], bookingIds: [] };

const deliveredCodes = {};
const originalLog = console.log;
console.log = (...args) => {
  originalLog(...args);
  const match = args.join(' ').match(/OTP console delivery: (\S+) (\d{6})/);
  if (match) deliveredCodes[match[1]] = match[2];
};

let server;
async function request(path, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  let responseBody = null;
  try { responseBody = await response.json(); } catch { responseBody = null; }
  return { status: response.status, body: responseBody, setCookie: response.headers.get('set-cookie') };
}

function show(label, result) {
  originalLog(`${label}:`, JSON.stringify({ status: result.status, body: result.body, ...(result.setCookie ? { setCookie: result.setCookie.replace(/=[A-Za-z0-9._-]{40,}/g, '=<token>') } : {}) }));
}

function cookieFrom(setCookie, name) {
  const match = new RegExp(`${name}=([^;]*)`).exec(setCookie || '');
  return match && match[1] ? `${name}=${match[1]}` : null;
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not configured');
  process.env.OTP_HMAC_SECRET = process.env.OTP_HMAC_SECRET || 'test-only-otp-hmac-secret';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-jwt-secret';
  process.env.OTP_DELIVERY_MODE = 'console';
  process.env.NODE_ENV = 'test';

  const { signStudentSession } = require('../lib/studentSession');
  const { signSignupSession } = require('../lib/signupSession');

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  await Promise.all([Booking.init(), Bus.init(), OtpCode.init(), OtpRateLimit.init(), Route.init(), Student.init(), Ticket.init(), Trip.init()]);
  await Promise.all([
    Student.deleteMany({ email: { $in: ALL_TEST_EMAILS } }),
    OtpCode.deleteMany({ email: { $in: ALL_TEST_EMAILS } }),
    OtpRateLimit.deleteMany({ email: { $in: ALL_TEST_EMAILS } }),
    Bus.deleteMany({ plate: TEST_BUS_PLATE })
  ]);

  const existingStudent = await Student.create({ email: EMAILS.existing, name: 'Existing Student', admission_number: '240002', phone_number: TEST_PHONES[3] });
  const otherStudent = await Student.create({ email: EMAILS.other, name: 'Other Student', admission_number: '240003' });

  const route = await Route.create({
    from_location: 'signup-test-start', to_location: 'signup-test-end', fare_per_seat: 2,
    stops: [
      { name: 'Signup Test Start', order: 1, zone: 'valley_road_side' },
      { name: 'Signup Test End', order: 2, zone: 'athi_river_side' }
    ]
  });
  created.routeIds.push(route._id);
  const bus = await Bus.create({ plate: TEST_BUS_PLATE, capacity: 6, type: 'Test', route: 'Signup Test' });
  created.busIds.push(bus._id);
  const trip = await Trip.create({
    bus: bus._id, route: route._id, trip_date: '2026-11-25', departure_time: '07:00', status: 'active',
    seats: Array.from({ length: 6 }, (_, index) => ({ seat_number: index + 1, status: 'available', booking_id: null, reserved_by: null, expires_at: null }))
  });
  created.tripIds.push(trip._id);

  const app = express();
  app.use(express.json());
  app.use('/api/auth', require('../routes/auth'));
  app.use('/api/bookings', require('../routes/bookings'));
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    // ---------- 1. A new email gets a code, with the same reply an existing account gets ----------
    const newRequest = await request('/api/auth/request-otp', { method: 'POST', body: { email: EMAILS.newStudent } });
    const existingRequest = await request('/api/auth/request-otp', { method: 'POST', body: { email: EMAILS.existing } });
    show('1a REQUEST code, new email', newRequest);
    show('1b REQUEST code, existing account', existingRequest);
    assert.equal(newRequest.status, 200);
    assert.deepEqual(newRequest.body, existingRequest.body);
    assert.match(deliveredCodes[EMAILS.newStudent], /^\d{6}$/);
    assert.match(deliveredCodes[EMAILS.existing], /^\d{6}$/);

    const nonDaystar = await request('/api/auth/request-otp', { method: 'POST', body: { email: 'someone@gmail.com' } });
    show('1c REQUEST code, non-Daystar email', nonDaystar);
    assert.equal(nonDaystar.status, 400);

    // ---------- 2. Verifying a new email gives a sign-up pass, not a login ----------
    const newVerify = await request('/api/auth/verify-otp', { method: 'POST', body: { email: EMAILS.newStudent, code: deliveredCodes[EMAILS.newStudent] } });
    show('2a VERIFY new email', newVerify);
    assert.equal(newVerify.status, 200);
    assert.equal(newVerify.body.needs_profile, true);
    assert.equal(newVerify.body.admission_number, '240001');
    assert.match(newVerify.setCookie, /^signup_session=/);
    assert.match(newVerify.setCookie, /Path=\/api\/auth/);
    assert.match(newVerify.setCookie, /Max-Age=900/);
    assert.match(newVerify.setCookie, /HttpOnly/);
    assert.doesNotMatch(newVerify.setCookie, /student_session=/);
    const signupCookie = cookieFrom(newVerify.setCookie, 'signup_session');
    assert.equal(await Student.countDocuments({ email: EMAILS.newStudent }), 0);

    // The sign-up pass is not a student session.
    const signupAsStudent = await request('/api/auth/me', { cookie: `student_session=${signupCookie.split('=')[1]}` });
    show('2b SIGN-UP pass used as student_session', signupAsStudent);
    assert.equal(signupAsStudent.status, 401);

    // ---------- 3. Completing the profile ----------
    const noSignup = await request('/api/auth/complete-profile', { method: 'POST', body: { name: 'X', phone_number: TEST_PHONES[0] } });
    show('3a COMPLETE without sign-up pass', noSignup);
    assert.equal(noSignup.status, 401);

    const studentTokenAsSignup = `signup_session=${signStudentSession({ studentId: String(otherStudent._id), email: EMAILS.newStudent })}`;
    const wrongPass = await request('/api/auth/complete-profile', { method: 'POST', cookie: studentTokenAsSignup, body: { name: 'X', phone_number: TEST_PHONES[0] } });
    show('3b COMPLETE with a student token as the sign-up pass', wrongPass);
    assert.equal(wrongPass.status, 401);

    const expiredSignup = `signup_session=${signSignupSession({ email: EMAILS.newStudent }, Math.floor(Date.now() / 1000) - 16 * 60)}`;
    const expired = await request('/api/auth/complete-profile', { method: 'POST', cookie: expiredSignup, body: { name: 'X', phone_number: TEST_PHONES[0] } });
    show('3c COMPLETE with sign-up pass issued 16 min ago (15 min lifetime)', expired);
    assert.equal(expired.status, 401);

    const missingName = await request('/api/auth/complete-profile', { method: 'POST', cookie: signupCookie, body: { name: '  ', phone_number: TEST_PHONES[0] } });
    show('3d COMPLETE with blank name', missingName);
    assert.equal(missingName.status, 400);
    const badPhone = await request('/api/auth/complete-profile', { method: 'POST', cookie: signupCookie, body: { name: 'New Student', phone_number: '12345' } });
    show('3e COMPLETE with bad phone', badPhone);
    assert.equal(badPhone.status, 400);

    // Admission number in the body is ignored when the email already contains one.
    const complete = await request('/api/auth/complete-profile', {
      method: 'POST', cookie: signupCookie,
      body: { name: '  New   Student ', phone_number: TEST_PHONES[0], admission_number: '999999' }
    });
    show('3f COMPLETE profile', complete);
    assert.equal(complete.status, 201);
    assert.equal(complete.body.student.admission_number, '240001');
    assert.equal(complete.body.student.name, 'New Student');
    assert.match(complete.setCookie, /student_session=/);
    assert.match(complete.setCookie, /signup_session=;/);
    const newStudentCookie = cookieFrom(complete.setCookie, 'student_session');
    const savedStudent = await Student.findOne({ email: EMAILS.newStudent }).lean();
    originalLog('3g SAVED student document:', JSON.stringify({ email: savedStudent.email, name: savedStudent.name, admission_number: savedStudent.admission_number, phone_number: savedStudent.phone_number, has_bus_pass: savedStudent.has_bus_pass }));
    assert.equal(savedStudent.phone_number, TEST_PHONES[0]);
    assert.equal(savedStudent.has_bus_pass, false);

    const again = await request('/api/auth/complete-profile', { method: 'POST', cookie: signupCookie, body: { name: 'Again', phone_number: TEST_PHONES[0] } });
    show('3h COMPLETE again with the same pass', again);
    assert.equal(again.status, 409);
    assert.equal(await Student.countDocuments({ email: EMAILS.newStudent }), 1);

    // An email without digits needs the admission number typed in.
    const noDigitsCookie = `signup_session=${signSignupSession({ email: EMAILS.noDigits })}`;
    const noAdmission = await request('/api/auth/complete-profile', { method: 'POST', cookie: noDigitsCookie, body: { name: 'No Digits', phone_number: TEST_PHONES[1] } });
    show('3i COMPLETE, email without digits, no admission number', noAdmission);
    assert.equal(noAdmission.status, 400);
    const withAdmission = await request('/api/auth/complete-profile', { method: 'POST', cookie: noDigitsCookie, body: { name: 'No Digits', phone_number: TEST_PHONES[1], admission_number: '23-0456' } });
    show('3j COMPLETE, email without digits, admission number typed', { status: withAdmission.status, body: { admission_number: withAdmission.body?.student?.admission_number } });
    assert.equal(withAdmission.status, 201);
    assert.equal(withAdmission.body.student.admission_number, '23-0456');

    // ---------- 4. Existing students still log straight in ----------
    const existingVerify = await request('/api/auth/verify-otp', { method: 'POST', body: { email: EMAILS.existing, code: deliveredCodes[EMAILS.existing] } });
    show('4 VERIFY existing account', existingVerify);
    assert.equal(existingVerify.status, 200);
    assert.equal(existingVerify.body.needs_profile, undefined);
    assert.equal(existingVerify.body.student.email, EMAILS.existing);
    assert.equal(existingVerify.body.student.phone_number, undefined);
    assert.match(existingVerify.setCookie, /^student_session=/);

    // ---------- 5. Profile ----------
    const me = await request('/api/auth/me', { cookie: newStudentCookie });
    show('5a GET /me', me);
    assert.equal(me.status, 200);
    assert.equal(me.body.student.phone_number, TEST_PHONES[0]);
    const meAnonymous = await request('/api/auth/me');
    show('5b GET /me without login', meAnonymous);
    assert.equal(meAnonymous.status, 401);

    const update = await request('/api/auth/me', { method: 'PATCH', cookie: newStudentCookie, body: { name: 'New Student Renamed', phone_number: TEST_PHONES[2], email: 'hacker@daystar.ac.ke', admission_number: '1', has_bus_pass: true } });
    show('5c PATCH /me (also tries to change email, admission no. and pass)', update);
    assert.equal(update.status, 200);
    const afterUpdate = await Student.findById(savedStudent._id).lean();
    originalLog('5d SAVED after PATCH:', JSON.stringify({ email: afterUpdate.email, name: afterUpdate.name, admission_number: afterUpdate.admission_number, phone_number: afterUpdate.phone_number, has_bus_pass: afterUpdate.has_bus_pass }));
    assert.equal(afterUpdate.name, 'New Student Renamed');
    assert.equal(afterUpdate.phone_number, TEST_PHONES[2]);
    assert.equal(afterUpdate.email, EMAILS.newStudent);
    assert.equal(afterUpdate.admission_number, '240001');
    assert.equal(afterUpdate.has_bus_pass, false);
    const badUpdate = await request('/api/auth/me', { method: 'PATCH', cookie: newStudentCookie, body: { phone_number: '999' } });
    show('5e PATCH /me with bad phone', badUpdate);
    assert.equal(badUpdate.status, 400);

    // ---------- 6. Booking history only shows your own bookings ----------
    const bookingBody = (seat, phone) => ({ busPlate: TEST_BUS_PLATE, seats: [seat], boardingStop: 'Signup Test Start', alightingStop: 'Signup Test End', passengerName: 'Signup Test', phoneNumber: phone });
    const ownBooking = await request('/api/bookings', { method: 'POST', cookie: newStudentCookie, body: bookingBody(1, TEST_PHONES[2]) });
    const guestBooking = await request('/api/bookings', { method: 'POST', body: bookingBody(2, TEST_PHONES[1]) });
    const otherCookie = `student_session=${signStudentSession({ studentId: String(existingStudent._id), email: existingStudent.email })}`;
    const otherBooking = await request('/api/bookings', { method: 'POST', cookie: otherCookie, body: bookingBody(3, TEST_PHONES[3]) });
    for (const result of [ownBooking, guestBooking, otherBooking]) {
      if (result.body?.booking_id) created.bookingIds.push(result.body.booking_id);
    }
    show('6a BOOKING by logged-in student', ownBooking);
    show('6b BOOKING by guest', guestBooking);
    show('6c BOOKING by another student', otherBooking);
    assert.equal(ownBooking.status, 200);
    assert.equal(guestBooking.status, 200);
    assert.equal(otherBooking.status, 200);

    const guestDoc = await Booking.findOne({ booking_id: guestBooking.body.booking_id }).lean();
    originalLog('6d GUEST booking student field:', guestDoc.student);
    assert.equal(guestDoc.student, null);

    const history = await request('/api/auth/me/bookings', { cookie: newStudentCookie });
    show('6e GET /me/bookings', history);
    assert.equal(history.status, 200);
    assert.deepEqual(history.body.map((item) => item.booking_id), [ownBooking.body.booking_id]);
    assert.equal(history.body[0].departure_time, '07:00');
    const historyAnonymous = await request('/api/auth/me/bookings');
    assert.equal(historyAnonymous.status, 401);

    // ---------- 7. Logout ----------
    const logout = await request('/api/auth/logout', { method: 'POST', cookie: newStudentCookie });
    show('7 LOGOUT', logout);
    assert.equal(logout.status, 200);
    assert.match(logout.setCookie, /student_session=;/);
    assert.match(logout.setCookie, /signup_session=;/);

    originalLog('ALL STUDENT SIGN-UP TESTS PASSED');
  } finally {
    console.log = originalLog;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    const cleanup = await Promise.all([
      Booking.deleteMany({ booking_id: { $in: created.bookingIds } }),
      Ticket.deleteMany({ booking_id: { $in: created.bookingIds } }),
      Trip.deleteMany({ _id: { $in: created.tripIds } }),
      Bus.deleteMany({ _id: { $in: created.busIds } }),
      Route.deleteMany({ _id: { $in: created.routeIds } }),
      Student.deleteMany({ email: { $in: ALL_TEST_EMAILS } }),
      OtpCode.deleteMany({ email: { $in: ALL_TEST_EMAILS } }),
      OtpRateLimit.deleteMany({ email: { $in: ALL_TEST_EMAILS } })
    ]);
    originalLog('SCOPED CLEANUP:', JSON.stringify(cleanup.map((result) => result.deletedCount)));
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.log = originalLog;
  console.error('STUDENT SIGN-UP TEST ERROR:', error);
  process.exitCode = 1;
});
