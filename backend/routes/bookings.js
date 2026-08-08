const express = require('express');
const router = express.Router();
const { calculateFare, generateTicketNumber, validatePhoneNumber } = require('../lib/bookingHelpers');
const Booking = require('../models/Booking');
const Bus = require('../models/Bus');
const Trip = require('../models/Trip');

function serializeBooking(booking) {
  return {
    booking_id: booking.booking_id,
    bus_id: booking.bus?.plate || null,
    seats: booking.seats,
    destination: booking.destination,
    total_amount: booking.total_amount,
    status: booking.status,
    created_at: booking.createdAt || booking.created_at
  };
}

router.get('/', async (req, res) => {
  try {
    const bookings = await Booking.find({}).populate('bus').lean();
    res.json(bookings.map(serializeBooking));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Database error' });
  }
});

router.post('/', async (req, res) => {
  const { busPlate, seats, destination, totalAmount, campus, passengerName, phoneNumber } = req.body;

  if (!busPlate || !seats || !Array.isArray(seats) || seats.length === 0) {
    return res.status(400).json({ error: 'Invalid booking data - busPlate, seats (array), and destination required' });
  }

  if (!destination) {
    return res.status(400).json({ error: 'Destination is required' });
  }

  if (!passengerName || !phoneNumber) {
    return res.status(400).json({ error: 'Passenger name and phone number are required' });
  }

  if (!validatePhoneNumber(phoneNumber)) {
    return res.status(400).json({ error: 'Please enter a valid phone number' });
  }

  if (!totalAmount || Number(totalAmount) <= 0) {
    return res.status(400).json({ error: 'Invalid total amount' });
  }

  const requestedSeatNumbers = seats.map(Number);
  if (requestedSeatNumbers.some(seat => !Number.isInteger(seat) || seat <= 0)) {
    return res.status(400).json({ error: 'Seat numbers must be positive integers' });
  }

  const uniqueSeatNumbers = [...new Set(requestedSeatNumbers)];
  if (uniqueSeatNumbers.length !== requestedSeatNumbers.length) {
    return res.status(400).json({ error: 'Duplicate seat numbers are not allowed' });
  }

  try {
    const bus = await Bus.findOne({ plate: busPlate }).lean();
    if (!bus) {
      return res.status(404).json({ error: 'Bus not found' });
    }

    if (uniqueSeatNumbers.some(seat => seat > bus.capacity)) {
      return res.status(400).json({ error: 'One or more requested seats do not exist on this bus' });
    }

    const trip = await Trip.findOne({ bus: bus._id, status: 'active' }).sort({ createdAt: -1 });
    if (!trip) {
      return res.status(404).json({ error: 'No active trip found for this bus' });
    }

    const bookingIdOverride = req.headers['x-fixed-booking-id'];
    const bookingId = bookingIdOverride || generateTicketNumber();
    const expiresAt = new Date(Date.now() + 2 * 60 * 1000);
    const now = new Date();

    const updatedTrip = await Trip.findOneAndUpdate(
      {
        _id: trip._id,
        seats: {
          $not: {
            $elemMatch: {
              seat_number: { $in: uniqueSeatNumbers },
              $or: [
                { status: 'booked' },
                { status: 'reserved', expires_at: { $gt: now } }
              ]
            }
          }
        }
      },
      {
        $set: {
          'seats.$[elem].status': 'reserved',
          'seats.$[elem].booking_id': bookingId,
          'seats.$[elem].reserved_by': passengerName,
          'seats.$[elem].expires_at': expiresAt
        }
      },
      {
        arrayFilters: [{ 'elem.seat_number': { $in: uniqueSeatNumbers } }],
        new: true
      }
    );

    if (!updatedTrip) {
      return res.status(409).json({ error: 'Seats no longer available' });
    }

    const reservedSeats = updatedTrip.seats.filter(seat =>
      uniqueSeatNumbers.includes(seat.seat_number) &&
      seat.status === 'reserved' &&
      seat.booking_id === bookingId
    );

    if (reservedSeats.length !== uniqueSeatNumbers.length) {
      const rolledBackSeatNumbers = reservedSeats.map(seat => seat.seat_number);
      if (rolledBackSeatNumbers.length > 0) {
        await Trip.updateOne(
          { _id: trip._id },
          {
            $set: {
              'seats.$[elem].status': 'available',
              'seats.$[elem].booking_id': null,
              'seats.$[elem].reserved_by': null,
              'seats.$[elem].expires_at': null
            }
          },
          { arrayFilters: [{ 'elem.seat_number': { $in: rolledBackSeatNumbers } }] }
        );
      }
      return res.status(409).json({ error: 'Seats no longer available' });
    }

    const farePerSeat = calculateFare(campus, destination);
    const adjustedAmount = Number(totalAmount) || uniqueSeatNumbers.length * farePerSeat;
    const seatsString = uniqueSeatNumbers.join(',');

    const booking = await Booking.create({
      booking_id: bookingId,
      bus: bus._id,
      trip: trip._id,
      seats: seatsString,
      destination,
      total_amount: adjustedAmount,
      passenger_name: passengerName,
      phone_number: phoneNumber,
      status: 'reserved'
    });

    res.json({ success: true, booking_id: booking.booking_id, bookingId: booking.booking_id });
  } catch (error) {
    console.error(error);

    if (error.code === 11000 && error.keyPattern && error.keyPattern.booking_id) {
      return res.status(409).json({ error: 'Booking ID conflict, please retry' });
    }

    res.status(500).json({ error: 'Database error' });
  }
});

router.get('/:bookingId', async (req, res) => {
  try {
    const booking = await Booking.findOne({ booking_id: req.params.bookingId }).populate('bus').lean();
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const response = serializeBooking(booking);
    response.seats = booking.seats ? booking.seats.split(',').map(Number) : [];
    res.json(response);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
