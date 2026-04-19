const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Connect to database
const db = new sqlite3.Database(
    path.join(__dirname, '../database/bus.db'),
    (err) => {
        if (err) {
            console.error("Database connection error:", err.message);
        } else {
            console.log("Connected to SQLite database");
        }
    }
);

// Get all bookings
router.get('/', (req, res) => {
    const query = `
        SELECT 
            booking_id,
            bus_id,
            seats,
            destination,
            total_amount,
            status,
            created_at
        FROM bookings
    `;

    db.all(query, [], (err, rows) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: "Database error" });
        }
        res.json(rows || []);
    });
});

// Create new booking
router.post('/', (req, res) => {
        const { busPlate, seats, destination, totalAmount } = req.body;
        
        // Validation
        if (!busPlate || !seats || !Array.isArray(seats) || seats.length === 0) {
            return res.status(400).json({ error: 'Invalid booking data - busPlate, seats (array), and destination required' });
        }

        if (!destination) {
            return res.status(400).json({ error: 'Destination is required' });
        }

        if (!totalAmount || totalAmount <= 0) {
            return res.status(400).json({ error: 'Invalid total amount' });
        }

        // Step 1: Get bus_id from buses table
        const busQuery = 'SELECT id FROM buses WHERE plate = ?';
        db.get(busQuery, [busPlate], (err, bus) => {
            if (err) {
                console.error(err);
                return res.status(500).json({ error: 'Database error fetching bus' });
            }

            if (!bus) {
                return res.status(404).json({ error: 'Bus not found' });
            }

            const busId = bus.id;

            // Step 2: Check for double bookings - verify seats are not already reserved
            const checkSeatsQuery = `
                SELECT seat_number FROM seat_reservations 
                WHERE trip_id = 1
                AND seat_number IN (${seats.map(() => '?').join(',')})
                AND (
                    status = 'booked'
                    OR (status = 'reserved' AND expires_at > datetime('now'))
                )
                LIMIT 1
            `;

            db.get(checkSeatsQuery, seats, (err, existingReservation) => {
                if (err) {
                    console.error(err);
                    return res.status(500).json({ error: 'Database error checking seats' });
                }

                if (existingReservation) {
                    return res.status(409).json({ error: `Seat ${existingReservation.seat_number} already booked` });
                }

                // Step 3: Generate booking ID
                const bookingId = 'BUS' + Date.now() + Math.floor(Math.random() * 1000);
                const seatsString = seats.join(',');

                // Step 4: Insert into bookings table with 'reserved' status
                const insertBookingQuery = `
                    INSERT INTO bookings (booking_id, bus_id, seats, destination, total_amount, status)
                    VALUES (?, ?, ?, ?, ?, 'reserved')
                `;

                db.run(insertBookingQuery, [bookingId, busId, seatsString, destination, totalAmount], function(err) {
                    if (err) {
                        console.error(err);
                        return res.status(500).json({ error: 'Database error creating booking' });
                    }

                    // Step 5: Insert each seat into seat_reservations with 'reserved' status and 2-minute expiry
                    const insertSeatQuery = `
                        INSERT INTO seat_reservations (trip_id, seat_number, booking_id, reserved_by, status, expires_at)
                        VALUES (?, ?, ?, ?, 'reserved', datetime('now', '+2 minutes'))
                    `;

                    let completedSeats = 0;
                    let responded = false;

                    function sendOnce(status, message) {
                        if (!responded) {
                            responded = true;
                            if (status === 'success') {
                                res.json(message);
                            } else {
                                res.status(status).json({ error: message });
                            }
                        }
                    }

                    seats.forEach((seatNumber) => {
                        if (responded) return;
                        // Check if seat already exists for this trip
                        const checkSeatQuery = 'SELECT * FROM seat_reservations WHERE trip_id = ? AND seat_number = ?';
                        db.get(checkSeatQuery, [1, seatNumber], (err, row) => {
                            if (responded) return;
                            if (err) {
                                console.error(err);
                                sendOnce(500, 'Database error checking seat');
                                return;
                            }
                            if (row) {
                                sendOnce(409, `Seat ${seatNumber} already booked`);
                                return;
                            }
                            // Insert seat if not already booked
                            db.run(insertSeatQuery, [1, seatNumber, bookingId, 'student'], (err) => {
                                if (responded) return;
                                if (err) {
                                    console.error(err);
                                    sendOnce(500, 'Database error reserving seats');
                                    return;
                                }
                                completedSeats++;
                                // Once all seats are inserted, respond
                                if (completedSeats === seats.length) {
                                    sendOnce('success', {
                                        success: true,
                                        booking_id: bookingId,
                                        bus_id: busId,
                                        seats: seats,
                                        destination: destination,
                                        total_amount: totalAmount,
                                        status: 'reserved'
                                    });
                                }
                            });
                        });
                    });
                });
            });
        })});

// Get booking by ID
router.get('/:bookingId', (req, res) => {
    const bookingId = req.params.bookingId;
    const query = `
        SELECT 
            booking_id,
            bus_id,
            seats,
            destination,
            total_amount,
            status,
            created_at
        FROM bookings
        WHERE booking_id = ?
    `;

    db.get(query, [bookingId], (err, booking) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Database error' });
        }

        if (!booking) {
            return res.status(404).json({ error: 'Booking not found' });
        }

        // Convert seats string back to array
        booking.seats = booking.seats ? booking.seats.split(',').map(Number) : [];
        res.json(booking);
    });
});

module.exports = router;
