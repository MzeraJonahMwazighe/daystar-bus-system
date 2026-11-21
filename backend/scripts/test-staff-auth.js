// Real-database + real-HTTP checks for Phase 1 (staff accounts and locked admin routes).
// Run: node backend/scripts/test-staff-auth.js
// Every document this script creates is tracked and removed afterwards with scoped filters.
require('dotenv').config();

const assert = require('node:assert/strict');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const Bus = require('../models/Bus');
const OtpCode = require('../models/OtpCode');
const OtpRateLimit = require('../models/OtpRateLimit');
const Route = require('../models/Route');
const Staff = require('../models/Staff');
const Student = require('../models/Student');
const Ticket = require('../models/Ticket');
const Trip = require('../models/Trip');

const EMAILS = {
  superAdmin: 'staff-test-super@daystar.ac.ke',
  athiAdmin: 'staff-test-athi@daystar.ac.ke',
  nairobiAdmin: 'staff-test-nairobi@daystar.ac.ke',
  driver: 'staff-test-driver@daystar.ac.ke',
  inactive: 'staff-test-inactive@daystar.ac.ke',
  dual: 'staff-test-dual@daystar.ac.ke',          // both a student and a staff member
  created: 'staff-test-created@daystar.ac.ke',     // created through the API
  unknown: 'staff-test-unknown@daystar.ac.ke'      // has no account at all
};
const ALL_TEST_EMAILS = Object.values(EMAILS);
const TEST_BUS_PLATE = 'STAFF-TEST-01';

// Phase 3: bookings need a scheduled trip leaving today or tomorrow (Nairobi time).
const { addDays, departsAt, nairobiDateString } = require('../lib/tripSchedule');
const TOMORROW = addDays(nairobiDateString(), 1);
const created = { routeIds: [], busIds: [], tripIds: [], bookingIds: [] };

const deliveredCodes = {};
const originalLog = console.log;
console.log = (...args) => {
  originalLog(...args);
  const match = args.join(' ').match(/OTP console delivery: (\S+) (\d{6})/);
  if (match) deliveredCodes[match[1]] = match[2];
};

let server;
async function request(path, { method = 'GET', body, cookie, headers = {} } = {}) {
  const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...headers
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  let responseBody = null;
  try { responseBody = await response.json(); } catch { responseBody = null; }
  return { status: response.status, body: responseBody, setCookie: response.headers.get('set-cookie') };
}

function show(label, result) {
  originalLog(`${label}:`, JSON.stringify({ status: result.status, body: result.body, ...(result.setCookie ? { setCookie: result.setCookie } : {}) }));
}

async function seedCode(email, code, audience, { legacy = false } = {}) {
  const { getOtpHash } = require('../lib/otp');
  const doc = {
    email,
    code_hash: getOtpHash(email, code, audience),
    expires_at: new Date(Date.now() + 5 * 60 * 1000),
    used: false,
    attempts: 0,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  if (legacy) {
    // Written straight to the collection so there is no `audience` field, like codes issued before this change.
    const result = await OtpCode.collection.insertOne(doc);
    return result.insertedId;
  }
  const createdDoc = await OtpCode.create({ ...doc, audience });
  return createdDoc._id;
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not configured');
  process.env.OTP_HMAC_SECRET = process.env.OTP_HMAC_SECRET || 'test-only-otp-hmac-secret';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-jwt-secret';
  process.env.OTP_DELIVERY_MODE = 'console';
  process.env.NODE_ENV = 'test';

  const { signStudentSession } = require('../lib/studentSession');
  const { signStaffSession } = require('../lib/staffSession');

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  await Promise.all([Booking.init(), Bus.init(), OtpCode.init(), OtpRateLimit.init(), Route.init(), Staff.init(), Student.init(), Ticket.init(), Trip.init()]);
  await Promise.all([
    Staff.deleteMany({ email: { $in: ALL_TEST_EMAILS } }),
    Student.deleteMany({ email: { $in: ALL_TEST_EMAILS } }),
    OtpCode.deleteMany({ email: { $in: ALL_TEST_EMAILS } }),
    OtpRateLimit.deleteMany({ email: { $in: ALL_TEST_EMAILS } }),
    Bus.deleteMany({ plate: TEST_BUS_PLATE })
  ]);

  const [superAdmin, athiAdmin, nairobiAdmin, driver, inactive, dualStaff] = await Staff.create([
    { email: EMAILS.superAdmin, name: 'Test Super', role: 'super_admin' },
    { email: EMAILS.athiAdmin, name: 'Test Athi Admin', role: 'campus_admin', campus: 'athi' },
    { email: EMAILS.nairobiAdmin, name: 'Test Nairobi Admin', role: 'campus_admin', campus: 'nairobi' },
    { email: EMAILS.driver, name: 'Test Driver', role: 'driver', campus: 'athi' },
    { email: EMAILS.inactive, name: 'Test Inactive', role: 'campus_admin', campus: 'athi', active: false },
    { email: EMAILS.dual, name: 'Test Dual Staff', role: 'campus_admin', campus: 'nairobi' }
  ]);
  const dualStudent = await Student.create({ email: EMAILS.dual, name: 'Test Dual Student', admission_number: 'STAFF-DUAL' });

  // Routes used by POST /api/admin/trips. Real ones are used if they exist; otherwise test ones are made and removed.
  for (const [from_location, to_location] of [['athi', 'nairobi'], ['nairobi', 'athi']]) {
    const existing = await Route.findOne({ from_location, to_location }).lean();
    if (!existing) {
      const route = await Route.create({
        from_location, to_location, fare_per_seat: 2,
        stops: [
          { name: 'Staff Test Start', order: 1, zone: 'valley_road_side' },
          { name: 'Staff Test End', order: 2, zone: 'athi_river_side' }
        ]
      });
      created.routeIds.push(route._id);
    }
  }
  const bookingRoute = await Route.create({
    from_location: 'staff-test-start', to_location: 'staff-test-end', fare_per_seat: 2,
    stops: [
      { name: 'Staff Test Start', order: 1, zone: 'valley_road_side' },
      { name: 'Staff Test End', order: 2, zone: 'athi_river_side' }
    ]
  });
  created.routeIds.push(bookingRoute._id);
  const testBus = await Bus.create({ plate: TEST_BUS_PLATE, capacity: 6, type: 'Test', route: 'Staff Auth Test' });
  created.busIds.push(testBus._id);
  const bookingTrip = await Trip.create({
    bus: testBus._id, route: bookingRoute._id, trip_date: TOMORROW, departure_time: '10:00', departs_at: departsAt(TOMORROW, '10:00'), campus: 'test', status: 'scheduled',
    seats: Array.from({ length: 6 }, (_, index) => ({ seat_number: index + 1, status: 'available', booking_id: null, reserved_by: null, expires_at: null }))
  });
  created.tripIds.push(bookingTrip._id);

  const app = express();
  app.use(express.json());
  app.use('/api/auth', require('../routes/auth'));
  app.use('/api/staff/auth', require('../routes/staffAuth'));
  app.use('/api/admin', require('../routes/admin'));
  app.use('/api/bookings', require('../routes/bookings'));
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    // ---------- 1. Staff login through the real routes ----------
    const requestCode = await request('/api/staff/auth/request-otp', { method: 'POST', body: { email: EMAILS.athiAdmin } });
    show('1a REQUEST code (active campus admin)', requestCode);
    assert.equal(requestCode.status, 200);
    assert.match(deliveredCodes[EMAILS.athiAdmin], /^\d{6}$/);

    const wrongCode = deliveredCodes[EMAILS.athiAdmin] === '000000' ? '111111' : '000000';
    const wrongVerify = await request('/api/staff/auth/verify-otp', { method: 'POST', body: { email: EMAILS.athiAdmin, code: wrongCode } });
    show('1b VERIFY wrong code', wrongVerify);
    assert.equal(wrongVerify.status, 401);

    const verify = await request('/api/staff/auth/verify-otp', { method: 'POST', body: { email: EMAILS.athiAdmin, code: deliveredCodes[EMAILS.athiAdmin] } });
    show('1c VERIFY correct code', verify);
    assert.equal(verify.status, 200);
    assert.equal(verify.body.staff.role, 'campus_admin');
    assert.equal(verify.body.staff.campus, 'athi');
    assert.match(verify.setCookie, /^staff_session=/);
    assert.match(verify.setCookie, /HttpOnly/i);
    assert.match(verify.setCookie, /SameSite=Strict/i);
    assert.match(verify.setCookie, /Max-Age=43200/);
    const athiCookie = verify.setCookie.split(';')[0];

    const reuse = await request('/api/staff/auth/verify-otp', { method: 'POST', body: { email: EMAILS.athiAdmin, code: deliveredCodes[EMAILS.athiAdmin] } });
    show('1d VERIFY same code again', reuse);
    assert.equal(reuse.status, 401);

    const session = await request('/api/staff/auth/session', { cookie: athiCookie });
    show('1e SESSION with cookie', session);
    assert.equal(session.status, 200);
    assert.equal(session.body.staff.email, EMAILS.athiAdmin);

    // ---------- 2. No code for unknown or deactivated emails, same response ----------
    const unknown = await request('/api/staff/auth/request-otp', { method: 'POST', body: { email: EMAILS.unknown } });
    const inactiveRequest = await request('/api/staff/auth/request-otp', { method: 'POST', body: { email: EMAILS.inactive } });
    show('2a REQUEST unknown email', unknown);
    show('2b REQUEST deactivated staff', inactiveRequest);
    assert.equal(unknown.status, 200);
    assert.deepEqual(unknown.body, requestCode.body);
    assert.deepEqual(inactiveRequest.body, requestCode.body);
    assert.equal(deliveredCodes[EMAILS.unknown], undefined);
    assert.equal(deliveredCodes[EMAILS.inactive], undefined);
    const inactiveCodes = await OtpCode.countDocuments({ email: { $in: [EMAILS.unknown, EMAILS.inactive] } });
    originalLog('2c OTP documents stored for unknown + deactivated:', inactiveCodes);
    assert.equal(inactiveCodes, 0);

    // ---------- 3. Locked routes refuse anonymous callers ----------
    for (const [method, path] of [['GET', '/api/admin/bookings'], ['GET', '/api/bookings'], ['POST', '/api/admin/trips'], ['GET', '/api/admin/staff']]) {
      const result = await request(path, { method, body: method === 'POST' ? {} : undefined });
      show(`3 NO COOKIE ${method} ${path}`, result);
      assert.equal(result.status, 401);
    }

    // ---------- 4. Student and staff tokens never cross over ----------
    const studentToken = signStudentSession({ studentId: String(dualStudent._id), email: dualStudent.email });
    const asStaffCookie = await request('/api/admin/bookings', { cookie: `staff_session=${studentToken}` });
    show('4a STUDENT token sent as staff_session', asStaffCookie);
    assert.equal(asStaffCookie.status, 401);
    const studentCookieOnAdmin = await request('/api/admin/bookings', { cookie: `student_session=${studentToken}` });
    show('4b STUDENT cookie on admin route', studentCookieOnAdmin);
    assert.equal(studentCookieOnAdmin.status, 401);
    const staffToken = athiCookie.slice('staff_session='.length);
    const staffAsStudent = await request('/api/auth/session', { cookie: `student_session=${staffToken}` });
    show('4c STAFF token sent as student_session', staffAsStudent);
    assert.equal(staffAsStudent.status, 401);

    // A student token from before the `aud` claim existed still works for students.
    const legacyHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const legacyPayload = Buffer.from(JSON.stringify({ studentId: String(dualStudent._id), email: dualStudent.email, iat: now, exp: now + 3600 })).toString('base64url');
    const legacySignature = crypto.createHmac('sha256', process.env.JWT_SECRET).update(`${legacyHeader}.${legacyPayload}`).digest('base64url');
    const legacyStudent = await request('/api/auth/session', { cookie: `student_session=${legacyHeader}.${legacyPayload}.${legacySignature}` });
    show('4d LEGACY student token (no aud claim)', legacyStudent);
    assert.equal(legacyStudent.status, 200);

    // ---------- 5. Tampered and expired staff cookies ----------
    const lastCharacter = athiCookie.at(-1);
    const tampered = await request('/api/admin/bookings', { cookie: `${athiCookie.slice(0, -1)}${lastCharacter === 'A' ? 'B' : 'A'}` });
    show('5a TAMPERED staff cookie (last character)', tampered);
    assert.equal(tampered.status, 401);
    // Change a character in the middle of the signature too, which always changes the decoded bytes.
    const middleIndex = athiCookie.length - 10;
    const middleCharacter = athiCookie[middleIndex];
    const tamperedMiddle = await request('/api/admin/bookings', {
      cookie: `${athiCookie.slice(0, middleIndex)}${middleCharacter === 'A' ? 'B' : 'A'}${athiCookie.slice(middleIndex + 1)}`
    });
    show('5a2 TAMPERED staff cookie (middle of signature)', tamperedMiddle);
    assert.equal(tamperedMiddle.status, 401);
    const expiredToken = signStaffSession({ staffId: String(athiAdmin._id), email: athiAdmin.email }, now - 13 * 60 * 60);
    const expired = await request('/api/admin/bookings', { cookie: `staff_session=${expiredToken}` });
    show('5b EXPIRED staff cookie (issued 13h ago, 12h lifetime)', expired);
    assert.equal(expired.status, 401);

    // ---------- 6. Role checks ----------
    const driverCookie = `staff_session=${signStaffSession({ staffId: String(driver._id), email: driver.email })}`;
    const driverAdmin = await request('/api/admin/bookings', { cookie: driverCookie });
    show('6a DRIVER on admin bookings', driverAdmin);
    assert.equal(driverAdmin.status, 403);

    const athiBookings = await request('/api/admin/bookings', { cookie: athiCookie });
    originalLog('6b CAMPUS ADMIN admin bookings:', JSON.stringify({ status: athiBookings.status, count: Array.isArray(athiBookings.body) ? athiBookings.body.length : null }));
    assert.equal(athiBookings.status, 200);
    const athiAllBookings = await request('/api/bookings', { cookie: athiCookie });
    originalLog('6c CAMPUS ADMIN GET /api/bookings:', JSON.stringify({ status: athiAllBookings.status, count: Array.isArray(athiAllBookings.body) ? athiAllBookings.body.length : null }));
    assert.equal(athiAllBookings.status, 200);

    const athiStaffList = await request('/api/admin/staff', { cookie: athiCookie });
    show('6d CAMPUS ADMIN list staff (super admin only)', athiStaffList);
    assert.equal(athiStaffList.status, 403);
    const athiCreateStaff = await request('/api/admin/staff', { method: 'POST', cookie: athiCookie, body: { email: EMAILS.created, name: 'X', role: 'driver' } });
    show('6e CAMPUS ADMIN create staff (super admin only)', athiCreateStaff);
    assert.equal(athiCreateStaff.status, 403);

    // ---------- 7. Campus admins only schedule trips from their own campus ----------
    // 30 days ahead, so these never show up as bookable trips on the live site.
    const farDate = addDays(nairobiDateString(), 30);
    const athiNairobi = await Route.findOne({ from_location: 'athi', to_location: 'nairobi' }).lean();
    const nairobiAthi = await Route.findOne({ from_location: 'nairobi', to_location: 'athi' }).lean();
    const tripBody = (route, time) => ({ bus_id: String(testBus._id), route_id: String(route._id), departure_time: time, trip_date: farDate });
    const otherCampusTrip = await request('/api/admin/trips', { method: 'POST', cookie: athiCookie, body: tripBody(nairobiAthi, '07:00') });
    show('7a ATHI admin schedules nairobi->athi', otherCampusTrip);
    assert.equal(otherCampusTrip.status, 403);
    const ownCampusTrip = await request('/api/admin/trips', { method: 'POST', cookie: athiCookie, body: tripBody(athiNairobi, '07:00') });
    show('7b ATHI admin schedules athi->nairobi', ownCampusTrip);
    assert.equal(ownCampusTrip.status, 201);
    created.tripIds.push(ownCampusTrip.body.trip_id);

    // ---------- 8. Super admin ----------
    const superCookie = `staff_session=${signStaffSession({ staffId: String(superAdmin._id), email: superAdmin.email })}`;
    const superTrip = await request('/api/admin/trips', { method: 'POST', cookie: superCookie, body: tripBody(nairobiAthi, '10:00') });
    show('8a SUPER ADMIN schedules nairobi->athi', superTrip);
    assert.equal(superTrip.status, 201);
    created.tripIds.push(superTrip.body.trip_id);

    const staffList = await request('/api/admin/staff', { cookie: superCookie });
    originalLog('8b SUPER ADMIN list staff:', JSON.stringify({ status: staffList.status, testAccountsListed: staffList.body.filter((item) => ALL_TEST_EMAILS.includes(item.email)).length }));
    assert.equal(staffList.status, 200);

    const createDriver = await request('/api/admin/staff', { method: 'POST', cookie: superCookie, body: { email: EMAILS.created, name: 'Created Driver', role: 'driver', campus: 'nairobi' } });
    show('8c SUPER ADMIN create driver', createDriver);
    assert.equal(createDriver.status, 201);
    const duplicate = await request('/api/admin/staff', { method: 'POST', cookie: superCookie, body: { email: EMAILS.created, name: 'Again', role: 'driver' } });
    show('8d SUPER ADMIN create duplicate email', duplicate);
    assert.equal(duplicate.status, 409);
    const noCampus = await request('/api/admin/staff', { method: 'POST', cookie: superCookie, body: { email: 'staff-test-nocampus@daystar.ac.ke', name: 'No Campus', role: 'campus_admin' } });
    show('8e SUPER ADMIN campus admin without campus', noCampus);
    assert.equal(noCampus.status, 400);
    const makeSuper = await request('/api/admin/staff', { method: 'POST', cookie: superCookie, body: { email: 'staff-test-nocampus@daystar.ac.ke', name: 'Another Super', role: 'super_admin' } });
    show('8f SUPER ADMIN create another super admin via API', makeSuper);
    assert.equal(makeSuper.status, 400);
    const editSelf = await request(`/api/admin/staff/${superAdmin._id}`, { method: 'PATCH', cookie: superCookie, body: { active: false } });
    show('8g SUPER ADMIN deactivate self', editSelf);
    assert.equal(editSelf.status, 400);

    // ---------- 9. Deactivation takes effect on the very next request ----------
    const beforeDeactivate = await request('/api/admin/bookings', { cookie: athiCookie });
    assert.equal(beforeDeactivate.status, 200);
    const deactivate = await request(`/api/admin/staff/${athiAdmin._id}`, { method: 'PATCH', cookie: superCookie, body: { active: false } });
    show('9a SUPER ADMIN deactivates athi admin', deactivate);
    assert.equal(deactivate.status, 200);
    assert.equal(deactivate.body.active, false);
    const afterDeactivate = await request('/api/admin/bookings', { cookie: athiCookie });
    show('9b DEACTIVATED admin, same cookie, next request', afterDeactivate);
    assert.equal(afterDeactivate.status, 401);

    // ---------- 10. Student codes and staff codes are separate ----------
    await seedCode(EMAILS.dual, '424242', 'student');
    const studentCodeOnStaff = await request('/api/staff/auth/verify-otp', { method: 'POST', body: { email: EMAILS.dual, code: '424242' } });
    show('10a STUDENT code on staff login', studentCodeOnStaff);
    assert.equal(studentCodeOnStaff.status, 401);
    const studentCodeOnStudent = await request('/api/auth/verify-otp', { method: 'POST', body: { email: EMAILS.dual, code: '424242' } });
    show('10b same STUDENT code on student login (still unused)', { status: studentCodeOnStudent.status, body: { verified: studentCodeOnStudent.body?.verified } });
    assert.equal(studentCodeOnStudent.status, 200);

    await seedCode(EMAILS.dual, '535353', 'staff');
    const staffCodeOnStudent = await request('/api/auth/verify-otp', { method: 'POST', body: { email: EMAILS.dual, code: '535353' } });
    show('10c STAFF code on student login', staffCodeOnStudent);
    assert.equal(staffCodeOnStudent.status, 401);
    const staffCodeOnStaff = await request('/api/staff/auth/verify-otp', { method: 'POST', body: { email: EMAILS.dual, code: '535353' } });
    show('10d same STAFF code on staff login', { status: staffCodeOnStaff.status, body: { verified: staffCodeOnStaff.body?.verified, role: staffCodeOnStaff.body?.staff?.role } });
    assert.equal(staffCodeOnStaff.status, 200);
    assert.equal(dualStaff.role, 'campus_admin');

    // A code stored before the `audience` field existed still works for students, never for staff.
    await seedCode(EMAILS.dual, '616161', 'student', { legacy: true });
    const legacyOnStaff = await request('/api/staff/auth/verify-otp', { method: 'POST', body: { email: EMAILS.dual, code: '616161' } });
    show('10e LEGACY code (no audience) on staff login', legacyOnStaff);
    assert.equal(legacyOnStaff.status, 401);
    const legacyOnStudent = await request('/api/auth/verify-otp', { method: 'POST', body: { email: EMAILS.dual, code: '616161' } });
    show('10f LEGACY code (no audience) on student login', { status: legacyOnStudent.status, body: { verified: legacyOnStudent.body?.verified } });
    assert.equal(legacyOnStudent.status, 200);

    // ---------- 11. Two simultaneous staff verifications of one code: exactly one wins ----------
    const raceCodeId = await seedCode(EMAILS.nairobiAdmin, '707070', 'staff');
    const race = await Promise.all([
      request('/api/staff/auth/verify-otp', { method: 'POST', body: { email: EMAILS.nairobiAdmin, code: '707070' } }),
      request('/api/staff/auth/verify-otp', { method: 'POST', body: { email: EMAILS.nairobiAdmin, code: '707070' } })
    ]);
    originalLog('11a CONCURRENT verify statuses:', race.map((item) => item.status));
    assert.deepEqual(race.map((item) => item.status).sort(), [200, 401]);
    const raceDoc = await OtpCode.findById(raceCodeId).lean();
    originalLog('11b CONCURRENT code document after:', JSON.stringify({ used: raceDoc.used, attempts: raceDoc.attempts }));
    assert.equal(raceDoc.used, true);

    // ---------- 12. Logout clears the cookie ----------
    const logout = await request('/api/staff/auth/logout', { method: 'POST', cookie: superCookie });
    show('12 LOGOUT', logout);
    assert.equal(logout.status, 200);
    assert.match(logout.setCookie, /staff_session=;/);
    assert.match(logout.setCookie, /Expires=Thu, 01 Jan 1970/);

    // ---------- 13. x-fixed-booking-id is ignored in production ----------
    const fixedId = 'STAFF-TEST-FIXED-ID';
    process.env.NODE_ENV = 'production';
    const prodBooking = await request('/api/bookings', {
      method: 'POST',
      headers: { 'x-fixed-booking-id': fixedId },
      body: { tripId: String(bookingTrip._id), seats: [1], boardingStop: 'Staff Test Start', alightingStop: 'Staff Test End', passengerName: 'Staff Test', phoneNumber: '0712999101' }
    });
    process.env.NODE_ENV = 'test';
    if (prodBooking.body?.booking_id) created.bookingIds.push(prodBooking.body.booking_id);
    show('13a NODE_ENV=production booking with x-fixed-booking-id header', prodBooking);
    assert.equal(prodBooking.status, 200);
    assert.notEqual(prodBooking.body.booking_id, fixedId);

    const testBooking = await request('/api/bookings', {
      method: 'POST',
      headers: { 'x-fixed-booking-id': fixedId },
      body: { tripId: String(bookingTrip._id), seats: [2], boardingStop: 'Staff Test Start', alightingStop: 'Staff Test End', passengerName: 'Staff Test', phoneNumber: '0712999102' }
    });
    if (testBooking.body?.booking_id) created.bookingIds.push(testBooking.body.booking_id);
    show('13b NODE_ENV=test booking with x-fixed-booking-id header', testBooking);
    assert.equal(testBooking.status, 200);
    assert.equal(testBooking.body.booking_id, fixedId);

    originalLog('ALL STAFF AUTH TESTS PASSED');
  } finally {
    console.log = originalLog;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    const extraEmails = [...ALL_TEST_EMAILS, 'staff-test-nocampus@daystar.ac.ke'];
    const cleanup = await Promise.all([
      Booking.deleteMany({ booking_id: { $in: created.bookingIds } }),
      Ticket.deleteMany({ booking_id: { $in: created.bookingIds } }),
      Trip.deleteMany({ _id: { $in: created.tripIds.filter(Boolean) } }),
      Bus.deleteMany({ _id: { $in: created.busIds } }),
      Route.deleteMany({ _id: { $in: created.routeIds } }),
      Staff.deleteMany({ email: { $in: extraEmails } }),
      Student.deleteMany({ email: { $in: extraEmails } }),
      OtpCode.deleteMany({ email: { $in: extraEmails } }),
      OtpRateLimit.deleteMany({ email: { $in: extraEmails } })
    ]);
    originalLog('SCOPED CLEANUP:', JSON.stringify(cleanup.map((result) => result.deletedCount)));
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.log = originalLog;
  console.error('STAFF AUTH TEST ERROR:', error);
  process.exitCode = 1;
});
