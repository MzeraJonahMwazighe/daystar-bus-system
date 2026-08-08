const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('backend/database/bus.db');

db.all("SELECT name FROM sqlite_master WHERE type='table';", (err, rows) => {
  if (err) console.error(err);
  else {
    console.log("Tables in database:");
    console.log(JSON.stringify(rows, null, 2));
    console.log("\nNow querying bookings...");
    db.all("SELECT * FROM bookings;", (err2, bookings) => {
      if (err2) console.error("Bookings query error:", err2.message);
      else console.log(JSON.stringify(bookings, null, 2));
      db.close();
    });
  }
});
