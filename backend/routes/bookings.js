const express = require('express');
const router = express.Router();
const { calculateFare, generateTicketNumber, validatePhoneNumber } = require('../lib/bookingHelpers');
const Booking = require('../models/Booking');
const Bus = require('../models/Bus');
const Trip = require('../models/Trip');

const BOOKING_QUEUE_CONCURRENCY = Number(process.env.BOOKING_QUEUE_CONCURRENCY || 5);
const BOOKING_QUEUE_TIMEOUT_MS = Number(process.env.BOOKING_QUEUE_TIMEOUT_MS || 20000);

const bookingQueueState = {
  running: 0,
  pending: []
};

class BookingRequestError extends Error {
  constructor(statusCode, body) {
    super(body && body.error ? body.error : 'Booking request failed');
    this.statusCode = statusCode;
    this.body = body;
  }
}

async function timedDbCall(label, operation) {
  const start = Date.now();
  const result = await operation();
  const durationMs = Date.now() - start;
  console.log(`[booking-timing] ${label}: ${durationMs}ms`);
  return result;
}

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

function drainBookingQueue() {
  console.log(`[queue-debug] drainBookingQueue() called | running=${bookingQueueState.running} | pending=${bookingQueueState.pending.length}`);

  if (bookingQueueState.running >= BOOKING_QUEUE_CONCURRENCY) {
    console.log(`[queue-debug] queue full; skipping start | running=${bookingQueueState.running} | pending=${bookingQueueState.pending.length}`);
    return;
  }

  const next = bookingQueueState.pending.shift();
  if (!next) {
    console.log(`[queue-debug] no queued item; nothing to start | running=${bookingQueueState.running} | pending=${bookingQueueState.pending.length}`);
    return;
  }

  bookingQueueState.running += 1;
  next.started = true;
  clearTimeout(next.timeoutId);

  const queueWaitMs = Date.now() - next.queuedAt;
  console.log(`[booking-timing] Queue wait: ${queueWaitMs}ms | running=${bookingQueueState.running} | pending=${bookingQueueState.pending.length}`);

  Promise.resolve()
    .then(async () => {
      const start = Date.now();
      const value = await next.task();
      const executionMs = Date.now() - start;
      console.log(`[booking-timing] handleBookingRequest() execution time: ${executionMs}ms | queueWait=${queueWaitMs}ms`);
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return { ...value, queueWaitMs, executionMs };
      }
      return value;
    })
    .then((value) => next.resolve(value))
    .catch((error) => next.reject(error))
    .finally(() => {
      bookingQueueState.running -= 1;
      console.log(`[queue-debug] task finished | running=${bookingQueueState.running} | pending=${bookingQueueState.pending.length} | calling drainBookingQueue() again`);
      drainBookingQueue();
    });
}

function enqueueBookingTask(task, timeoutMs = BOOKING_QUEUE_TIMEOUT_MS) {
  let entry;

  const promise = new Promise((resolve, reject) => {
    entry = {
      task,
      resolve,
      reject,
      started: false,
      queuedAt: Date.now(),
      timeoutId: null
    };

    entry.timeoutId = setTimeout(() => {
      if (entry.started) {
        return;
      }

      const index = bookingQueueState.pending.indexOf(entry);
      if (index >= 0) {
        bookingQueueState.pending.splice(index, 1);
      }

      reject(new Error('System is busy, please try again'));
      drainBookingQueue();
    }, timeoutMs);

    bookingQueueState.pending.push(entry);
    drainBookingQueue();
  });

  return {
    promise,
    cancel() {
      if (entry.started) {
        return false;
      }

      if (entry.timeoutId) {
        clearTimeout(entry.timeoutId);
      }

      const index = bookingQueueState.pending.indexOf(entry);
      if (index >= 0) {
        bookingQueueState.pending.splice(index, 1);
      }

      entry.reject(new Error('Request cancelled'));
      drainBookingQueue();
      return true;
    }
  };
}

async function handleBookingRequest(req) {
  const { busPlate, seats, destination, totalAmount, campus, passengerName, phoneNumber } = req.body;

  if (!busPlate || !seats || !Array.isArray(seats) || seats.length === 0) {
    throw new BookingRequestError(400, { error: 'Invalid booking data - busPlate, seats (array), and destination required' });
  }

  if (!destination) {
    throw new BookingRequestError(400, { error: 'Destination is required' });
  }

  if (!passengerName || !phoneNumber) {
    throw new BookingRequestError(400, { error: 'Passenger name and phone number are required' });
  }

  if (!validatePhoneNumber(phoneNumber)) {
    throw new BookingRequestError(400, { error: 'Please enter a valid phone number' });
  }

  if (!totalAmount || Number(totalAmount) <= 0) {
    throw new BookingRequestError(400, { error: 'Invalid total amount' });
  }

  const requestedSeatNumbers = seats.map(Number);
  if (requestedSeatNumbers.some(seat => !Number.isInteger(seat) || seat <= 0)) {
    throw new BookingRequestError(400, { error: 'Seat numbers must be positive integers' });
  }

  const uniqueSeatNumbers = [...new Set(requestedSeatNumbers)];
  if (uniqueSeatNumbers.length !== requestedSeatNumbers.length) {
    throw new BookingRequestError(400, { error: 'Duplicate seat numbers are not allowed' });
  }

  const bus = await timedDbCall('Bus.findOne', () => Bus.findOne({ plate: busPlate }).lean());
  if (!bus) {
    throw new BookingRequestError(404, { error: 'Bus not found' });
  }

  if (uniqueSeatNumbers.some(seat => seat > bus.capacity)) {
    throw new BookingRequestError(400, { error: 'One or more requested seats do not exist on this bus' });
  }

  const trip = await timedDbCall('Trip.findOne', () => Trip.findOne({ bus: bus._id, status: 'active' }).sort({ createdAt: -1 }));
  if (!trip) {
    throw new BookingRequestError(404, { error: 'No active trip found for this bus' });
  }

  const bookingIdOverride = req.headers['x-fixed-booking-id'];
  const bookingId = bookingIdOverride || generateTicketNumber();
  const expiresAt = new Date(Date.now() + 2 * 60 * 1000);
  const now = new Date();

  const updatedTrip = await timedDbCall('Trip.findOneAndUpdate', () => Trip.findOneAndUpdate(
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
  ));

  if (!updatedTrip) {
    throw new BookingRequestError(409, { error: 'Seats no longer available' });
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
    throw new BookingRequestError(409, { error: 'Seats no longer available' });
  }

  const farePerSeat = calculateFare(campus, destination);
  const adjustedAmount = Number(totalAmount) || uniqueSeatNumbers.length * farePerSeat;
  const seatsString = uniqueSeatNumbers.join(',');

  const booking = await timedDbCall('Booking.create', () => Booking.create({
    booking_id: bookingId,
    bus: bus._id,
    trip: trip._id,
    seats: seatsString,
    destination,
    total_amount: adjustedAmount,
    passenger_name: passengerName,
    phone_number: phoneNumber,
    status: 'reserved'
  }));

  return { success: true, booking_id: booking.booking_id, bookingId: booking.booking_id };
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
  const queuedBooking = enqueueBookingTask(() => handleBookingRequest(req), BOOKING_QUEUE_TIMEOUT_MS);
  const cancelQueuedBooking = () => queuedBooking.cancel();

  req.on('close', cancelQueuedBooking);
  req.on('aborted', cancelQueuedBooking);

  try {
    const responseBody = await queuedBooking.promise;
    return res.status(200).json(responseBody);
  } catch (error) {
    if (error.message === 'System is busy, please try again') {
      return res.status(503).json({ error: 'System is busy, please try again' });
    }

    if (error.message === 'Request cancelled') {
      return;
    }

    if (error instanceof BookingRequestError) {
      return res.status(error.statusCode).json(error.body);
    }

    console.error(error);
    if (error.code === 11000 && error.keyPattern && error.keyPattern.booking_id) {
      return res.status(409).json({ error: 'Booking ID conflict, please retry' });
    }

    return res.status(500).json({ error: 'Database error' });
  } finally {
    req.off('close', cancelQueuedBooking);
    req.off('aborted', cancelQueuedBooking);
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
