const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'bus.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {

    // BUSES
    db.run(`
        CREATE TABLE IF NOT EXISTS buses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            plate TEXT UNIQUE,
            capacity INTEGER,
            type TEXT,
            route TEXT
        )
    `);

    // TRIPS
    db.run(`
        CREATE TABLE IF NOT EXISTS trips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bus_id INTEGER,
            route TEXT,
            departure_time TEXT,
            FOREIGN KEY (bus_id) REFERENCES buses(id)
        )
    `);

    // SEAT RESERVATIONS
    db.run(`
        CREATE TABLE IF NOT EXISTS seat_reservations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trip_id INTEGER,
            seat_number INTEGER,
            FOREIGN KEY (trip_id) REFERENCES trips(id)
        )
    `);

    // INSERT BUSES (only if empty)
    db.run(`
        INSERT OR IGNORE INTO buses (plate, capacity, type, route) VALUES
        ('KDA347R', 45, 'new', 'nairobi-athi'),
        ('KDC234K', 45, 'new', 'nairobi-athi'),
        ('KDE456K', 45, 'new', 'nairobi-athi'),
        ('KCY564K', 45, 'new', 'nairobi-athi'),
        ('KCU978S', 29, 'old', 'nairobi-athi'),
        ('KBX319D', 29, 'old', 'nairobi-athi'),
        ('KBX514D', 29, 'old', 'nairobi-athi'),
        ('KCU453E', 29, 'old', 'nairobi-athi')
    `);

    console.log("Database fully initialized.");
});

db.close(); 