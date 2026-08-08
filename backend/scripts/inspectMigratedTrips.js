require('dotenv').config();
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { connectToDatabase } = require('./../db');
const Bus = require('./../models/Bus');
const Trip = require('./../models/Trip');

async function main() {
  const sqlitePath = path.join(__dirname, '../../legacy-sqlite/backend/database/bus.db');
  const sqliteDb = new sqlite3.Database(sqlitePath, sqlite3.OPEN_READONLY, err => {
    if (err) {
      console.error('SQLite error:', err.message);
      process.exit(1);
    }
  });

  const sqliteAll = (sql, params = []) => new Promise((resolve, reject) => {
    sqliteDb.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
  });

  await connectToDatabase();

  const trips = await sqliteAll('SELECT id, bus_id, route_id, trip_date, departure_time, status FROM trips WHERE id IN (1,2)');
  for (const trip of trips) {
    const seatRows = await sqliteAll('SELECT seat_number, status, booking_id, reserved_by, expires_at FROM seat_reservations WHERE trip_id = ?', [trip.id]);
    const busRows = await sqliteAll('SELECT id, plate, capacity FROM buses WHERE id = ?', [trip.bus_id]);
    const bus = busRows[0] || null;
    const mongoBus = bus ? await Bus.findOne({ plate: bus.plate }).lean() : null;
    const mongoTrip = mongoBus ? await Trip.findOne({ bus: mongoBus._id, trip_date: trip.trip_date, departure_time: trip.departure_time }).lean() : null;

    console.log(`Trip ${trip.id}:`);
    console.log(`  SQLite seat_reservations count: ${seatRows.length}`);
    console.log(`  Bus capacity: ${bus ? bus.capacity : 'MISSING BUS'}`);

    if (mongoTrip) {
      console.log(`  Mongo Trip _id: ${mongoTrip._id}`);
      console.log(`  seats array length: ${Array.isArray(mongoTrip.seats) ? mongoTrip.seats.length : 'N/A'}`);
      console.log('  seats array:');
      console.log(JSON.stringify(mongoTrip.seats, null, 2));
    } else {
      console.log('  Mongo Trip not found');
    }

    console.log('');
  }

  sqliteDb.close();
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
