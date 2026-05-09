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

// =======================
// GET ALL BUSES
// =======================
// Get all buses with booked seats
router.get('/', (req, res) => {
    const query = `
        SELECT
            buses.id,
            buses.plate,
            buses.capacity,
            buses.type,
            buses.route,
            seat_reservations.seat_number,
            seat_reservations.status
        FROM buses
        LEFT JOIN trips ON trips.bus_id = buses.id
        LEFT JOIN seat_reservations ON seat_reservations.trip_id = trips.id
        WHERE (seat_reservations.status IS NULL)
        OR (seat_reservations.status = 'booked')
        OR (seat_reservations.status = 'reserved' AND (seat_reservations.expires_at IS NULL OR seat_reservations.expires_at > datetime('now')))
        ORDER BY buses.plate, seat_reservations.seat_number
    `;

    db.all(query, [], (err, rows) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: "Database error" });
        }

        const busMap = {};

        rows.forEach(row => {
            if (!busMap[row.plate]) {
                busMap[row.plate] = {
                    id: row.id,
                    plate: row.plate,
                    capacity: row.capacity,
                    type: row.type,
                    route: row.route,
                    bookedSeats: []
                };
            }

            if (row.seat_number !== null) {
                busMap[row.plate].bookedSeats.push({
                    seat_number: row.seat_number,
                    status: row.status
                });
            }
        });

        res.json(Object.values(busMap));
    });
});

// =======================
// GET BUS BY PLATE
// =======================
router.get('/:plate', (req, res) => {

    const plate = req.params.plate;

    const query = `
        SELECT
            buses.plate,
            buses.capacity,
            buses.type,
            buses.route,
            seat_reservations.seat_number,
            seat_reservations.status
        FROM buses
        LEFT JOIN trips
        ON buses.id = trips.bus_id
        LEFT JOIN seat_reservations
        ON trips.id = seat_reservations.trip_id
        WHERE buses.plate = ?
        AND (
            (seat_reservations.status IS NULL)
            OR (seat_reservations.status = 'booked')
            OR (seat_reservations.status = 'reserved' AND (seat_reservations.expires_at IS NULL OR seat_reservations.expires_at > datetime('now')))
        )
        ORDER BY seat_reservations.seat_number
    `;

    db.all(query, [plate], (err, rows) => {

        if (err) {
            console.error("DB ERROR:", err.message);
            return res.status(500).json({ error: "Database error" });
        }

        if (rows.length === 0) {
            return res.status(404).json({ error: "Bus not found" });
        }

        const firstRow = rows[0];
        const bus = {
            plate: firstRow.plate,
            capacity: firstRow.capacity,
            type: firstRow.type,
            route: firstRow.route,
            bookedSeats: rows
                .filter(r => r.seat_number !== null)
                .map(r => ({
                    seat_number: r.seat_number,
                    status: r.status
                }))
        };

        res.json(bus);
    });

});

module.exports = router;