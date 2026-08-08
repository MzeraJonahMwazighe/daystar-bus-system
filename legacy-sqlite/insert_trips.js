const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('backend/database/bus.db');

const sql = `INSERT INTO trips (bus_id, route, departure_time)
VALUES 
(1, 'nairobi-athi', '2026-03-25 08:00'),
(2, 'nairobi-athi', '2026-03-25 08:00'),
(3, 'nairobi-athi', '2026-03-25 08:00'),
(4, 'nairobi-athi', '2026-03-25 08:00'),
(5, 'nairobi-athi', '2026-03-25 08:00'),
(6, 'nairobi-athi', '2026-03-25 08:00'),
(7, 'nairobi-athi', '2026-03-25 08:00'),
(8, 'nairobi-athi', '2026-03-25 08:00');`;

db.run(sql, function(err) {
  if (err) console.error('Error:', err.message);
  else console.log('Inserted successfully');
  db.close();
});
