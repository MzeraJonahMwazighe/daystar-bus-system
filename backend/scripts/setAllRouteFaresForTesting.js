require('dotenv').config();
const mongoose = require('mongoose');
const { connectToDatabase } = require('../db');
const Route = require('../models/Route');

const TEST_FARE = 1;

async function main() {
  await connectToDatabase();

  if (mongoose.connection.readyState !== 1) {
    throw new Error('MongoDB connection was not established');
  }

  const routes = await Route.find({}, {
    from_location: 1,
    to_location: 1,
    fare_per_seat: 1
  }).sort({ from_location: 1, to_location: 1 }).lean();

  console.log('Current Route fares before update:');
  for (const route of routes) {
    console.log(`${route.from_location} -> ${route.to_location}: ${route.fare_per_seat} KES`);
  }

  console.log(`\nUpdating ${routes.length} Route document(s) to ${TEST_FARE} KES...`);

  for (const route of routes) {
    await Route.updateOne(
      { _id: route._id },
      { $set: { fare_per_seat: TEST_FARE } }
    );

    console.log(`${route.from_location} -> ${route.to_location}: ${route.fare_per_seat} KES -> ${TEST_FARE} KES`);
  }

  console.log(`\nUpdated ${routes.length} Route document(s).`);
}

main()
  .catch((error) => {
    console.error('Failed to set Route fares:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });
