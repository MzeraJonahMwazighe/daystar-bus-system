const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Booking = require('../models/Booking');
const Bus = require('../models/Bus');
const Route = require('../models/Route');
const Staff = require('../models/Staff');
const Trip = require('../models/Trip');
const { requireStaff } = require('../middleware/requireStaffAuth');
const {
  ScheduleError,
  cancelTrip,
  copyDay,
  countTakenSeats,
  createTrip,
  isValidDateString,
  nairobiDateString,
  sortedStops,
  updateTrip
} = require('../lib/tripSchedule');

// Every /api/admin route needs a campus admin or super admin login.
// Drivers and students are refused. New routes added below are protected by default.
router.use(requireStaff('campus_admin'));

// Super admins can create these roles from the admin page. Further super admins
// are only created with backend/scripts/create-staff.js.
const MANAGEABLE_STAFF_ROLES = ['campus_admin', 'driver'];

function serializeStaffForAdmin(staff) {
  return {
    id: String(staff._id),
    email: staff.email,
    name: staff.name,
    role: staff.role,
    campus: staff.campus || null,
    phone_number: staff.phone_number || null,
    active: staff.active,
    created_at: staff.createdAt
  };
}

function buildSeatsFromTrip(trip, bookingId) {
  if (!trip || !Array.isArray(trip.seats)) {
    return [];
  }

  return trip.seats
    .filter((seat) => seat.booking_id === bookingId)
    .map((seat) => ({
      seat_number: seat.seat_number,
      status: seat.status
    }))
    .sort((left, right) => left.seat_number - right.seat_number);
}

router.get('/bookings', async (req, res) => {
  try {
    const bookings = await Booking.find({}).sort({ createdAt: -1 }).populate('bus').populate('trip').lean();

    const response = bookings.map((booking) => ({
      booking_id: booking.booking_id,
      bus_id: booking.bus?.plate || null,
      destination: booking.destination,
      total_amount: booking.total_amount,
      status: booking.status,
      created_at: booking.createdAt || booking.created_at,
      seats: buildSeatsFromTrip(booking.trip, booking.booking_id)
    }));

    res.json(response);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Database error' });
  }
});

// ---------- Trip scheduling ----------

function sendScheduleError(res, error, fallbackMessage) {
  if (error instanceof ScheduleError) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error(fallbackMessage, error);
  return res.status(500).json({ error: fallbackMessage });
}

// Which campuses this staff member manages: their own, or both for a super admin.
function managedCampuses(staff) {
  return staff.role === 'super_admin' ? [...Staff.STAFF_CAMPUSES] : [staff.campus];
}

function serializeAdminTrip(trip, now = new Date()) {
  const route = trip.route && trip.route.from_location ? trip.route : null;
  return {
    id: String(trip._id),
    trip_date: trip.trip_date,
    departure_time: trip.departure_time,
    departs_at: trip.departs_at,
    campus: trip.campus,
    status: trip.status,
    has_left: Boolean(trip.departs_at && new Date(trip.departs_at) <= now),
    route: route ? { id: String(route._id), from: route.from_location, to: route.to_location } : null,
    bus: trip.bus && trip.bus.plate ? { id: String(trip.bus._id), plate: trip.bus.plate } : null,
    driver: trip.driver && trip.driver.name ? { id: String(trip.driver._id), name: trip.driver.name } : null,
    seats_taken: countTakenSeats(trip, now),
    capacity: Array.isArray(trip.seats) ? trip.seats.length : 0
  };
}

function serializeAffectedBooking(booking) {
  return {
    booking_id: booking.booking_id,
    passenger_name: booking.passenger_name || null,
    phone_number: booking.phone_number || null,
    seats: booking.seats,
    total_amount: booking.total_amount,
    payment_method: booking.payment_method || 'mpesa',
    status: booking.status,
    mpesa_receipt_number: booking.mpesa_receipt_number || null
  };
}

// Everything the trip form needs: buses, the routes students can book, active drivers.
router.get('/schedule-options', async (req, res) => {
  try {
    const [buses, routes, drivers] = await Promise.all([
      Bus.find({}).sort({ plate: 1 }).lean(),
      Route.find({}).sort({ from_location: 1, to_location: 1 }).lean(),
      Staff.find({ role: 'driver', active: true }).sort({ name: 1 }).lean()
    ]);
    const campuses = managedCampuses(req.staff);

    res.json({
      today: nairobiDateString(),
      campuses,
      buses: buses.map((bus) => ({ id: String(bus._id), plate: bus.plate, capacity: bus.capacity, type: bus.type })),
      routes: routes
        .filter((route) => campuses.includes(route.from_location) && sortedStops(route).length >= 2)
        .map((route) => ({ id: String(route._id), from: route.from_location, to: route.to_location })),
      drivers: drivers.map((driver) => ({ id: String(driver._id), name: driver.name, campus: driver.campus || null }))
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Database error' });
  }
});

// One day's departures for the campuses this admin manages (or one of them via ?campus=).
router.get('/trips', async (req, res) => {
  const date = String(req.query.date || nairobiDateString());
  if (!isValidDateString(date)) {
    return res.status(400).json({ error: 'Choose a valid date' });
  }

  let campuses = managedCampuses(req.staff);
  if (req.query.campus) {
    if (!campuses.includes(req.query.campus)) {
      return res.status(403).json({ error: 'You can only view trips departing from your campus' });
    }
    campuses = [req.query.campus];
  }

  try {
    const trips = await Trip.find({ trip_date: date, campus: { $in: campuses } })
      .sort({ departs_at: 1 })
      .populate('route', 'from_location to_location')
      .populate('bus', 'plate')
      .populate('driver', 'name')
      .lean();
    const now = new Date();
    res.json({ date, campuses, trips: trips.map((trip) => serializeAdminTrip(trip, now)) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Database error' });
  }
});

router.post('/trips', async (req, res) => {
  const { bus_id, route_id, driver_id, trip_date, departure_time } = req.body || {};
  try {
    const trip = await createTrip({
      staff: req.staff,
      busId: bus_id,
      routeId: route_id,
      driverId: driver_id || null,
      tripDate: trip_date,
      departureTime: departure_time
    });
    res.status(201).json({ success: true, trip_id: String(trip._id) });
  } catch (error) {
    sendScheduleError(res, error, 'Failed to create trip');
  }
});

router.post('/trips/copy', async (req, res) => {
  const { from_date, to_date, campus } = req.body || {};
  try {
    res.json(await copyDay({ staff: req.staff, campus, fromDate: from_date, toDate: to_date }));
  } catch (error) {
    sendScheduleError(res, error, 'Failed to copy the schedule');
  }
});

router.patch('/trips/:id', async (req, res) => {
  const { bus_id, driver_id, departure_time } = req.body || {};
  try {
    const trip = await updateTrip({
      staff: req.staff,
      tripId: req.params.id,
      changes: { bus_id, driver_id, departure_time }
    });
    res.json({ success: true, trip_id: String(trip._id) });
  } catch (error) {
    sendScheduleError(res, error, 'Failed to update trip');
  }
});

// The bookings on one trip, shown before cancelling so the admin knows who is affected.
router.get('/trips/:id/bookings', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ error: 'Invalid trip ID' });
  }
  try {
    const trip = await Trip.findById(req.params.id).select('campus').lean();
    if (!trip) return res.status(404).json({ error: 'Trip not found' });
    if (!managedCampuses(req.staff).includes(trip.campus)) {
      return res.status(403).json({ error: 'You can only manage trips departing from your campus' });
    }
    const bookings = await Booking.find({
      trip: trip._id,
      status: { $in: ['reserved', 'booked', 'cancelled', 'refund_due', 'refunded'] }
    }).sort({ createdAt: 1 }).lean();
    res.json(bookings.map(serializeAffectedBooking));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Database error' });
  }
});

router.post('/trips/:id/cancel', async (req, res) => {
  try {
    const { trip, affected } = await cancelTrip({ staff: req.staff, tripId: req.params.id });
    res.json({ success: true, trip_id: String(trip._id), affected: affected.map(serializeAffectedBooking) });
  } catch (error) {
    sendScheduleError(res, error, 'Failed to cancel trip');
  }
});

// ---------- Refunds (M-Pesa bookings on cancelled trips, or payments that came too late) ----------

router.get('/refunds', async (req, res) => {
  try {
    const filter = { status: 'refund_due' };
    // Campus admins see their own campus; super admins see everything, including
    // bookings on trips made before Phase 3 (which have no campus).
    if (req.staff.role !== 'super_admin') {
      filter.trip = { $in: await Trip.distinct('_id', { campus: req.staff.campus }) };
    }

    const bookings = await Booking.find(filter)
      .sort({ updatedAt: 1 })
      .populate('trip', 'trip_date departure_time campus')
      .lean();
    res.json(bookings.map((booking) => ({
      ...serializeAffectedBooking(booking),
      trip_date: booking.trip?.trip_date || null,
      departure_time: booking.trip?.departure_time || null,
      campus: booking.trip?.campus || null
    })));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Marks a refund as done, after the admin has sent the money back by hand in M-Pesa.
router.post('/bookings/:bookingId/refunded', async (req, res) => {
  try {
    const booking = await Booking.findOne({ booking_id: req.params.bookingId }).populate('trip', 'campus').lean();
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    if (req.staff.role !== 'super_admin' && booking.trip?.campus !== req.staff.campus) {
      return res.status(403).json({ error: 'You can only manage bookings for trips departing from your campus' });
    }

    const result = await Booking.updateOne(
      { _id: booking._id, status: 'refund_due' },
      { $set: { status: 'refunded', refunded_at: new Date(), refunded_by: req.staff._id } }
    );
    if (result.modifiedCount === 0) {
      return res.status(409).json({ error: 'This booking is not waiting for a refund' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update booking' });
  }
});

// ---------- Staff management (super admin only) ----------

router.get('/staff', requireStaff('super_admin'), async (req, res) => {
  try {
    const staff = await Staff.find({}).sort({ role: 1, name: 1 }).lean();
    res.json(staff.map(serializeStaffForAdmin));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Database error' });
  }
});

router.post('/staff', requireStaff('super_admin'), async (req, res) => {
  const { email, name, role, campus, phone_number } = req.body || {};

  if (!MANAGEABLE_STAFF_ROLES.includes(role)) {
    return res.status(400).json({ error: `Role must be one of: ${MANAGEABLE_STAFF_ROLES.join(', ')}` });
  }

  try {
    const staff = await Staff.create({
      email,
      name,
      role,
      campus: campus || null,
      phone_number: phone_number || undefined,
      active: true
    });
    res.status(201).json(serializeStaffForAdmin(staff.toObject()));
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ error: 'A staff account with this email already exists' });
    }
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: Object.values(error.errors).map((item) => item.message).join('; ') });
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to create staff account' });
  }
});

router.patch('/staff/:id', requireStaff('super_admin'), async (req, res) => {
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ error: 'Invalid staff ID' });
  }

  if (String(req.staff._id) === id) {
    return res.status(400).json({ error: 'You cannot change your own account here' });
  }

  try {
    const staff = await Staff.findById(id);
    if (!staff) {
      return res.status(404).json({ error: 'Staff account not found' });
    }

    if (staff.role === 'super_admin') {
      return res.status(403).json({ error: 'Super admin accounts can only be changed with the create-staff script' });
    }

    const { name, role, campus, phone_number, active } = req.body || {};
    if (role !== undefined) {
      if (!MANAGEABLE_STAFF_ROLES.includes(role)) {
        return res.status(400).json({ error: `Role must be one of: ${MANAGEABLE_STAFF_ROLES.join(', ')}` });
      }
      staff.role = role;
    }
    if (name !== undefined) staff.name = name;
    if (campus !== undefined) staff.campus = campus || null;
    if (phone_number !== undefined) staff.phone_number = phone_number || undefined;
    if (active !== undefined) {
      if (typeof active !== 'boolean') {
        return res.status(400).json({ error: 'active must be true or false' });
      }
      staff.active = active;
    }

    await staff.save();
    res.json(serializeStaffForAdmin(staff.toObject()));
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: Object.values(error.errors).map((item) => item.message).join('; ') });
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to update staff account' });
  }
});

module.exports = router;
