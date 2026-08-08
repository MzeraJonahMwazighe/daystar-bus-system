const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('backend/database/bus.db');

db.all("SELECT * FROM seat_reservations", [], (err, rows) => {
    if (err) {
        console.error(err);
        return;
    }
    console.log(rows);
});

db.close();