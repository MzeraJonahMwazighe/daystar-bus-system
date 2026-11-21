// Trip scheduling rules shared by the admin and student trip routes.
//
// Times: admins type Nairobi local dates and times ('2026-11-22', '07:00'). Kenya is UTC+3
// all year (no daylight saving), so the real moment is simply `${date}T${time}:00+03:00`.
// The server itself runs in UTC on Render, so never use the server's local time here.
//
// Clashes: a bus or driver can't have two trips that start less than CLASH_WINDOW_MINUTES
// apart. The check and the insert run inside one MongoDB transaction that also bumps
// schedule_version on the bus (and driver). Two admins scheduling the same bus at the same
// moment both write that field, so MongoDB aborts one with a write conflict; the transaction
// helper retries it, and the retry sees the first trip and refuses with a clash.
const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const Bus = require('../models/Bus');
const Route = require('../models/Route');
const Staff = require('../models/Staff');
const Ticket = require('../models/Ticket');
const Trip = require('../models/Trip');

const NAIROBI_OFFSET = '+03:00';
const NAIROBI_OFFSET_MS = 3 * 60 * 60 * 1000;
const CLASH_WINDOW_MINUTES = 120;
// Students can book trips leaving today or tomorrow (Nairobi dates).
const BOOKABLE_DAYS = 2;

class ScheduleError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function isValidDateString(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// Accepts '7:00', '07:00' or '07:00:00'; returns 'HH:MM' or null.
function normalizeTime(value) {
  const match = /^(\d{1,2}):(\d{2})(?::00)?$/.exec(String(value || '').trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${match[2]}`;
}

function departsAt(tripDate, departureTime) {
  return new Date(`${tripDate}T${departureTime}:00${NAIROBI_OFFSET}`);
}

function nairobiDateString(at = new Date()) {
  return new Date(at.getTime() + NAIROBI_OFFSET_MS).toISOString().slice(0, 10);
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function bookableDates(now = new Date()) {
  const today = nairobiDateString(now);
  return Array.from({ length: BOOKABLE_DAYS }, (_, index) => addDays(today, index));
}

// A trip can be booked while it is scheduled, hasn't left yet, and leaves today or tomorrow.
function isTripBookable(trip, now = new Date()) {
  return Boolean(
    trip &&
    trip.status === 'scheduled' &&
    trip.departs_at &&
    new Date(trip.departs_at) > now &&
    bookableDates(now).includes(trip.trip_date)
  );
}

function makeEmptySeats(capacity) {
  return Array.from({ length: capacity }, (_, index) => ({
    seat_number: index + 1,
    status: 'available',
    booking_id: null,
    reserved_by: null,
    expires_at: null
  }));
}

function seatIsTaken(seat, now = new Date()) {
  if (seat.status === 'booked') return true;
  if (seat.status === 'reserved') return !seat.expires_at || new Date(seat.expires_at) > now;
  return false;
}

function countTakenSeats(trip, now = new Date()) {
  return (trip.seats || []).filter((seat) => seatIsTaken(seat, now)).length;
}

function sortedStops(route) {
  return Array.isArray(route?.stops) ? [...route.stops].sort((a, b) => a.order - b.order) : [];
}

// Campus admins only manage trips leaving their own campus; super admins manage all.
function assertCanManageCampus(staff, campus) {
  if (staff.role === 'super_admin') return;
  if (staff.role === 'campus_admin' && staff.campus === campus) return;
  throw new ScheduleError(403, 'You can only manage trips departing from your campus');
}

async function findClash({ field, id, at, excludeTripId, session }) {
  const windowMs = CLASH_WINDOW_MINUTES * 60 * 1000;
  const filter = {
    [field]: id,
    status: { $in: ['scheduled', 'departed'] },
    departs_at: { $gt: new Date(at.getTime() - windowMs), $lt: new Date(at.getTime() + windowMs) }
  };
  if (excludeTripId) filter._id = { $ne: excludeTripId };
  return Trip.findOne(filter).session(session).lean();
}

function describeClash(kind, trip) {
  return `This ${kind} already has a trip at ${trip.departure_time} on ${trip.trip_date}. ` +
    `Trips for the same ${kind} must be at least ${CLASH_WINDOW_MINUTES / 60} hours apart.`;
}

// Loads and checks the bus, route and driver an admin picked. Throws ScheduleError.
async function loadScheduleInputs({ busId, routeId, driverId, session }) {
  if (!mongoose.isValidObjectId(busId)) throw new ScheduleError(400, 'Choose a bus');
  if (!mongoose.isValidObjectId(routeId)) throw new ScheduleError(400, 'Choose a route');
  if (driverId && !mongoose.isValidObjectId(driverId)) throw new ScheduleError(400, 'Invalid driver');

  const [bus, route, driver] = await Promise.all([
    Bus.findById(busId).session(session).lean(),
    Route.findById(routeId).session(session).lean(),
    driverId ? Staff.findById(driverId).session(session).lean() : null
  ]);

  if (!bus) throw new ScheduleError(404, 'Bus not found');
  if (!route) throw new ScheduleError(404, 'Route not found');
  if (sortedStops(route).length < 2) {
    throw new ScheduleError(400, 'This route has no stops set up yet, so students could not book it');
  }
  if (driverId && (!driver || driver.role !== 'driver' || !driver.active)) {
    throw new ScheduleError(400, 'The chosen driver is not an active driver');
  }
  return { bus, route, driver };
}

// Bumps schedule_version on the bus and driver (see the comment at the top) and checks clashes.
async function lockAndCheckClashes({ bus, driver, at, excludeTripId, session }) {
  await Bus.updateOne({ _id: bus._id }, { $inc: { schedule_version: 1 } }, { session });
  if (driver) await Staff.updateOne({ _id: driver._id }, { $inc: { schedule_version: 1 } }, { session });

  const busClash = await findClash({ field: 'bus', id: bus._id, at, excludeTripId, session });
  if (busClash) throw new ScheduleError(409, describeClash('bus', busClash));

  if (driver) {
    const driverClash = await findClash({ field: 'driver', id: driver._id, at, excludeTripId, session });
    if (driverClash) throw new ScheduleError(409, describeClash('driver', driverClash));
  }
}

function parseDateAndTime(tripDate, departureTime) {
  if (!isValidDateString(tripDate)) throw new ScheduleError(400, 'Choose a valid date');
  const time = normalizeTime(departureTime);
  if (!time) throw new ScheduleError(400, 'Enter the departure time as HH:MM, e.g. 07:00');
  const at = departsAt(tripDate, time);
  if (at <= new Date()) throw new ScheduleError(400, 'That departure time has already passed');
  return { tripDate, time, at };
}

async function createTrip({ staff, busId, routeId, driverId, tripDate, departureTime }) {
  const { time, at } = parseDateAndTime(tripDate, departureTime);
  let createdTrip;

  await mongoose.connection.transaction(async (session) => {
    const { bus, route, driver } = await loadScheduleInputs({ busId, routeId, driverId, session });
    assertCanManageCampus(staff, route.from_location);
    await lockAndCheckClashes({ bus, driver, at, session });

    const [trip] = await Trip.create([{
      bus: bus._id,
      route: route._id,
      trip_date: tripDate,
      departure_time: time,
      departs_at: at,
      campus: route.from_location,
      driver: driver?._id || null,
      created_by: staff._id,
      status: 'scheduled',
      seats: makeEmptySeats(bus.capacity)
    }], { session });
    createdTrip = trip;
  });

  return createdTrip;
}

async function loadManagedTrip(staff, tripId, session) {
  if (!mongoose.isValidObjectId(tripId)) throw new ScheduleError(400, 'Invalid trip ID');
  const query = Trip.findById(tripId);
  if (session) query.session(session);
  const trip = await query;
  if (!trip) throw new ScheduleError(404, 'Trip not found');
  assertCanManageCampus(staff, trip.campus);
  return trip;
}

// Change the time, bus or driver of a scheduled trip that hasn't left yet.
async function updateTrip({ staff, tripId, changes }) {
  let updatedTrip;

  await mongoose.connection.transaction(async (session) => {
    const trip = await loadManagedTrip(staff, tripId, session);
    if (trip.status !== 'scheduled' || trip.departs_at <= new Date()) {
      throw new ScheduleError(409, 'Only trips that have not left yet can be changed');
    }

    const nextBusId = changes.bus_id !== undefined ? changes.bus_id : String(trip.bus);
    const nextDriverId = changes.driver_id !== undefined ? (changes.driver_id || null) : (trip.driver ? String(trip.driver) : null);
    const nextTime = changes.departure_time !== undefined ? changes.departure_time : trip.departure_time;
    const { time, at } = parseDateAndTime(trip.trip_date, nextTime);

    const { bus, driver } = await loadScheduleInputs({
      busId: nextBusId, routeId: String(trip.route), driverId: nextDriverId, session
    });

    const busChanged = String(bus._id) !== String(trip.bus);
    if (busChanged && countTakenSeats(trip) > 0) {
      throw new ScheduleError(409, 'Students have already booked seats on this trip, so the bus cannot be changed. Cancel the trip instead, or keep the bus.');
    }

    await lockAndCheckClashes({ bus, driver, at, excludeTripId: trip._id, session });

    trip.departure_time = time;
    trip.departs_at = at;
    trip.driver = driver?._id || null;
    if (busChanged) {
      trip.bus = bus._id;
      trip.seats = makeEmptySeats(bus.capacity);
    }
    updatedTrip = await trip.save({ session });
  });

  return updatedTrip;
}

// Cancels a trip. Unpaid reservations become 'cancelled'; M-Pesa-paid bookings become
// 'refund_due' for an admin to refund by hand; pass bookings become 'cancelled'.
// Returns the bookings affected so the admin can contact the students.
async function cancelTrip({ staff, tripId }) {
  const trip = await loadManagedTrip(staff, tripId);
  if (trip.status === 'cancelled') throw new ScheduleError(409, 'This trip is already cancelled');
  if (trip.status !== 'scheduled') throw new ScheduleError(409, 'Only scheduled trips can be cancelled');

  // Flip the trip first. Every new reservation and payment confirmation checks the trip's
  // status atomically, so nothing new can land on it after this point.
  const flipped = await Trip.findOneAndUpdate(
    { _id: trip._id, status: 'scheduled' },
    { $set: { status: 'cancelled', cancelled_at: new Date(), cancelled_by: staff._id } },
    { new: true }
  );
  if (!flipped) throw new ScheduleError(409, 'This trip changed while you were cancelling it. Reload and try again.');

  await settleBookingsOfCancelledTrip(trip._id);

  const affected = await Booking.find({ trip: trip._id, status: { $in: ['cancelled', 'refund_due'] } })
    .sort({ createdAt: 1 })
    .lean();
  return { trip: flipped, affected };
}

// Safe to run more than once (e.g. again after a booking slipped in during cancellation).
async function settleBookingsOfCancelledTrip(tripId) {
  await Booking.updateMany(
    { trip: tripId, status: 'booked', payment_method: { $ne: 'pass' } },
    { $set: { status: 'refund_due' } }
  );
  await Booking.updateMany(
    { trip: tripId, status: { $in: ['reserved', 'booked'] } },
    { $set: { status: 'cancelled' } }
  );
  const bookingIds = await Booking.distinct('booking_id', { trip: tripId, status: { $in: ['cancelled', 'refund_due'] } });
  if (bookingIds.length > 0) {
    await Ticket.updateMany({ booking_id: { $in: bookingIds } }, { $set: { status: 'cancelled' } });
  }
}

// Copies one day's scheduled trips for a campus to another day. Each trip is created on its
// own with the normal clash checks; ones that clash or can't be made are reported, not fatal.
async function copyDay({ staff, campus, fromDate, toDate }) {
  if (!isValidDateString(fromDate) || !isValidDateString(toDate)) throw new ScheduleError(400, 'Choose valid dates');
  if (fromDate === toDate) throw new ScheduleError(400, 'Choose a different day to copy to');
  const targetCampus = staff.role === 'super_admin' ? campus : staff.campus;
  if (!targetCampus) throw new ScheduleError(400, 'Choose a campus');
  assertCanManageCampus(staff, targetCampus);

  const sourceTrips = await Trip.find({ trip_date: fromDate, campus: targetCampus, status: { $ne: 'cancelled' } })
    .sort({ departs_at: 1 })
    .populate('bus', 'plate')
    .lean();

  const created = [];
  const skipped = [];
  for (const source of sourceTrips) {
    const label = `${source.departure_time} ${source.bus?.plate || ''}`.trim();
    try {
      const trip = await createTrip({
        staff,
        busId: String(source.bus?._id || source.bus),
        routeId: String(source.route),
        driverId: source.driver ? String(source.driver) : null,
        tripDate: toDate,
        departureTime: source.departure_time
      });
      created.push({ id: String(trip._id), label });
    } catch (error) {
      if (!(error instanceof ScheduleError)) throw error;
      skipped.push({ label, reason: error.message });
    }
  }
  return { created, skipped, source_count: sourceTrips.length };
}

module.exports = {
  CLASH_WINDOW_MINUTES,
  ScheduleError,
  addDays,
  bookableDates,
  cancelTrip,
  copyDay,
  countTakenSeats,
  createTrip,
  departsAt,
  isTripBookable,
  isValidDateString,
  makeEmptySeats,
  nairobiDateString,
  normalizeTime,
  seatIsTaken,
  settleBookingsOfCancelledTrip,
  sortedStops,
  updateTrip
};
