require('dotenv').config();

const dns = require('dns');
const mongoose = require('mongoose');
const Bus = require('../models/Bus');
const Route = require('../models/Route');
const Trip = require('../models/Trip');
const Booking = require('../models/Booking');

function ensurePublicDnsForAtlas() {
  const currentServers = dns.getServers();
  if (currentServers.length === 1 && (currentServers[0] === '127.0.0.1' || currentServers[0] === '::1')) {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
  }
}

async function runCleanupOnce() {
  const now = new Date();
  let expiredSeatsReset = 0;
  let bookingsMarkedExpired = 0;

  const trips = await Trip.find({
    seats: {
      $elemMatch: {
        status: 'reserved',
        expires_at: { $lt: now }
      }
    }
  }).lean();

  for (const trip of trips) {
    const expiredSeats = trip.seats.filter((seat) =>
      seat.status === 'reserved' && seat.expires_at && new Date(seat.expires_at) < now
    );

    for (const seat of expiredSeats) {
      const seatResetResult = await Trip.updateOne(
        {
          _id: trip._id,
          seats: {
            $elemMatch: {
              seat_number: seat.seat_number,
              booking_id: seat.booking_id,
              status: 'reserved',
              expires_at: { $lt: now }
            }
          }
        },
        {
          $set: {
            'seats.$.status': 'available',
            'seats.$.booking_id': null,
            'seats.$.reserved_by': null,
            'seats.$.expires_at': null
          }
        }
      );

      if (seatResetResult.modifiedCount > 0) {
        expiredSeatsReset += 1;

        if (seat.booking_id) {
          const bookingResult = await Booking.updateOne(
            { booking_id: seat.booking_id, status: 'reserved' },
            { $set: { status: 'expired' } }
          );

          if (bookingResult.modifiedCount > 0) {
            bookingsMarkedExpired += 1;
          }
        }
      }
    }
  }

  return { expiredSeatsReset, bookingsMarkedExpired };
}

async function main() {
  ensurePublicDnsForAtlas();
  const suffix = Date.now();
  const bookingId = `TEST-CLEANUP-${suffix}`;

  let createdBusId = null;
  let createdRouteId = null;
  let createdTripId = null;
  let createdBookingId = null;

  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });

    const bus = await Bus.create({
      plate: `TEST-CLEANUP-${suffix}`,
      capacity: 5,
      type: 'test',
      route: 'cleanup-check'
    });
    createdBusId = bus._id;

    const route = await Route.create({
      from_location: 'test-cleanup-from',
      to_location: 'test-cleanup-to',
      fare_per_seat: 100
    });
    createdRouteId = route._id;

    const expiredAt = new Date(Date.now() - 60 * 1000);
    const trip = await Trip.create({
      bus: bus._id,
      route: route._id,
      trip_date: '2026-01-01',
      departure_time: '10:00',
      status: 'active',
      seats: [
        {
          seat_number: 1,
          status: 'reserved',
          booking_id: bookingId,
          reserved_by: 'Cleanup Test',
          expires_at: expiredAt
        },
        {
          seat_number: 2,
          status: 'available',
          booking_id: null,
          reserved_by: null,
          expires_at: null
        }
      ]
    });
    createdTripId = trip._id;

    const booking = await Booking.create({
      booking_id: bookingId,
      bus: bus._id,
      trip: trip._id,
      seats: '1',
      destination: 'test-cleanup-to',
      total_amount: 100,
      passenger_name: 'Cleanup Test',
      phone_number: '0712345678',
      status: 'reserved'
    });
    createdBookingId = booking._id;

    const beforeBooking = await Booking.findOne({ booking_id: bookingId }).lean();
    const beforeTrip = await Trip.findById(trip._id).lean();
    const beforeSeat = beforeTrip.seats.find((seat) => seat.seat_number === 1);

    const cleanupResult = await runCleanupOnce();

    const afterBooking = await Booking.findOne({ booking_id: bookingId }).lean();
    const afterTrip = await Trip.findById(trip._id).lean();
    const afterSeat = afterTrip.seats.find((seat) => seat.seat_number === 1);

    console.log(JSON.stringify({
      bookingId,
      cleanupResult,
      before: {
        booking_status: beforeBooking ? beforeBooking.status : null,
        seat_1: {
          status: beforeSeat ? beforeSeat.status : null,
          booking_id: beforeSeat ? beforeSeat.booking_id : null,
          expires_at: beforeSeat ? beforeSeat.expires_at : null
        }
      },
      after: {
        booking_status: afterBooking ? afterBooking.status : null,
        seat_1: {
          status: afterSeat ? afterSeat.status : null,
          booking_id: afterSeat ? afterSeat.booking_id : null,
          expires_at: afterSeat ? afterSeat.expires_at : null
        }
      }
    }, null, 2));
  } catch (error) {
    console.error('Verification failed:', error);
    process.exitCode = 1;
  } finally {
    if (createdBookingId) {
      await Booking.deleteOne({ _id: createdBookingId });
    }
    if (createdTripId) {
      await Trip.deleteOne({ _id: createdTripId });
    }
    if (createdRouteId) {
      await Route.deleteOne({ _id: createdRouteId });
    }
    if (createdBusId) {
      await Bus.deleteOne({ _id: createdBusId });
    }

    await mongoose.disconnect();
  }
}

main();
