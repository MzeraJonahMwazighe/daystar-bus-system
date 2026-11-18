const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Booking = require('../models/Booking');
const Bus = require('../models/Bus');
const Route = require('../models/Route');
const Staff = require('../models/Staff');
const Trip = require('../models/Trip');
const { requireStaff } = require('../middleware/requireStaffAuth');

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

function normalizeRouteValue(routeValue) {
  return String(routeValue || '').trim().toLowerCase().replace(/\s+/g, '');
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

async function resolveRouteDocument(routeValue) {
  const normalized = normalizeRouteValue(routeValue);
  if (!normalized) {
    return null;
  }

  const parts = normalized.split('-');
  if (parts.length !== 2) {
    return null;
  }

  const [from_location, to_location] = parts;
  return Route.findOne({ from_location, to_location }).lean();
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

router.post('/trips', async (req, res) => {
  const { bus_id, route, departure_time, trip_date, status } = req.body;

  if (!bus_id || !route || !departure_time || !trip_date) {
    return res.status(400).json({ error: 'Missing trip details' });
  }

  try {
    const bus = await Bus.findOne({ plate: String(bus_id).trim() }).lean();
    if (!bus) {
      return res.status(404).json({ error: 'Bus not found' });
    }

    const routeDocument = await resolveRouteDocument(route);
    if (!routeDocument) {
      return res.status(404).json({ error: 'Route not found' });
    }

    // A campus admin only schedules trips that depart from their own campus.
    if (req.staff.role === 'campus_admin' && routeDocument.from_location !== req.staff.campus) {
      return res.status(403).json({ error: 'You can only schedule trips departing from your campus' });
    }

    const seats = Array.from({ length: bus.capacity }, (_, index) => ({
      seat_number: index + 1,
      status: 'available',
      booking_id: null,
      reserved_by: null,
      expires_at: null
    }));

    const trip = await Trip.create({
      bus: bus._id,
      route: routeDocument._id,
      departure_time,
      trip_date,
      status: status || 'active',
      seats
    });

    res.json({ success: true, trip_id: trip._id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create trip' });
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
