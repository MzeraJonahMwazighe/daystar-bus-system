require('dotenv').config();
const mongoose = require('mongoose');
const axios = require('axios');
const { connectToDatabase } = require('../db');
const Route = require('../models/Route');
const Bus = require('../models/Bus');
const Trip = require('../models/Trip');
const Booking = require('../models/Booking');

const LIVE_API_URL = 'https://daystar-bus-system-dvd9.onrender.com/api/bookings';
const LIVE_HEALTH_URL = 'https://daystar-bus-system-dvd9.onrender.com/api/health';
const REQUEST_TIMEOUT_MS = 30000;
const TEST_CAPACITY = 50;
const CONCURRENT_REQUESTS = 40;
const TEST_PREFIX = `LOADTEST_${Date.now()}`;

function assertNonEmptyFilter(filter, label) {
  if (!filter || Object.keys(filter).length === 0) {
    throw new Error(`Refusing to run ${label} with an empty filter; this would be destructive.`);
  }
}

async function connectToMongo() {
  await connectToDatabase();

  if (mongoose.connection.readyState !== 1) {
    throw new Error('MongoDB connection was not established');
  }

  console.log('Connected to MongoDB');
  console.log('MongoDB readyState:', mongoose.connection.readyState);
}

async function cleanupTestRecords({ routeId, busId, tripId }) {
  const bookingFilter = { bus: busId, trip: tripId };
  const tripFilter = { _id: tripId };
  const busFilter = { _id: busId };
  const routeFilter = { _id: routeId };

  assertNonEmptyFilter(bookingFilter, 'Booking.deleteMany');
  assertNonEmptyFilter(tripFilter, 'Trip.deleteMany');
  assertNonEmptyFilter(busFilter, 'Bus.deleteMany');
  assertNonEmptyFilter(routeFilter, 'Route.deleteMany');

  const bookingDelete = await Booking.deleteMany(bookingFilter);
  const tripDelete = await Trip.deleteMany(tripFilter);
  const busDelete = await Bus.deleteMany(busFilter);
  const routeDelete = await Route.deleteMany(routeFilter);

  console.log('\nCleanup summary:');
  console.log(`- Bookings deleted: ${bookingDelete.deletedCount}`);
  console.log(`- Trips deleted: ${tripDelete.deletedCount}`);
  console.log(`- Buses deleted: ${busDelete.deletedCount}`);
  console.log(`- Routes deleted: ${routeDelete.deletedCount}`);
}

async function createTestDataset() {
  const route = await Route.create({
    from_location: `${TEST_PREFIX}_FROM`,
    to_location: `${TEST_PREFIX}_TO`,
    fare_per_seat: 500
  });

  const bus = await Bus.create({
    plate: `${TEST_PREFIX}_BUS`,
    capacity: TEST_CAPACITY,
    type: 'Coach',
    route: route._id.toString()
  });

  const seats = Array.from({ length: TEST_CAPACITY }, (_, index) => ({
    seat_number: index + 1,
    status: 'available',
    booking_id: null,
    reserved_by: null,
    expires_at: null
  }));

  const trip = await Trip.create({
    bus: bus._id,
    route: route._id,
    trip_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    departure_time: '14:00',
    status: 'active',
    seats
  });

  console.log('\nCreated live-load test dataset:');
  console.log(`- Route: ${route._id} | ${route.from_location} -> ${route.to_location}`);
  console.log(`- Bus: ${bus._id} | plate=${bus.plate} | capacity=${bus.capacity}`);
  console.log(`- Trip: ${trip._id} | date=${trip.trip_date} | departure=${trip.departure_time}`);

  return { route, bus, trip };
}

function buildBookingPayload(busPlate, seatNumber) {
  const validKenyanPhone = `07${String(seatNumber).padStart(8, '0')}`;

  return {
    busPlate,
    seats: [seatNumber],
    destination: `${TEST_PREFIX}_TO`,
    totalAmount: 500,
    campus: 'nairobi',
    passengerName: `Seat_${seatNumber}_Passenger`,
    phoneNumber: validKenyanPhone
  };
}

async function warmUpServer() {
  const startedAt = Date.now();

  try {
    const response = await axios.get(LIVE_HEALTH_URL, {
      timeout: REQUEST_TIMEOUT_MS,
      validateStatus: () => true
    });

    const responseTime = Date.now() - startedAt;
    console.log(`\nWarm-up health check: status=${response.status}, responseTime=${responseTime}ms`);
    console.log(`Warm-up response body: ${JSON.stringify(response.data)}`);
    return { statusCode: response.status, responseTime, body: response.data };
  } catch (error) {
    const responseTime = Date.now() - startedAt;
    console.log(`\nWarm-up health check failed: responseTime=${responseTime}ms, error=${error.message}`);
    return { statusCode: 0, responseTime, body: null, error: error.message };
  }
}

async function requestBooking(seatNumber, busPlate) {
  const startedAt = Date.now();
  const payload = buildBookingPayload(busPlate, seatNumber);

  try {
    const response = await axios.post(LIVE_API_URL, payload, {
      timeout: REQUEST_TIMEOUT_MS,
      validateStatus: () => true
    });

    const responseTime = Date.now() - startedAt;
    const success = response.status >= 200 && response.status < 300;
    const queueWaitMs = response.data?.queueWaitMs ?? null;

    return {
      seatNumber,
      statusCode: response.status,
      responseTime,
      queueWaitMs,
      success,
      timedOut: false,
      reason: success
        ? 'success'
        : response.status === 409
          ? 'seat conflict'
          : response.status >= 500
            ? 'server error'
            : response.data?.error || 'request failed'
    };
  } catch (error) {
    const responseTime = Date.now() - startedAt;
    const statusCode = error.response ? error.response.status : 0;
    const timedOut = error.code === 'ECONNABORTED' || error.message.toLowerCase().includes('timeout');

    return {
      seatNumber,
      statusCode,
      responseTime,
      success: false,
      timedOut,
      reason: timedOut ? 'request timeout' : error.response?.data?.error || error.message || 'request errored'
    };
  }
}

async function main() {
  let dataset = null;

  try {
    await connectToMongo();
    dataset = await createTestDataset();

    console.log(`\nWarm-up check: ${LIVE_HEALTH_URL}`);
    const warmUpResult = await warmUpServer();
    console.log(`Warm-up wait: sleeping 5 seconds before burst...`);
    await new Promise((resolve) => setTimeout(resolve, 5000));

    console.log(`\nStarting ${CONCURRENT_REQUESTS} concurrent booking attempts against ${LIVE_API_URL}`);
    console.log('Each request targets a different seat number: 1 through 40 on the same trip.');

    const results = await Promise.all(
      Array.from({ length: CONCURRENT_REQUESTS }, (_, index) => requestBooking(index + 1, dataset.bus.plate))
    );

    const successful = results.filter((result) => result.success);
    const successfulRequests = results.filter((result) => result.statusCode === 200);
    const failed = results.filter((result) => !result.success);
    const failedRequests = results.filter((result) => result.statusCode !== 200);
    const timedOut = results.filter((result) => result.timedOut);
    const serverIssues = results.filter((result) => result.statusCode >= 500 || result.timedOut || result.reason === 'server error');
    const responseTimes = results.map((result) => result.responseTime).filter((value) => Number.isFinite(value));
    const minResponseTime = responseTimes.length ? Math.min(...responseTimes) : 0;
    const maxResponseTime = responseTimes.length ? Math.max(...responseTimes) : 0;
    const averageResponseTime = responseTimes.length ? responseTimes.reduce((sum, value) => sum + value, 0) / responseTimes.length : 0;

    console.log('\nDetailed results:');
    results.forEach((result) => {
      console.log(
        `Seat ${String(result.seatNumber).padStart(2, '0')}: status=${result.statusCode}, ` +
        `responseTime=${result.responseTime}ms, queueWaitMs=${result.queueWaitMs ?? 'n/a'}, ` +
        `success=${result.success}, timedOut=${result.timedOut}, reason=${result.reason}`
      );
    });

    const earlySeats = results.slice(0, 5);
    const lateSeats = results.slice(-6);
    console.log('\nQueue wait comparison:');
    console.log(`- Early seats 1-5: ${earlySeats.map((result) => `${result.seatNumber}:${result.queueWaitMs ?? 'n/a'}ms`).join(', ')}`);
    console.log(`- Late seats 35-40: ${lateSeats.map((result) => `${result.seatNumber}:${result.queueWaitMs ?? 'n/a'}ms`).join(', ')}`);

    console.log('\nSummary:');
    console.log(`- Warm-up health response time: ${warmUpResult.responseTime}ms`);
    console.log(`- Warm-up status code: ${warmUpResult.statusCode}`);
    console.log(`- Total requests: ${results.length}`);
    console.log(`- Succeeded: ${successfulRequests.length}`);
    console.log(`- Failed: ${failedRequests.length}`);
    console.log(`- Timed out: ${timedOut.length}`);
    console.log(`- Server-side issues: ${serverIssues.length}`);
    console.log(`- Min response time: ${minResponseTime}ms`);
    console.log(`- Max response time: ${maxResponseTime}ms`);
    console.log(`- Average response time: ${averageResponseTime.toFixed(2)}ms`);

    if (failed.length > 0) {
      console.log('\nFailure reasons:');
      const failureReasons = {};
      failed.forEach((result) => {
        failureReasons[result.reason] = (failureReasons[result.reason] || 0) + 1;
      });
      Object.entries(failureReasons).forEach(([reason, count]) => {
        console.log(`- ${reason}: ${count}`);
      });
    }

    const seatConflictCount = failed.filter((result) => result.reason === 'seat conflict').length;
    console.log(`\nSeat-conflict count (should be 0 because each request is on a unique seat): ${seatConflictCount}`);
  } finally {
    if (dataset) {
      console.log('\nCleaning up the temporary test records...');
      await cleanupTestRecords({
        routeId: dataset.route._id,
        busId: dataset.bus._id,
        tripId: dataset.trip._id
      });
    }

    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }
}

main().catch((error) => {
  console.error('\nLoad-test script failed:');
  console.error(error);
  process.exitCode = 1;
});
