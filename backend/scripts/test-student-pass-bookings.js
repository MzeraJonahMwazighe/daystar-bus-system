require('dotenv').config();

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const Bus = require('../models/Bus');
const OtpCode = require('../models/OtpCode');
const OtpRateLimit = require('../models/OtpRateLimit');
const Payment = require('../models/Payment');
const Route = require('../models/Route');
const Student = require('../models/Student');
const Ticket = require('../models/Ticket');
const Trip = require('../models/Trip');

const TEST_EMAILS = [
  'otp-pass-valid-test@daystar.ac.ke',
  'otp-pass-none-test@daystar.ac.ke',
  'otp-pass-expired-test@daystar.ac.ke',
  'otp-pass-route-test@daystar.ac.ke'
];
const TRIP_DATE = '2026-10-05';
const created = { routeIds: [], busIds: [], tripIds: [], bookingIds: [], ticketIds: [] };

async function request(server, path, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const responseBody = await response.json();
  return { status: response.status, body: responseBody, setCookie: response.headers.get('set-cookie') };
}

function makeSeats(capacity) {
  return Array.from({ length: capacity }, (_, index) => ({
    seat_number: index + 1,
    status: 'available',
    booking_id: null,
    reserved_by: null,
    expires_at: null
  }));
}

async function makeTrip(route, plate) {
  const bus = await Bus.create({ plate, capacity: 6, type: 'Test', route: 'OTP Pass Integration' });
  created.busIds.push(bus._id);
  const trip = await Trip.create({
    bus: bus._id,
    route: route._id,
    trip_date: TRIP_DATE,
    departure_time: '10:00',
    status: 'active',
    seats: makeSeats(bus.capacity)
  });
  created.tripIds.push(trip._id);
  return bus;
}

async function createBooking(server, { busPlate, seat, email, cookie }) {
  const result = await request(server, '/api/bookings', {
    method: 'POST',
    cookie,
    body: {
      busPlate,
      seats: [seat],
      boardingStop: 'Test Start',
      alightingStop: 'Test End',
      passengerName: 'OTP Pass Integration',
      phoneNumber: `0712345${String(seatedPhoneNumber++).padStart(3, '0')}`
    }
  });
  if (result.body.booking_id) created.bookingIds.push(result.body.booking_id);
  console.log(`BOOKING ${email}:`, JSON.stringify({ status: result.status, body: result.body }, null, 2));
  return result;
}

let seatedPhoneNumber = 100;

async function attemptStkPush(server, bookingId, label) {
  const result = await request(server, '/api/mpesa/stk-push', {
    method: 'POST',
    body: { bookingId, phoneNumber: '0712345678' }
  });
  console.log(`STK PATH ${label}:`, JSON.stringify({ status: result.status, body: result.body }, null, 2));
  return result;
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not configured');
  process.env.OTP_HMAC_SECRET = process.env.OTP_HMAC_SECRET || 'test-only-otp-hmac-secret';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-jwt-secret';
  const { signStudentSession } = require('../lib/studentSession');
  process.env.NODE_ENV = 'test';
  for (const name of ['MPESA_CONSUMER_KEY', 'MPESA_CONSUMER_SECRET', 'MPESA_SHORTCODE', 'MPESA_PASSKEY', 'MPESA_CALLBACK_URL']) {
    process.env[name] = '';
  }

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  await Promise.all([
    Booking.init(), Bus.init(), OtpCode.init(), OtpRateLimit.init(), Payment.init(),
    Route.init(), Student.init(), Ticket.init(), Trip.init()
  ]);
  await Promise.all([
    Student.deleteMany({ email: { $in: TEST_EMAILS } }),
    OtpCode.deleteMany({ email: { $in: TEST_EMAILS } }),
    OtpRateLimit.deleteMany({ email: { $in: TEST_EMAILS } })
  ]);

  const route = await Route.create({
    from_location: 'Test Start',
    to_location: 'Test End',
    fare_per_seat: 2,
    stops: [
      { name: 'Test Start', order: 1, zone: 'valley_road_side' },
      { name: 'Test End', order: 2, zone: 'athi_river_side' }
    ]
  });
  created.routeIds.push(route._id);
  const otherRoute = await Route.create({
    from_location: 'Other Start',
    to_location: 'Other End',
    fare_per_seat: 2,
    stops: [
      { name: 'Test Start', order: 1, zone: 'valley_road_side' },
      { name: 'Test End', order: 2, zone: 'athi_river_side' }
    ]
  });
  created.routeIds.push(otherRoute._id);

  const students = await Student.create([
    {
      email: TEST_EMAILS[0], name: 'Pass Holder', admission_number: 'PASS-VALID', has_bus_pass: true,
      pass_valid_from: new Date('2026-10-01T00:00:00.000Z'), pass_valid_until: new Date('2026-10-31T23:59:59.999Z'), pass_route: String(route._id)
    },
    { email: TEST_EMAILS[1], name: 'No Pass', admission_number: 'PASS-NONE', has_bus_pass: false },
    {
      email: TEST_EMAILS[2], name: 'Expired Pass', admission_number: 'PASS-EXPIRED', has_bus_pass: true,
      pass_valid_from: new Date('2026-09-01T00:00:00.000Z'), pass_valid_until: new Date('2026-09-30T23:59:59.999Z'), pass_route: String(route._id)
    },
    {
      email: TEST_EMAILS[3], name: 'Other Route Pass', admission_number: 'PASS-OTHER-ROUTE', has_bus_pass: true,
      pass_valid_from: new Date('2026-10-01T00:00:00.000Z'), pass_valid_until: new Date('2026-10-31T23:59:59.999Z'), pass_route: String(otherRoute._id)
    }
  ]);

  const buses = await Promise.all([
    makeTrip(route, 'OTP-PASS-01'),
    makeTrip(route, 'OTP-PASS-02'),
    makeTrip(route, 'OTP-PASS-03'),
    makeTrip(route, 'OTP-PASS-04'),
    makeTrip(route, 'OTP-PASS-05')
  ]);

  const app = express();
  app.use(express.json());
  let stkRouteHits = 0;
  app.use('/api/mpesa/stk-push', (req, res, next) => {
    stkRouteHits += 1;
    next();
  });
  app.use('/api/auth', require('../routes/auth'));
  app.use('/api/bookings', require('../routes/bookings'));
  app.use('/api/mpesa', require('../routes/mpesa'));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const validStudent = students[0];
    const otpCode = '314159';
    await OtpCode.create({
      email: validStudent.email,
      code_hash: crypto.createHmac('sha256', process.env.OTP_HMAC_SECRET)
        .update(`${validStudent.email}:${otpCode}`).digest('hex'),
      expires_at: new Date(Date.now() + 5 * 60 * 1000)
    });
    const otpVerification = await request(server, '/api/auth/verify-otp', {
      method: 'POST', body: { email: validStudent.email, code: otpCode }
    });
    console.log('OTP VERIFY SESSION ISSUANCE:', JSON.stringify({ status: otpVerification.status, body: otpVerification.body, setCookie: otpVerification.setCookie }, null, 2));
    assert.equal(otpVerification.status, 200);
    assert.match(otpVerification.setCookie, /^student_session=/);
    assert.match(otpVerification.setCookie, /HttpOnly/i);
    assert.match(otpVerification.setCookie, /SameSite=Lax/i);
    const validCookie = otpVerification.setCookie.split(';')[0];

    const missingSecretStartup = spawnSync(process.execPath, ['-e', "require('./backend/lib/studentSession')"], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, JWT_SECRET: '' }
    });
    console.log('JWT_SECRET unset startup check:', JSON.stringify({
      status: missingSecretStartup.status,
      stderr: missingSecretStartup.stderr.trim()
    }, null, 2));
    assert.notEqual(missingSecretStartup.status, 0);
    assert.match(missingSecretStartup.stderr, /JWT_SECRET is not configured/);

    const sessionValid = await request(server, '/api/auth/session', { cookie: validCookie });
    console.log('SESSION valid cookie:', JSON.stringify(sessionValid, null, 2));
    assert.equal(sessionValid.status, 200);
    assert.equal(sessionValid.body.student.email, validStudent.email);

    const sessionMissing = await request(server, '/api/auth/session');
    console.log('SESSION no cookie:', JSON.stringify(sessionMissing, null, 2));
    assert.equal(sessionMissing.status, 401);

    const signatureFinalCharacter = validCookie.at(-1);
    const tamperedFinalCharacter = signatureFinalCharacter === 'A' ? 'B' : 'A';
    const sessionTampered = await request(server, '/api/auth/session', {
      cookie: `${validCookie.slice(0, -1)}${tamperedFinalCharacter}`
    });
    console.log('SESSION tampered token:', JSON.stringify(sessionTampered, null, 2));
    assert.equal(sessionTampered.status, 401);

    const sessionMalformed = await request(server, '/api/auth/session', { cookie: 'student_session=not-a-jwt' });
    console.log('SESSION malformed token:', JSON.stringify(sessionMalformed, null, 2));
    assert.equal(sessionMalformed.status, 401);

    const expiredToken = signStudentSession(
      { studentId: String(validStudent._id), email: validStudent.email },
      Math.floor(Date.now() / 1000) - 8 * 24 * 60 * 60
    );
    const [expiredHeader, expiredPayload, expiredSignature] = expiredToken.split('.');
    const expiredClaims = JSON.parse(Buffer.from(expiredPayload, 'base64url').toString('utf8'));
    const expectedExpiredSignature = crypto.createHmac('sha256', process.env.JWT_SECRET)
      .update(`${expiredHeader}.${expiredPayload}`).digest();
    const receivedExpiredSignature = Buffer.from(expiredSignature, 'base64url');
    const expiredSignatureValid = expectedExpiredSignature.length === receivedExpiredSignature.length &&
      crypto.timingSafeEqual(expectedExpiredSignature, receivedExpiredSignature);
    console.log('EXPIRED token signature/claims proof:', JSON.stringify({
      signatureValid: expiredSignatureValid,
      exp: expiredClaims.exp,
      now: Math.floor(Date.now() / 1000),
      expired: expiredClaims.exp < Math.floor(Date.now() / 1000)
    }, null, 2));
    assert.equal(expiredSignatureValid, true);
    assert.ok(expiredClaims.exp < Math.floor(Date.now() / 1000));
    const sessionExpired = await request(server, '/api/auth/session', { cookie: `student_session=${expiredToken}` });
    console.log('SESSION expired token:', JSON.stringify(sessionExpired, null, 2));
    assert.equal(sessionExpired.status, 401);

    const passBooking = await createBooking(server, { busPlate: buses[0].plate, seat: 1, email: TEST_EMAILS[0], cookie: validCookie });
    assert.equal(passBooking.status, 200);
    assert.equal(passBooking.body.payment_method, 'pass');
    assert.equal(passBooking.body.status, 'booked');
    assert.equal(stkRouteHits, 0);
    const passSavedBooking = await Booking.findOne({ booking_id: passBooking.body.booking_id }).lean();
    console.log('PASS BOOKING SAVED DOCUMENT:', JSON.stringify(passSavedBooking, null, 2));
    assert.equal(passSavedBooking.payment_method, 'pass');
    assert.equal(passSavedBooking.status, 'booked');
    assert.ok(await Ticket.findOne({ booking_id: passBooking.body.booking_id }));
    console.log('PASS STK route hit count after pass booking:', stkRouteHits);
    const passPayments = await Payment.find({ booking_id: passBooking.body.booking_id }).lean();
    console.log('PAYMENT documents for pass booking:', JSON.stringify(passPayments, null, 2));
    assert.deepEqual(passPayments, []);

    const directPassStk = await attemptStkPush(server, passBooking.body.booking_id, 'pass-covered direct request');
    assert.equal(directPassStk.status, 409);
    assert.match(directPassStk.body.error, /covered by a bus pass/);
    assert.equal(stkRouteHits, 1);

    const noPassCookie = `student_session=${signStudentSession({ studentId: String(students[1]._id), email: students[1].email })}`;
    const noPassBooking = await createBooking(server, { busPlate: buses[1].plate, seat: 1, email: TEST_EMAILS[1], cookie: noPassCookie });
    assert.equal(noPassBooking.body.payment_method, 'mpesa');
    const noPassStk = await attemptStkPush(server, noPassBooking.body.booking_id, 'no pass');
    assert.equal(noPassStk.status, 500);
    assert.match(noPassStk.body.error, /Daraja credentials are not configured/);

    const expiredCookie = `student_session=${signStudentSession({ studentId: String(students[2]._id), email: students[2].email })}`;
    const expiredBooking = await createBooking(server, { busPlate: buses[2].plate, seat: 1, email: TEST_EMAILS[2], cookie: expiredCookie });
    assert.equal(expiredBooking.body.payment_method, 'mpesa');
    const expiredStk = await attemptStkPush(server, expiredBooking.body.booking_id, 'expired pass');
    assert.equal(expiredStk.status, 500);

    const wrongRouteCookie = `student_session=${signStudentSession({ studentId: String(students[3]._id), email: students[3].email })}`;
    const wrongRouteBooking = await createBooking(server, { busPlate: buses[3].plate, seat: 1, email: TEST_EMAILS[3], cookie: wrongRouteCookie });
    assert.equal(wrongRouteBooking.body.payment_method, 'mpesa');
    const wrongRouteStk = await attemptStkPush(server, wrongRouteBooking.body.booking_id, 'wrong route');
    assert.equal(wrongRouteStk.status, 500);

    const anonymousBooking = await createBooking(server, { busPlate: buses[4].plate, seat: 1, email: 'anonymous', cookie: null });
    assert.equal(anonymousBooking.body.payment_method, 'mpesa');
    const anonymousStk = await attemptStkPush(server, anonymousBooking.body.booking_id, 'anonymous');
    assert.equal(anonymousStk.status, 500);
    assert.equal(stkRouteHits, 5);

    console.log('ALL STUDENT SESSION AND PASS BOOKING TESTS PASSED');
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    const cleanup = await Promise.all([
      Booking.deleteMany({ booking_id: { $in: created.bookingIds } }),
      Ticket.deleteMany({ booking_id: { $in: created.bookingIds } }),
      Trip.deleteMany({ _id: { $in: created.tripIds } }),
      Bus.deleteMany({ _id: { $in: created.busIds } }),
      Route.deleteMany({ _id: { $in: created.routeIds } }),
      Student.deleteMany({ email: { $in: TEST_EMAILS } }),
      OtpCode.deleteMany({ email: { $in: TEST_EMAILS } }),
      OtpRateLimit.deleteMany({ email: { $in: TEST_EMAILS } })
    ]);
    console.log('SCOPED FIXTURE CLEANUP:', cleanup.map((result) => ({ acknowledged: result.acknowledged, deletedCount: result.deletedCount })));
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error('STUDENT PASS BOOKING TEST ERROR:', error);
  process.exitCode = 1;
});