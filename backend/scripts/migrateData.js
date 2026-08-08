require('dotenv').config();
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { connectToDatabase } = require('../db');
const Bus = require('../models/Bus');
const Route = require('../models/Route');
const Trip = require('../models/Trip');

async function main() {
  const sqlitePath = path.join(__dirname, '../../legacy-sqlite/backend/database/bus.db');
  const sqliteDb = new sqlite3.Database(sqlitePath, sqlite3.OPEN_READONLY, (err) => {
    if (err) {
      console.error('Failed to open SQLite database:', err.message);
      process.exit(1);
    }
  });

  await connectToDatabase();

  const sqliteAll = (sql, params = []) => new Promise((resolve, reject) => {
    sqliteDb.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });

  const summary = {
    buses: 0,
    routes: 0,
    trips: 0,
    seats: 0,
    skippedBuses: 0,
    skippedRoutes: 0,
    skippedTrips: 0
  };

  try {
    const sqliteBuses = await sqliteAll('SELECT id, plate, capacity, type, route FROM buses');

    for (const row of sqliteBuses) {
      const existing = await Bus.findOne({ plate: row.plate }).lean();
      if (existing) {
        summary.skippedBuses += 1;
        continue;
      }

      await Bus.create({
        plate: row.plate,
        capacity: row.capacity,
        type: row.type,
        route: row.route
      });
      summary.buses += 1;
    }

    const sqliteRoutes = await sqliteAll('SELECT id, from_location, to_location, fare_per_seat FROM routes');

    for (const row of sqliteRoutes) {
      const existing = await Route.findOne({
        from_location: row.from_location,
        to_location: row.to_location,
        fare_per_seat: row.fare_per_seat
      }).lean();

      if (existing) {
        summary.skippedRoutes += 1;
        continue;
      }

      await Route.create({
        from_location: row.from_location,
        to_location: row.to_location,
        fare_per_seat: row.fare_per_seat
      });
      summary.routes += 1;
    }

    const sqliteTrips = await sqliteAll('SELECT id, bus_id, route_id, trip_date, departure_time, status FROM trips');

    for (const tripRow of sqliteTrips) {
      const sqliteSeats = await sqliteAll(
        'SELECT seat_number, status, booking_id, reserved_by, expires_at FROM seat_reservations WHERE trip_id = ?',
        [tripRow.id]
      );

      const sqliteBus = sqliteBuses.find(bus => bus.id === tripRow.bus_id);
      const sqliteRoute = sqliteRoutes.find(route => route.id === tripRow.route_id);

      if (!sqliteBus) {
        console.warn(`Skipping trip ${tripRow.id}: bus_id ${tripRow.bus_id} not found in SQLite buses`);
        continue;
      }

      if (!sqliteRoute) {
        console.warn(`Skipping trip ${tripRow.id}: route_id ${tripRow.route_id} not found in SQLite routes`);
        continue;
      }

      const mongoBus = await Bus.findOne({ plate: sqliteBus.plate }).lean();
      const mongoRoute = await Route.findOne({
        from_location: sqliteRoute.from_location,
        to_location: sqliteRoute.to_location,
        fare_per_seat: sqliteRoute.fare_per_seat
      }).lean();

      if (!mongoBus || !mongoRoute) {
        console.warn(`Skipping trip ${tripRow.id}: missing migrated bus or route document`);
        continue;
      }

      const existingTrip = await Trip.findOne({
        bus: mongoBus._id,
        route: mongoRoute._id,
        trip_date: tripRow.trip_date,
        departure_time: tripRow.departure_time,
        status: tripRow.status
      }).lean();

      if (existingTrip) {
        summary.skippedTrips += 1;
        continue;
      }

      const seats = Array.from({ length: mongoBus.capacity }, (_, index) => ({
        seat_number: index + 1,
        status: 'available',
        booking_id: null,
        reserved_by: null,
        expires_at: null
      }));

      sqliteSeats.forEach(seat => {
        const index = seat.seat_number - 1;
        if (index < 0 || index >= seats.length) {
          return;
        }

        seats[index] = {
          seat_number: seat.seat_number,
          status: seat.status,
          booking_id: seat.booking_id || null,
          reserved_by: seat.reserved_by || null,
          expires_at: seat.expires_at ? new Date(seat.expires_at) : null
        };
      });

      await Trip.create({
        bus: mongoBus._id,
        route: mongoRoute._id,
        trip_date: tripRow.trip_date,
        departure_time: tripRow.departure_time,
        status: tripRow.status || 'active',
        seats
      });

      summary.trips += 1;
      summary.seats += seats.length;
    }

    console.log('Migration complete. Summary:');
    console.log(`  Buses migrated: ${summary.buses} (${summary.skippedBuses} skipped)`);
    console.log(`  Routes migrated: ${summary.routes} (${summary.skippedRoutes} skipped)`);
    console.log(`  Trips migrated: ${summary.trips} (${summary.skippedTrips} skipped)`);
    console.log(`  Seats migrated: ${summary.seats}`);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  } finally {
    sqliteDb.close((err) => {
      if (err) console.error('Error closing SQLite database:', err.message);
    });
    process.exit();
  }
}

main();
