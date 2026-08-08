require('dotenv').config();
const axios = require('axios');
const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const Bus = require('../models/Bus');
const Trip = require('../models/Trip');
const Route = require('../models/Route');
const { connectToDatabase } = require('../db');
const { generateTicketNumber } = require('../lib/bookingHelpers');

const API_BASE = 'http://localhost:3000/api/bookings';
const TEST_BUS_PLATE = 'TEST123';
const TEST_ROUTE_NAME = 'test-route';
const TEST_DESTINATION = 'test-dest';
const TEST_CAMPUS = 'nairobi';
const TEST_PHONE = '0712345678';
const TEST_PASSENGER = 'Test User';

async function ensureServer() {
  try {
    await axios.get('http://localhost:3000/api/health', { timeout: 2000 });
    return;
  } catch (err) {
    throw new Error('Server not running on http://localhost:3000');
  }
}

function assertNonEmptyFilter(filter, name) {
  if (!filter || Object.keys(filter).length === 0) {
    throw new Error(`Refusing to run ${name} with an empty filter; this would delete all documents.`);
  }
}

async function cleanTestData() {
  const testBus = await Bus.findOne({ plate: TEST_BUS_PLATE }).lean();
  if (testBus) {
    const bookingFilter = { bus: testBus._id };
    const tripFilter = { bus: testBus._id };
    assertNonEmptyFilter(bookingFilter, 'Booking.deleteMany');
    assertNonEmptyFilter(tripFilter, 'Trip.deleteMany');
    await Booking.deleteMany(bookingFilter);
    await Trip.deleteMany(tripFilter);
  }

  await Bus.deleteMany({ plate: TEST_BUS_PLATE });
  await Route.deleteMany({ from_location: 'test', to_location: 'test', fare_per_seat: 100 });
}

async function setupTrip(capacity = 5) {
  await cleanTestData();
  const bus = await Bus.create({ plate: TEST_BUS_PLATE, capacity, type: 'test', route: TEST_ROUTE_NAME });
  const seats = Array.from({ length: capacity }, (_, i) => ({
    seat_number: i + 1,
    status: 'available',
    booking_id: null,
    reserved_by: null,
    expires_at: null
  }));
  const route = await Route.create({ from_location: 'test', to_location: 'test', fare_per_seat: 100 });
  const trip = await Trip.create({ bus: bus._id, route: route._id, trip_date: '2026-01-01', departure_time: '10:00', status: 'active', seats });
  return { bus, trip, route };
}

async function runRequest(seats, busPlate = TEST_BUS_PLATE, bookingIdOverride = null) {
  const payload = {
    busPlate,
    seats,
    destination: TEST_DESTINATION,
    totalAmount: 100,
    campus: TEST_CAMPUS,
    passengerName: TEST_PASSENGER,
    phoneNumber: TEST_PHONE
  };

  const headers = {};
  if (bookingIdOverride) {
    headers['x-fixed-booking-id'] = bookingIdOverride;
  }

  try {
    const response = await axios.post(API_BASE, payload, { timeout: 5000, headers });
    return { status: response.status, data: response.data };
  } catch (err) {
    if (err.response) {
      return { status: err.response.status, data: err.response.data };
    }
    return { status: 500, data: { error: err.message } };
  }
}

async function checkTripSeats(tripId, expected) {
  const trip = await Trip.findById(tripId).lean();
  const seatSummary = trip.seats.reduce((acc, seat) => {
    acc[seat.seat_number] = seat.status;
    return acc;
  }, {});
  for (const [seat, status] of Object.entries(expected)) {
    if (seatSummary[seat] !== status) {
      return { ok: false, seatSummary };
    }
  }
  return { ok: true, seatSummary };
}

function printResult(testName, passed, details) {
  console.log(`\n=== ${testName} ===`);
  console.log(passed ? 'PASS' : 'FAIL');
  console.log(details);
}

async function test1() {
  const { trip } = await setupTrip(5);
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < 20; i++) {
    await Trip.updateOne({ _id: trip._id }, { $set: { 'seats.$[].status': 'available', 'seats.$[].booking_id': null, 'seats.$[].reserved_by': null, 'seats.$[].expires_at': null } });
    const requests = [runRequest([1]), runRequest([1])];
    const results = await Promise.all(requests);
    const ok = results.filter(r => r.status === 200).length;
    const conflict = results.filter(r => r.status === 409).length;
    if (ok === 1 && conflict === 1) {
      successCount++;
    } else {
      failCount++;
      console.log('Iteration', i, 'results', results);
    }
  }

  const passed = failCount === 0;
  printResult('TEST 1 — Concurrent double-booking attempt', passed, `successes: ${successCount}, failures: ${failCount}`);
}

async function test2() {
  const { trip } = await setupTrip(5);
  const requests = [runRequest([1, 2, 3]), runRequest([3, 4, 5])];
  const results = await Promise.all(requests);
  const successCount = results.filter(r => r.status === 200).length;
  const conflictCount = results.filter(r => r.status === 409).length;
  const tripState = await Trip.findById(trip._id).lean();
  const seats = tripState.seats.map(s => ({ seat_number: s.seat_number, status: s.status, booking_id: s.booking_id }));
  const valid = successCount === 1 && conflictCount === 1 && (seats.filter(s => [1,2,3].includes(s.seat_number) && s.status === 'reserved').length === 3 || seats.filter(s => [3,4,5].includes(s.seat_number) && s.status === 'reserved').length === 3);
  printResult('TEST 2 — Partial overlap concurrent requests', valid, `results: ${JSON.stringify(results)}, seats: ${JSON.stringify(seats)}`);
}

async function test3() {
  const { trip } = await setupTrip(2);
  const result = await runRequest([1, 2, 3]);
  const tripState = await Trip.findById(trip._id).lean();
  const reserved = tripState.seats.filter(s => s.status === 'reserved' || s.status === 'booked').length;
  const passed = (result.status === 400 || result.status === 409) && reserved === 0;
  printResult('TEST 3 — Requesting more seats than available', passed, `result: ${JSON.stringify(result)}, reserved count ${reserved}`);
}

async function test4() {
  const { trip } = await setupTrip(29);
  const result = await runRequest([999]);
  const passed = result.status === 400 || result.status === 409;
  printResult('TEST 4 — Requesting a seat that does not exist', passed, `result: ${JSON.stringify(result)}`);
}

async function test5() {
  const { trip } = await setupTrip(5);
  await Trip.updateOne({ _id: trip._id, 'seats.seat_number': 2 }, {
    $set: {
      'seats.$.status': 'reserved',
      'seats.$.booking_id': 'EXPIRED',
      'seats.$.reserved_by': 'student',
      'seats.$.expires_at': new Date(Date.now() - 60 * 1000)
    }
  });
  const result = await runRequest([2]);
  const tripState = await Trip.findById(trip._id).lean();
  const seat2 = tripState.seats.find(s => s.seat_number === 2);
  const passed = result.status === 200 && seat2.status === 'reserved' && seat2.booking_id !== 'EXPIRED';
  printResult('TEST 5 — Expired reservation reuse', passed, `result: ${JSON.stringify(result)}, seat2: ${JSON.stringify(seat2)}`);
}

async function test6() {
  const { trip } = await setupTrip(5);
  await Trip.updateOne({ _id: trip._id, 'seats.seat_number': 4 }, {
    $set: {
      'seats.$.status': 'booked',
      'seats.$.booking_id': 'BOOKED',
      'seats.$.reserved_by': 'student',
      'seats.$.expires_at': null
    }
  });
  const result = await runRequest([4]);
  const passed = result.status === 409;
  printResult('TEST 6 — Already booked seat', passed, `result: ${JSON.stringify(result)}`);
}

async function test7() {
  const { trip } = await setupTrip(5);
  const fixedId = 'FORCED-COLLISION-123';
  const req1 = runRequest([1], TEST_BUS_PLATE, fixedId);
  const req2 = runRequest([2], TEST_BUS_PLATE, fixedId);
  const results = await Promise.all([req1, req2]);
  const bookingCount = await Booking.countDocuments({ booking_id: fixedId });
  const passed = bookingCount === 1 && results.filter(r => r.status === 200).length === 1 && results.filter(r => r.status === 409).length === 1;
  printResult('TEST 7 — Duplicate booking_id collision', passed, `results: ${JSON.stringify(results)}, bookingCount: ${bookingCount}`);
}

async function test8() {
  await setupTrip(5);
  const result = await runRequest([1], 'NO_SUCH_PLATE');
  const passed = result.status === 404;
  printResult('TEST 8 — Invalid/missing bus plate', passed, `result: ${JSON.stringify(result)}`);
}

(async () => {
  try {
    await connectToDatabase();
    await ensureServer();
    await test1();
    await test2();
    await test3();
    await test4();
    await test5();
    await test6();
    await test7();
    await test8();
  } catch (error) {
    console.error('Test harness failed:', error);
  } finally {
    await cleanTestData();
    mongoose.disconnect();
    process.exit(0);
  }
})();
