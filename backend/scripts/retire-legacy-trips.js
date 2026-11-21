// Marks trips made before Phase 3 (status 'active', one per bus) as completed.
// Students can't book them any more either way; this just tidies the data.
//
// Dry run (changes nothing):  node backend/scripts/retire-legacy-trips.js
// Apply:                      node backend/scripts/retire-legacy-trips.js --apply
require('dotenv').config();
const mongoose = require('mongoose');
const Trip = require('../models/Trip');
require('../models/Bus');

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not configured');
  const apply = process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });

  const trips = await Trip.find({ status: 'active' }).populate('bus', 'plate').lean();
  console.log(`Found ${trips.length} pre-Phase-3 trip(s) with status 'active':`);
  for (const trip of trips) {
    const taken = (trip.seats || []).filter((seat) => seat.status !== 'available').length;
    console.log(`  ${trip._id}  bus ${trip.bus?.plate || '?'}  ${trip.trip_date} ${trip.departure_time}  seats not available: ${taken}`);
  }

  if (!apply) {
    console.log('\nDry run only. Run again with --apply to mark these trips completed.');
  } else if (trips.length > 0) {
    const result = await Trip.updateMany(
      { _id: { $in: trips.map((trip) => trip._id) }, status: 'active' },
      { $set: { status: 'completed' } }
    );
    console.log(`\nMarked ${result.modifiedCount} trip(s) completed.`);
  }

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
