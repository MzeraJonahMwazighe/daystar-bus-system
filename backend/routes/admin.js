const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, '../database/bus.db'));

router.get('/bookings', (req, res) => {
  const query = `
    SELECT b.booking_id, b.bus_id, b.seats, b.destination, b.total_amount, b.status, b.created_at,
           s.seat_number, s.status AS seat_status
    FROM bookings b
    LEFT JOIN seat_reservations s ON s.booking_id = b.booking_id
    ORDER BY b.created_at DESC, s.seat_number
  `;

  db.all(query, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    const grouped = {};
    rows.forEach((row) => {
      if (!grouped[row.booking_id]) {
        grouped[row.booking_id] = {
          booking_id: row.booking_id,
          bus_id: row.bus_id,
          destination: row.destination,
          total_amount: row.total_amount,
          status: row.status,
          created_at: row.created_at,
          seats: []
        };
      }

      if (row.seat_number !== null) {
        grouped[row.booking_id].seats.push({ seat_number: row.seat_number, status: row.seat_status });
      }
    });

    res.json(Object.values(grouped));
  });
});

router.post('/trips', (req, res) => {
  const { bus_id, route, departure_time, trip_date, status } = req.body;

  if (!bus_id || !route || !departure_time || !trip_date) {
    return res.status(400).json({ error: 'Missing trip details' });
  }

  const query = `
    INSERT INTO trips (bus_id, route, departure_time, trip_date, status)
    VALUES (?, ?, ?, ?, ?)
  `;

  db.run(query, [bus_id, route, departure_time, trip_date, status || 'active'], function(err) {
    if (err) {
      return res.status(500).json({ error: 'Failed to create trip' });
    }

    res.json({ success: true, trip_id: this.lastID });
  });
});

module.exports = router;
