const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
require('dotenv').config();

const app = express();

// Initialize database connection globally
const dbPath = path.join(__dirname, 'database/bus.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error("Database connection error:", err.message);
    } else {
        console.log("Connected to SQLite database");
    }
});

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Background job: Clean up expired reservations every minute
setInterval(() => {
    db.run(`
        UPDATE seat_reservations
        SET status = 'cancelled'
        WHERE status = 'reserved'
        AND expires_at < datetime('now')
    `, (err) => {
        if (err) {
            console.error("Error cleaning up expired reservations:", err.message);
        } else {
            console.log("✓ Expired reservations cleaned up");
        }
    });
}, 60000); // Run every minute (60000ms)

// Booking route: POST /api/book
app.post('/api/book', (req, res) => {
    const { plate, seats } = req.body;

    if (!plate || !Array.isArray(seats) || seats.length === 0) {
        return res.status(400).json({ error: 'Missing plate or seats array' });
    }

    // Get bus and trip info
    db.get('SELECT id FROM buses WHERE plate = ?', [plate], (err, busRow) => {
        if (err || !busRow) {
            db.close();
            return res.status(404).json({ error: 'Bus not found' });
        }

        const bus_id = busRow.id;

        db.get('SELECT id FROM trips WHERE bus_id = ?', [bus_id], (err2, tripRow) => {
            if (err2 || !tripRow) {
                db.close();
                return res.status(404).json({ error: 'Trip not found for this bus' });
            }

            const trip_id = tripRow.id;

            // 1. Check if seats are available (not booked and not reserved with unexpired time)
            const checkSeatsQuery = `
                SELECT COUNT(*) as count FROM seat_reservations
                WHERE trip_id = ?
                AND seat_number IN (${seats.map(() => '?').join(',')})
                AND (
                    status = 'booked'
                    OR (status = 'reserved' AND expires_at > datetime('now'))
                )
            `;

            db.get(checkSeatsQuery, [trip_id, ...seats], (err, checkResult) => {
                if (err || !checkResult) {
                    return res.status(500).json({ error: 'Error checking seat availability' });
                }

                if (checkResult.count > 0) {
                    return res.status(400).json({ error: 'One or more seats already booked or reserved' });
                }

                // 2. Begin transaction
                db.run("BEGIN TRANSACTION", (err) => {
                    if (err) {
                        db.close();
                        return res.status(500).json({ error: 'Failed to begin transaction' });
                    }

                    // 3. Insert seats into seat_reservations with 'reserved' status and 2-minute expiry
                    let insertCount = 0;
                    let hasError = false;

                    const insertStmt = db.prepare(
                        "INSERT INTO seat_reservations (trip_id, seat_number, reserved_by, status, expires_at) VALUES (?, ?, ?, 'reserved', datetime('now', '+2 minutes'))"
                    );

                    seats.forEach((seat) => {
                        insertStmt.run(trip_id, seat, 'student', (err) => {
                            if (err) {
                                hasError = true;
                            } else {
                                insertCount++;
                            }

                            // Check if all inserts are done
                            if (insertCount + (hasError ? 1 : 0) === seats.length) {
                                insertStmt.finalize();

                                if (hasError) {
                                    // 4. If any seat already exists, rollback
                                    db.run("ROLLBACK", () => {
                                        db.close();
                                        return res.status(400).json({ error: 'One or more seats already booked' });
                                    });
                                } else {
                                    // 5. If all seats inserted, generate bookingId
                                    const bookingId = 'BUS' + Date.now() + Math.floor(Math.random() * 1000);

                                    // 6. Update seat_reservations with bookingId
                                    const updateStmt = db.prepare(
                                        "UPDATE seat_reservations SET booking_id = ? WHERE trip_id = ? AND seat_number = ?"
                                    );

                                    let updateCount = 0;
                                    seats.forEach((seat) => {
                                        updateStmt.run(bookingId, trip_id, seat, (err) => {
                                            if (err) {
                                                console.error('Update error:', err);
                                            }
                                            updateCount++;

                                            if (updateCount === seats.length) {
                                                updateStmt.finalize();

                                                // 7. Commit transaction
                                                db.run("COMMIT", (err) => {
                                                    if (err) {
                                                        db.close();
                                                        return res.status(500).json({ error: 'Failed to commit transaction' });
                                                    }

                                                    // 8. Insert into bookings table
                                                    const seatsString = seats.join(',');
                                                    const totalAmount = seats.length * 200; // Assuming fixed fare
                                                    const destination = 'athi'; // Assuming fixed destination

                                                    db.run(
                                                        "INSERT INTO bookings (booking_id, bus_id, seats, destination, total_amount, status) VALUES (?, ?, ?, ?, ?, ?)",
                                                        [bookingId, bus_id, seatsString, destination, totalAmount, 'reserved'],
                                                        function(err) {
                                                            db.close();

                                                            if (err) {
                                                                return res.status(500).json({ error: 'Failed to create booking record' });
                                                            }

                                                            // 9. Return success and bookingId
                                                            return res.json({
                                                                success: true,
                                                                bookingId: bookingId,
                                                                message: 'Booking created successfully'
                                                            });
                                                        }
                                                    );
                                                });
                                            }
                                        });
                                    });
                                }
                            }
                        });
                    });
                });
            });
        });
    });
});
app.post('/api/pay', (req, res) => {
    const { bookingId } = req.body;

    if (!bookingId) {
        return res.json({ error: "Booking ID is required" });
    }

    // Update booking status to 'booked' when payment is successful
    db.run(
        "UPDATE bookings SET status = 'booked' WHERE booking_id = ?",
        [bookingId],
        function(err) {
            if (err) {
                console.error(err);
                return res.json({ error: "Failed to update payment" });
            }

            // Also update seat_reservations status to 'booked'
            db.run(
                "UPDATE seat_reservations SET status = 'booked' WHERE booking_id = ?",
                [bookingId],
                function(err) {
                    if (err) {
                        console.error(err);
                        return res.json({ error: "Failed to update seat reservations" });
                    }

                    res.json({ success: true });
                }
            );
        }
    );
});

app.get('/api/ticket/:bookingId', (req, res) => {
    const bookingId = req.params.bookingId;

    db.get(
        "SELECT * FROM bookings WHERE booking_id = ?",
        [bookingId],
        (err, row) => {
            if (err) {
                console.error(err);
                return res.json({ error: "Database error" });
            }

            if (!row) {
                return res.json({ error: "Ticket not found" });
            }

            res.json(row);
        }
    );
});

// Serve static files from frontend
app.use(express.static(path.join(__dirname, '..')));

// Routes
app.use('/api/buses', require('./routes/buses'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/payments', require('./routes/payments'));

// Health check endpoint
app.get('/api/health', (req, res) => {
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
app.listen(PORT, () => {
    console.log(`Daystar Bus Booking System running on port ${3000}`);
    console.log(`Server: http://localhost:${3000}`);
});
