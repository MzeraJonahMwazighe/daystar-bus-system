const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'bus.db');
const db = new sqlite3.Database(dbPath);

db.run(`INSERT INTO trips (bus_id, route_id, trip_date, departure_time) VALUES (1, 1, '2024-04-02', '08:00')`, (err) => {
    if (err) {
        console.error('Error inserting trip:', err);
    } else {
        console.log('Trip inserted successfully');
    }
    db.close();
});