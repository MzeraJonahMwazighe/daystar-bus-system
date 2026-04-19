const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('backend/database/bus.db');

const sql = `INSERT INTO seat_reservations (trip_id, seat_number)
VALUES (1, 10);`;

db.run(sql, function(err) {
  if (err) console.error('Error:', err.message);
  else console.log('Seat reservation inserted successfully');
  db.close();
});
