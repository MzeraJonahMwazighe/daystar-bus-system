const Booking = require('../models/Booking');
const Trip = require('../models/Trip');
const Ticket = require('../models/Ticket');
const { generateTicketNumber, buildTicketPayload } = require('./bookingHelpers');

function parseSeatNumbers(seatsValue) {
  return String(seatsValue || '')
    .split(',')
    .map((seat) => Number(seat.trim()))
    .filter((seat) => Number.isInteger(seat) && seat > 0);
}

async function confirmBookingPayment(bookingId) {
  if (!bookingId) {
    throw new Error('bookingId is required');
  }

  const booking = await Booking.findOne({ booking_id: bookingId }).populate('bus').lean();
  if (!booking) {
    throw new Error('Booking not found');
  }

  const bookingLockResult = await Booking.updateOne(
    { booking_id: bookingId, status: 'reserved' },
    { $set: { status: 'booked' } }
  );

  if (bookingLockResult.modifiedCount === 0) {
    const existingTicket = await Ticket.findOne({ booking_id: bookingId }).sort({ createdAt: -1 }).lean();
    if (!existingTicket) {
      throw new Error('Booking already processed, but no ticket exists yet');
    }

    return {
      ticket_id: existingTicket.ticket_id,
      booking_id: existingTicket.booking_id,
      bus_id: booking.bus?.plate || null,
      seats: existingTicket.seats,
      destination: existingTicket.destination,
      amount: existingTicket.amount,
      qr_data: existingTicket.qr_data,
      status: existingTicket.status
    };
  }

  let seatsBooked = false;

  try {
    const trip = await Trip.findById(booking.trip).lean();
    if (!trip) {
      throw new Error('Trip not found for booking');
    }

    const seatNumbers = parseSeatNumbers(booking.seats);
    if (seatNumbers.length === 0) {
      throw new Error('Booking has no valid seats');
    }

    const updatedTrip = await Trip.findOneAndUpdate(
      {
        _id: booking.trip,
        seats: {
          $not: {
            $elemMatch: {
              seat_number: { $in: seatNumbers },
              $or: [
                { status: { $ne: 'reserved' } },
                { booking_id: { $ne: bookingId } }
              ]
            }
          }
        }
      },
      {
        $set: {
          'seats.$[elem].status': 'booked'
        }
      },
      {
        arrayFilters: [
          {
            'elem.seat_number': { $in: seatNumbers },
            'elem.status': 'reserved',
            'elem.booking_id': bookingId
          }
        ],
        new: true
      }
    );

    if (!updatedTrip) {
      throw new Error('Unable to confirm seats for this booking');
    }

    const confirmedSeats = updatedTrip.seats.filter(
      (seat) => seatNumbers.includes(seat.seat_number) && seat.status === 'booked' && seat.booking_id === bookingId
    );

    if (confirmedSeats.length !== seatNumbers.length) {
      throw new Error('Not all seats were marked as booked');
    }

    seatsBooked = true;

    const existingTicket = await Ticket.findOne({ booking_id: bookingId }).sort({ createdAt: -1 }).lean();
    if (existingTicket) {
      return {
        ticket_id: existingTicket.ticket_id,
        booking_id: existingTicket.booking_id,
        bus_id: booking.bus?.plate || null,
        seats: existingTicket.seats,
        destination: existingTicket.destination,
        amount: existingTicket.amount,
        qr_data: existingTicket.qr_data,
        status: existingTicket.status
      };
    }

    const ticketId = generateTicketNumber();
    const qrPayload = buildTicketPayload({
      ticketId,
      busPlate: booking.bus?.plate || null,
      seats: booking.seats,
      time: trip.departure_time,
      destination: booking.destination,
      amount: booking.total_amount,
      passengerName: booking.passenger_name,
      phoneNumber: booking.phone_number
    });

    const createdTicket = await Ticket.create({
      ticket_id: ticketId,
      booking_id: booking.booking_id,
      bus: booking.bus?._id || booking.bus,
      seats: booking.seats,
      destination: booking.destination,
      amount: booking.total_amount,
      qr_data: JSON.stringify(qrPayload),
      status: 'active'
    });

    return {
      ticket_id: createdTicket.ticket_id,
      booking_id: createdTicket.booking_id,
      bus_id: booking.bus?.plate || null,
      seats: createdTicket.seats,
      destination: createdTicket.destination,
      amount: createdTicket.amount,
      qr_data: createdTicket.qr_data,
      status: createdTicket.status
    };
  } catch (error) {
    if (seatsBooked) {
      await Trip.updateOne(
        {
          _id: booking.trip,
          seats: {
            $elemMatch: {
              booking_id: bookingId,
              status: 'booked'
            }
          }
        },
        {
          $set: {
            'seats.$[elem].status': 'reserved'
          }
        },
        {
          arrayFilters: [
            {
              'elem.booking_id': bookingId,
              'elem.status': 'booked'
            }
          ]
        }
      );
    }

    await Booking.updateOne(
      { booking_id: bookingId, status: 'booked' },
      { $set: { status: 'reserved' } }
    );

    throw error;
  }
}

module.exports = {
  confirmBookingPayment
};
