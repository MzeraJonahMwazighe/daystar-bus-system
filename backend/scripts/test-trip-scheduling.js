// Phase 3 tests: trip scheduling, clashes, campus permissions, booking a trip, per-trip phone
// rule, cancellation and refunds, copying a day.
//
// Runs against a separate, throwaway database on the same Atlas cluster (TEST_DB_NAME), so
// it never touches live data or the live site's indexes. The database is dropped at the end.
// Run: node backend/scripts/test-trip-scheduling.js
require('dotenv').config();

const assert = require('node:assert/strict');
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');

const TEST_DB_NAME = 'daystar_trip_scheduling_test';

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
  const text = await response.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: response.status, body: parsed };
}

function show(label, result) {
  console.log(`${label}: ${result.status} ${JSON.stringify(result.body).slice(0, 220)}`);
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not configured');
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-jwt-secret';
  process.env.OTP_HMAC_SECRET = process.env.OTP_HMAC_SECRET || 'test-only-otp-hmac-secret';
  process.env.NODE_ENV = 'test';

  const Booking = require('../models/Booking');
  const Bus = require('../models/Bus');
  const Route = require('../models/Route');
  const Staff = require('../models/Staff');
  const Student = require('../models/Student');
  const Ticket = require('../models/Ticket');
  const Trip = require('../models/Trip');
  const { signStaffSession } = require('../lib/staffSession');
  const { confirmBookingPayment } = require('../lib/paymentHelpers');
  const { addDays, nairobiDateString } = require('../lib/tripSchedule');

  await mongoose.connect(process.env.MONGODB_URI, { dbName: TEST_DB_NAME, serverSelectionTimeoutMS: 15000 });
  assert.equal(mongoose.connection.db.databaseName, TEST_DB_NAME, 'must run against the throwaway test database');
  await mongoose.connection.db.dropDatabase();
  for (const model of [Booking, Bus, Route, Staff, Student, Ticket, Trip]) {
    await model.createCollection();
    await model.init();
  }

  // ---------- fixtures ----------
  const stops = (first, last) => [
    { name: first, order: 1, zone: 'athi_river_side' },
    { name: 'Middle Stop', order: 2, zone: 'athi_river_side' },
    { name: last, order: 3, zone: 'valley_road_side' }
  ];
  const athiRoute = await Route.create({ from_location: 'athi', to_location: 'nairobi', fare_per_seat: 2, stops: stops('Main Campus', 'Valley Road Campus') });
  const nairobiRoute = await Route.create({ from_location: 'nairobi', to_location: 'athi', fare_per_seat: 2, stops: stops('Valley Road Campus', 'Main Campus') });
  const noStopsRoute = await Route.create({ from_location: 'athi', to_location: 'syokimau', fare_per_seat: 1, stops: [] });

  const [bus1, bus2, bus3, bus4] = await Bus.create([
    { plate: 'TEST001', capacity: 6, type: 'new', route: 'test' },
    { plate: 'TEST002', capacity: 4, type: 'old', route: 'test' },
    { plate: 'TEST003', capacity: 4, type: 'old', route: 'test' },
    { plate: 'TEST004', capacity: 4, type: 'old', route: 'test' }
  ]);

  const [superAdmin, athiAdmin, nairobiAdmin, driver1, driver2, inactiveDriver] = await Staff.create([
    { email: 'super@test.daystar', name: 'Super', role: 'super_admin' },
    { email: 'athi@test.daystar', name: 'Athi Admin', role: 'campus_admin', campus: 'athi' },
    { email: 'nairobi@test.daystar', name: 'Nairobi Admin', role: 'campus_admin', campus: 'nairobi' },
    { email: 'driver1@test.daystar', name: 'Driver One', role: 'driver', campus: 'athi' },
    { email: 'driver2@test.daystar', name: 'Driver Two', role: 'driver', campus: 'nairobi' },
    { email: 'driver3@test.daystar', name: 'Old Driver', role: 'driver', campus: 'athi', active: false }
  ]);
  const cookieFor = (staff) => `staff_session=${signStaffSession({ staffId: String(staff._id), email: staff.email })}`;
  const athi = cookieFor(athiAdmin);
  const nairobi = cookieFor(nairobiAdmin);
  const superCookie = cookieFor(superAdmin);
  const driverCookie = cookieFor(driver1);

  const today = nairobiDateString();
  const tomorrow = addDays(today, 1);
  const dayAfter = addDays(today, 2);

  const app = express();
  app.use(express.json());
  app.use('/api/admin', require('../routes/admin'));
  app.use('/api/trips', require('../routes/trips'));
  app.use('/api/bookings', require('../routes/bookings'));
  app.use('/api/mpesa', require('../routes/mpesa'));
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  const createTrip = (cookie, body) => request('/api/admin/trips', { method: 'POST', cookie, body });
  // Trips from Athi River board at Main Campus; trips from Nairobi board at Valley Road.
  const book = (tripId, seat, phone, fromNairobi = false) => request('/api/bookings', {
    method: 'POST',
    body: {
      tripId,
      seats: [seat],
      boardingStop: fromNairobi ? 'Valley Road Campus' : 'Main Campus',
      alightingStop: fromNairobi ? 'Main Campus' : 'Valley Road Campus',
      passengerName: 'Trip Test',
      phoneNumber: phone
    }
  });

  try {
    // ---------- 1. Access and the form options ----------
    const driverAccess = await request('/api/admin/trips', { cookie: driverCookie });
    show('1a DRIVER GET /api/admin/trips', driverAccess);
    assert.equal(driverAccess.status, 403);

    const options = await request('/api/admin/schedule-options', { cookie: athi });
    show('1b ATHI schedule-options', options);
    assert.equal(options.status, 200);
    assert.deepEqual(options.body.campuses, ['athi']);
    assert.deepEqual(options.body.routes.map((route) => route.id), [String(athiRoute._id)], 'only athi routes that have stops');
    assert.deepEqual(options.body.drivers.map((driver) => driver.name).sort(), ['Driver One', 'Driver Two'], 'inactive driver hidden');

    // ---------- 2. Creating trips ----------
    const trip1 = await createTrip(athi, { route_id: athiRoute._id, bus_id: bus1._id, driver_id: driver1._id, trip_date: tomorrow, departure_time: '07:00' });
    show('2a ATHI create 07:00 TEST001 Driver One', trip1);
    assert.equal(trip1.status, 201);
    const trip1Id = trip1.body.trip_id;
    const savedTrip1 = await Trip.findById(trip1Id).lean();
    assert.equal(savedTrip1.campus, 'athi');
    assert.equal(savedTrip1.status, 'scheduled');
    assert.equal(savedTrip1.seats.length, 6);
    assert.equal(savedTrip1.departs_at.toISOString(), new Date(`${tomorrow}T04:00:00.000Z`).toISOString(), '07:00 Nairobi = 04:00 UTC');

    const wrongCampus = await createTrip(nairobi, { route_id: athiRoute._id, bus_id: bus2._id, trip_date: tomorrow, departure_time: '15:00' });
    show('2b NAIROBI admin creates an Athi River trip', wrongCampus);
    assert.equal(wrongCampus.status, 403);

    const wrongCampusView = await request(`/api/admin/trips?date=${tomorrow}&campus=athi`, { cookie: nairobi });
    show('2c NAIROBI admin views Athi River trips', wrongCampusView);
    assert.equal(wrongCampusView.status, 403);

    for (const [label, body, expected] of [
      ['2d route without stops', { route_id: noStopsRoute._id, bus_id: bus2._id, trip_date: tomorrow, departure_time: '15:00' }, 400],
      ['2e inactive driver', { route_id: athiRoute._id, bus_id: bus2._id, driver_id: inactiveDriver._id, trip_date: tomorrow, departure_time: '15:00' }, 400],
      ['2f invalid time 25:00', { route_id: athiRoute._id, bus_id: bus2._id, trip_date: tomorrow, departure_time: '25:00' }, 400],
      ['2g invalid date', { route_id: athiRoute._id, bus_id: bus2._id, trip_date: '2026-02-30', departure_time: '15:00' }, 400],
      ['2h time already passed', { route_id: athiRoute._id, bus_id: bus2._id, trip_date: addDays(today, -1), departure_time: '15:00' }, 400]
    ]) {
      const result = await createTrip(athi, body);
      show(`${label}`, result);
      assert.equal(result.status, expected, label);
    }

    // ---------- 3. Clashes ----------
    const busClash = await createTrip(athi, { route_id: athiRoute._id, bus_id: bus1._id, trip_date: tomorrow, departure_time: '08:00' });
    show('3a same bus 1h later (same campus)', busClash);
    assert.equal(busClash.status, 409);
    assert.match(busClash.body.error, /bus already has a trip at 07:00/);

    const crossCampusClash = await createTrip(nairobi, { route_id: nairobiRoute._id, bus_id: bus1._id, trip_date: tomorrow, departure_time: '08:59' });
    show('3b same bus 1h59 later (other campus)', crossCampusClash);
    assert.equal(crossCampusClash.status, 409);

    const twoHoursLater = await createTrip(nairobi, { route_id: nairobiRoute._id, bus_id: bus1._id, trip_date: tomorrow, departure_time: '09:00' });
    show('3c same bus exactly 2h later (other campus)', twoHoursLater);
    assert.equal(twoHoursLater.status, 201);
    const nairobiTripId = twoHoursLater.body.trip_id;

    const driverClash = await createTrip(athi, { route_id: athiRoute._id, bus_id: bus2._id, driver_id: driver1._id, trip_date: tomorrow, departure_time: '07:30' });
    show('3d same driver 30 min later', driverClash);
    assert.equal(driverClash.status, 409);
    assert.match(driverClash.body.error, /driver already has a trip/);

    const trip2 = await createTrip(athi, { route_id: athiRoute._id, bus_id: bus2._id, driver_id: driver2._id, trip_date: tomorrow, departure_time: '07:30' });
    show('3e other driver 30 min later', trip2);
    assert.equal(trip2.status, 201);
    const trip2Id = trip2.body.trip_id;

    // Two admins grab the same bus at the same moment: exactly one may win, every time.
    for (let round = 0; round < 4; round++) {
      const hour = String(12 + round * 2).padStart(2, '0');
      const [fromAthi, fromNairobi] = await Promise.all([
        createTrip(athi, { route_id: athiRoute._id, bus_id: bus3._id, trip_date: dayAfter, departure_time: `${hour}:00` }),
        createTrip(nairobi, { route_id: nairobiRoute._id, bus_id: bus3._id, trip_date: dayAfter, departure_time: `${hour}:30` })
      ]);
      console.log(`3f RACE round ${round + 1}: athi ${fromAthi.status}, nairobi ${fromNairobi.status}`);
      assert.deepEqual([fromAthi.status, fromNairobi.status].sort(), [201, 409]);
    }
    const bus3Trips = await Trip.countDocuments({ bus: bus3._id, status: 'scheduled' });
    console.log('3g TEST003 trips after 4 races:', bus3Trips);
    assert.equal(bus3Trips, 4);

    // ---------- 4. Students see and book trips ----------
    const publicList = await request('/api/trips');
    show('4a GET /api/trips', publicList);
    assert.equal(publicList.status, 200);
    assert.deepEqual(publicList.body.dates, [today, tomorrow]);
    const listedIds = publicList.body.trips.map((trip) => trip.id);
    assert.ok(listedIds.includes(trip1Id) && listedIds.includes(trip2Id) && listedIds.includes(nairobiTripId));
    assert.equal(publicList.body.trips.filter((trip) => trip.trip_date === dayAfter).length, 0, 'day after tomorrow not bookable yet');

    const dayAfterTrip = await Trip.findOne({ bus: bus3._id }).lean();
    const tooEarly = await book(String(dayAfterTrip._id), 1, '0712000001');
    show('4b book a trip two days ahead', tooEarly);
    assert.equal(tooEarly.status, 409);

    const first = await book(trip1Id, 1, '0712000010');
    show('4c GUEST books trip1 seat 1', first);
    assert.equal(first.status, 200);

    const samePhoneSameTrip = await book(trip1Id, 2, '0712000010');
    show('4d same phone, same trip', samePhoneSameTrip);
    assert.equal(samePhoneSameTrip.status, 409);
    assert.match(samePhoneSameTrip.body.error, /already has a booking on this trip/);
    const seat2After = (await Trip.findById(trip1Id).lean()).seats.find((seat) => seat.seat_number === 2);
    console.log('4d+ seat 2 after the refused booking:', seat2After.status);
    assert.equal(seat2After.status, 'available', 'refused booking gives its seat straight back');

    const samePhoneOtherTrip = await book(nairobiTripId, 1, '0712000010', true);
    show('4e same phone, the trip home', samePhoneOtherTrip);
    assert.equal(samePhoneOtherTrip.status, 200);

    const [raceA, raceB] = await Promise.all([book(trip1Id, 3, '0712000021'), book(trip1Id, 3, '0712000022')]);
    console.log(`4f RACE for seat 3: ${raceA.status}, ${raceB.status}`);
    assert.deepEqual([raceA.status, raceB.status].sort(), [200, 409]);

    const tripDetail = await request(`/api/trips/${trip1Id}`);
    show('4g GET /api/trips/:id', tripDetail);
    assert.equal(tripDetail.body.bookable, true);
    assert.deepEqual(tripDetail.body.bookedSeats.map((seat) => seat.seat_number).sort(), [1, 3]);
    assert.equal(tripDetail.body.seats_left, 4);
    assert.equal(tripDetail.body.stops.length, 3);

    // A trip that already left today can't be booked.
    const leftTrip = await Trip.create({
      bus: bus4._id, route: athiRoute._id, trip_date: today, departure_time: '00:00',
      departs_at: new Date(Date.now() - 60 * 1000), campus: 'athi', status: 'scheduled',
      seats: Array.from({ length: 4 }, (_, index) => ({ seat_number: index + 1 }))
    });
    const afterDeparture = await book(String(leftTrip._id), 1, '0712000030');
    show('4h book a trip that left a minute ago', afterDeparture);
    assert.equal(afterDeparture.status, 409);

    // ---------- 5. Editing ----------
    const editTime = await request(`/api/admin/trips/${trip1Id}`, { method: 'PATCH', cookie: athi, body: { departure_time: '06:45' } });
    show('5a move trip1 to 06:45', editTime);
    assert.equal(editTime.status, 200);
    const movedTrip = await Trip.findById(trip1Id).lean();
    assert.equal(movedTrip.departure_time, '06:45');
    assert.equal(movedTrip.departs_at.toISOString(), new Date(`${tomorrow}T03:45:00.000Z`).toISOString());

    const editBusWithBookings = await request(`/api/admin/trips/${trip1Id}`, { method: 'PATCH', cookie: athi, body: { bus_id: String(bus4._id) } });
    show('5b change bus on a trip with bookings', editBusWithBookings);
    assert.equal(editBusWithBookings.status, 409);

    const editBusEmpty = await request(`/api/admin/trips/${trip2Id}`, { method: 'PATCH', cookie: athi, body: { bus_id: String(bus4._id) } });
    show('5c change bus on an empty trip', editBusEmpty);
    assert.equal(editBusEmpty.status, 200);
    assert.equal(String((await Trip.findById(trip2Id).lean()).bus), String(bus4._id));

    const editIntoClash = await request(`/api/admin/trips/${nairobiTripId}`, { method: 'PATCH', cookie: nairobi, body: { departure_time: '08:00' } });
    show('5d move the Nairobi trip to clash with its own bus', editIntoClash);
    assert.equal(editIntoClash.status, 409);

    const editOtherCampus = await request(`/api/admin/trips/${trip1Id}`, { method: 'PATCH', cookie: nairobi, body: { departure_time: '06:30' } });
    show('5e NAIROBI admin edits an Athi River trip', editOtherCampus);
    assert.equal(editOtherCampus.status, 403);

    // ---------- 6. Cancelling ----------
    // trip1 has: seat 1 (reserved, 0712000010) and seat 3 (reserved). Pay for seat 1 first.
    const paidBookingId = first.body.booking_id;
    await Booking.updateOne({ booking_id: paidBookingId }, { $set: { mpesa_receipt_number: 'TESTRECEIPT1' } });
    await confirmBookingPayment(paidBookingId);
    assert.equal((await Booking.findOne({ booking_id: paidBookingId }).lean()).status, 'booked');
    const unpaidBookingId = (raceA.status === 200 ? raceA : raceB).body.booking_id;

    const preview = await request(`/api/admin/trips/${trip1Id}/bookings`, { cookie: athi });
    show('6a bookings before cancelling', preview);
    assert.equal(preview.body.length, 2);

    const cancelOther = await request(`/api/admin/trips/${trip1Id}/cancel`, { method: 'POST', cookie: nairobi });
    show('6b NAIROBI admin cancels an Athi River trip', cancelOther);
    assert.equal(cancelOther.status, 403);

    const cancel = await request(`/api/admin/trips/${trip1Id}/cancel`, { method: 'POST', cookie: athi });
    show('6c ATHI cancels trip1', cancel);
    assert.equal(cancel.status, 200);
    const statuses = Object.fromEntries(cancel.body.affected.map((booking) => [booking.booking_id, booking.status]));
    assert.equal(statuses[paidBookingId], 'refund_due');
    assert.equal(statuses[unpaidBookingId], 'cancelled');
    assert.equal((await Ticket.findOne({ booking_id: paidBookingId }).lean()).status, 'cancelled');

    const cancelAgain = await request(`/api/admin/trips/${trip1Id}/cancel`, { method: 'POST', cookie: athi });
    show('6d cancel it again', cancelAgain);
    assert.equal(cancelAgain.status, 409);

    const bookCancelled = await book(trip1Id, 5, '0712000040');
    show('6e book the cancelled trip', bookCancelled);
    assert.equal(bookCancelled.status, 409);
    assert.ok(!(await request('/api/trips')).body.trips.some((trip) => trip.id === trip1Id), 'cancelled trip hidden from students');

    const editCancelled = await request(`/api/admin/trips/${trip1Id}`, { method: 'PATCH', cookie: athi, body: { departure_time: '07:00' } });
    show('6f edit the cancelled trip', editCancelled);
    assert.equal(editCancelled.status, 409);

    // A payment that lands after the trip was cancelled: seats are never confirmed and the
    // booking becomes refund_due. Simulates an STK push answered after the cancellation.
    const latePayer = await book(nairobiTripId, 2, '0712000050', true);
    assert.equal(latePayer.status, 200);
    await Booking.updateOne({ booking_id: latePayer.body.booking_id }, { $set: { checkout_request_id: 'TEST-LATE-CHECKOUT' } });
    await Trip.updateOne({ _id: nairobiTripId }, { $set: { status: 'cancelled' } }); // cancelled, bookings not yet swept
    const callback = await request('/api/mpesa/callback', {
      method: 'POST',
      body: { Body: { stkCallback: { ResultCode: 0, ResultDesc: 'ok', CheckoutRequestID: 'TEST-LATE-CHECKOUT', CallbackMetadata: { Item: [
        { Name: 'Amount', Value: 2 }, { Name: 'MpesaReceiptNumber', Value: 'TESTLATE1' }, { Name: 'PhoneNumber', Value: 254712000050 }
      ] } } } }
    });
    const latePaid = await Booking.findOne({ booking_id: latePayer.body.booking_id }).lean();
    const lateSeat = (await Trip.findById(nairobiTripId).lean()).seats.find((seat) => seat.seat_number === 2);
    console.log('6g LATE PAYMENT on cancelled trip:', JSON.stringify({ callback: callback.status, booking: latePaid.status, receipt: latePaid.mpesa_receipt_number, seat: lateSeat.status }));
    assert.equal(latePaid.status, 'refund_due');
    assert.notEqual(lateSeat.status, 'booked');

    // ---------- 7. Refunds ----------
    const athiRefunds = await request('/api/admin/refunds', { cookie: athi });
    show('7a ATHI refunds', athiRefunds);
    assert.deepEqual(athiRefunds.body.map((booking) => booking.booking_id), [paidBookingId]);

    const nairobiRefunds = await request('/api/admin/refunds', { cookie: nairobi });
    show('7b NAIROBI refunds', nairobiRefunds);
    assert.deepEqual(nairobiRefunds.body.map((booking) => booking.booking_id), [latePayer.body.booking_id]);

    const superRefunds = await request('/api/admin/refunds', { cookie: superCookie });
    assert.equal(superRefunds.body.length, 2);

    const wrongRefund = await request(`/api/admin/bookings/${paidBookingId}/refunded`, { method: 'POST', cookie: nairobi });
    show('7c NAIROBI marks an Athi River refund', wrongRefund);
    assert.equal(wrongRefund.status, 403);

    const refund = await request(`/api/admin/bookings/${paidBookingId}/refunded`, { method: 'POST', cookie: athi });
    show('7d ATHI marks it refunded', refund);
    assert.equal(refund.status, 200);
    const refundedBooking = await Booking.findOne({ booking_id: paidBookingId }).lean();
    assert.equal(refundedBooking.status, 'refunded');
    assert.equal(String(refundedBooking.refunded_by), String(athiAdmin._id));

    const refundAgain = await request(`/api/admin/bookings/${paidBookingId}/refunded`, { method: 'POST', cookie: athi });
    show('7e mark it refunded again', refundAgain);
    assert.equal(refundAgain.status, 409);

    // ---------- 8. Copying a day ----------
    const athiTomorrow = await Trip.find({ trip_date: tomorrow, campus: 'athi', status: { $ne: 'cancelled' } }).lean();
    const copy = await request('/api/admin/trips/copy', { method: 'POST', cookie: athi, body: { from_date: tomorrow, to_date: addDays(today, 3) } });
    show('8a ATHI copies tomorrow to 3 days ahead', copy);
    assert.equal(copy.status, 200);
    assert.equal(copy.body.source_count, athiTomorrow.length);
    assert.equal(copy.body.created.length, athiTomorrow.length);
    const copied = await Trip.find({ trip_date: addDays(today, 3), campus: 'athi' }).lean();
    assert.deepEqual(copied.map((trip) => trip.departure_time).sort(), athiTomorrow.map((trip) => trip.departure_time).sort());
    assert.ok(copied.every((trip) => trip.seats.every((seat) => seat.status === 'available')), 'copies start empty');

    const copyAgain = await request('/api/admin/trips/copy', { method: 'POST', cookie: athi, body: { from_date: tomorrow, to_date: addDays(today, 3) } });
    show('8b copy the same day again', copyAgain);
    assert.equal(copyAgain.body.created.length, 0);
    assert.equal(copyAgain.body.skipped.length, athiTomorrow.length);

    const copyOtherCampus = await request('/api/admin/trips/copy', { method: 'POST', cookie: athi, body: { from_date: tomorrow, to_date: addDays(today, 4), campus: 'nairobi' } });
    show('8c ATHI asks to copy Nairobi (campus is forced to their own)', copyOtherCampus);
    assert.equal(copyOtherCampus.status, 200);
    assert.equal(await Trip.countDocuments({ trip_date: addDays(today, 4), campus: 'nairobi' }), 0);

    // ---------- 9. The day view ----------
    const dayView = await request(`/api/admin/trips?date=${tomorrow}`, { cookie: superCookie });
    show('9a SUPER day view tomorrow', dayView);
    assert.equal(dayView.status, 200);
    assert.deepEqual(dayView.body.campuses, ['athi', 'nairobi']);
    const viewTrip1 = dayView.body.trips.find((trip) => trip.id === trip1Id);
    assert.equal(viewTrip1.status, 'cancelled');
    assert.equal(viewTrip1.driver.name, 'Driver One');
    const times = dayView.body.trips.map((trip) => trip.departs_at);
    assert.deepEqual(times, [...times].sort(), 'sorted by departure');

    console.log('\nALL TRIP SCHEDULING TESTS PASSED');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
  if (server?.listening) server.close();
  if (mongoose.connection.readyState === 1 && mongoose.connection.db.databaseName === TEST_DB_NAME) {
    await mongoose.connection.db.dropDatabase().catch(() => {});
  }
  await mongoose.disconnect().catch(() => {});
});
