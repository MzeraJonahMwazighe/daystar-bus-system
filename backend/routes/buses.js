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
            seat_reservations.seat_number
        FROM buses
        LEFT JOIN trips ON trips.bus_id = buses.id
        LEFT JOIN seat_reservations ON seat_reservations.trip_id = trips.id
        ORDER BY buses.plate
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
                busMap[row.plate].bookedSeats.push(row.seat_number);
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
            GROUP_CONCAT(seat_reservations.seat_number) as bookedSeats
        FROM buses
        LEFT JOIN trips
        ON buses.id = trips.bus_id
        LEFT JOIN seat_reservations
        ON trips.id = seat_reservations.trip_id
        WHERE buses.plate = ?
        GROUP BY buses.id
    `;

    db.get(query, [plate], (err, row) => {

        if (err) {
            console.error("DB ERROR:", err.message);
            return res.status(500).json({ error: "Database error" });
        }

        if (!row) {
            return res.status(404).json({ error: "Bus not found" });
        }

        const bus = {
            plate: row.plate,
            capacity: row.capacity,
            type: row.type,
            route: row.route,
            bookedSeats: row.bookedSeats
                ? row.bookedSeats.split(',').map(Number)
                : []
        };

        res.json(bus);
    });

});

module.exports = router;