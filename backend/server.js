const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const { calculateFare, generateTicketNumber, validatePhoneNumber } = require('./lib/bookingHelpers');
const { connectToDatabase } = require('./db');
const Booking = require('./models/Booking');
const Trip = require('./models/Trip');
const Ticket = require('./models/Ticket');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const allowedOrigins = (process.env.CORS_ORIGIN || process.env.SOCKET_CORS_ORIGIN || 'http://localhost:3000,http://127.0.0.1:3000')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
const io = new Server(server, {
    cors: {
        origin: allowedOrigins,
        methods: ['GET', 'POST']
    }
});

app.set('io', io);

connectToDatabase();

io.on('connection', (socket) => {
    socket.on('join-admin', () => socket.join('admin'));
});

// Middleware
app.use(cors({
    origin: allowedOrigins,
    credentials: true
}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Background job: Clean up expired reservations every minute (MongoDB)
setInterval(async () => {
    const now = new Date();
    let expiredSeatsReset = 0;
    let bookingsMarkedExpired = 0;

    try {
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
                seat.status === 'reserved' &&
                seat.expires_at &&
                new Date(seat.expires_at) < now
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

        console.log(`✓ Expired reservations cleaned up (seats reset: ${expiredSeatsReset}, bookings expired: ${bookingsMarkedExpired})`);
    } catch (error) {
        console.error('Error cleaning up expired reservations:', error.message);
    }
}, 60000); // Run every minute (60000ms)

// NOTE: Legacy POST /api/book and POST /api/pay routes were removed.

app.get('/api/ticket/:bookingId', async (req, res) => {
    const bookingId = req.params.bookingId;

    try {
        const booking = await Booking.findOne({ booking_id: bookingId }).populate('bus').lean();
        if (!booking) {
            return res.status(404).json({ error: 'Ticket not found' });
        }

        const latestTicket = await Ticket.findOne({ booking_id: bookingId })
            .sort({ createdAt: -1 })
            .lean();

        res.json({
            booking_id: booking.booking_id,
            bus_id: booking.bus?.plate || null,
            seats: booking.seats,
            destination: booking.destination,
            total_amount: booking.total_amount,
            status: booking.status,
            ticket_id: latestTicket?.ticket_id || null,
            qr_data: latestTicket?.qr_data || null
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Database error' });
    }
});

// Serve static files from frontend
app.use(express.static(path.join(__dirname, '..')));

// Routes
app.use('/api/buses', require('./routes/buses'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/mpesa', require('./routes/mpesa'));

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'Daystar Bus Booking System is running' });
});

app.get('/health', (req, res) => {
    res.json({ status: 'OK', message: 'Daystar Bus Booking System is running' });
});

// Serve main page
app.get('/', (req, res) => {
   res.sendFile(path.join(__dirname, '../index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Daystar Bus Booking System running on port ${PORT}`);
    console.log(`Server: http://localhost:${PORT}`);
});

module.exports = app;
