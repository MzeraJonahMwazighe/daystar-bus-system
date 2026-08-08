const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('backend/database/bus.db');

// REFACTORED: Removed hardcoded trip_id = 1
// This is a test utility script. Update tripId and seatNumber below before running
const tripId = 1;    // CHANGE THIS: Set to the desired trip_id
const seatNumber = 10; // CHANGE THIS: Set to the desired seat number

const sql = `INSERT INTO seat_reservations (trip_id, seat_number)
VALUES (?, ?);`;

db.run(sql, [tripId, seatNumber], function(err) {
  if (err) console.error('Error:', err.message);
  else console.log(`Seat reservation inserted successfully for trip ${tripId}, seat ${seatNumber}`);
  db.close();
});
