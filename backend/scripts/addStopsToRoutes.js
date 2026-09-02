require('dotenv').config();
const mongoose = require('mongoose');
const { connectToDatabase } = require('../db');
const Route = require('../models/Route');

const STOPS = [
  { name: 'Valley Road Campus', order: 1, zone: 'valley_road_side' },
  { name: 'Mbagathi', order: 2, zone: 'valley_road_side' },
  { name: 'Highrise', order: 3, zone: 'valley_road_side' },
  { name: 'T-mall', order: 4, zone: 'valley_road_side' },
  { name: 'Madaraka', order: 5, zone: 'valley_road_side' },
  { name: 'Shimo La Tewa (Purple tower)', order: 6, zone: 'valley_road_side' },
  { name: 'Bellevue', order: 7, zone: 'valley_road_side' },
  { name: 'Airtel', order: 8, zone: 'valley_road_side' },
  { name: 'Enterprise rd', order: 9, zone: 'valley_road_side' },
  { name: 'Imara Daima', order: 10, zone: 'valley_road_side' },
  { name: 'Cabanas', order: 11, zone: 'valley_road_side' },
  { name: 'Gateway Mall', order: 12, zone: 'valley_road_side' },
  { name: 'Katani (Syokimau)', order: 13, zone: 'athi_river_side' },
  { name: 'Allpack', order: 14, zone: 'athi_river_side' },
  { name: 'Mlolongo', order: 15, zone: 'athi_river_side' },
  { name: 'Sabaki', order: 16, zone: 'athi_river_side' },
  { name: 'Tuffoam', order: 17, zone: 'athi_river_side' },
  { name: 'Crystal Rivers Mall', order: 18, zone: 'athi_river_side' },
  { name: 'Devki', order: 19, zone: 'athi_river_side' },
  { name: 'Greenpark', order: 20, zone: 'athi_river_side' },
  { name: 'Main Campus', order: 21, zone: 'athi_river_side' }
];

const ROUTE_DIRECTIONS = [
  { from_location: 'nairobi', to_location: 'athi' },
  { from_location: 'athi', to_location: 'nairobi' }
];

async function main() {
  await connectToDatabase();

  if (mongoose.connection.readyState !== 1) {
    throw new Error('MongoDB connection was not established');
  }

  for (const direction of ROUTE_DIRECTIONS) {
    const routes = await Route.find(direction).select('_id from_location to_location').lean();

    if (routes.length === 0) {
      console.warn(`No route found for ${direction.from_location} -> ${direction.to_location}`);
      continue;
    }

    for (const route of routes) {
      await Route.updateOne({ _id: route._id }, { $set: { stops: STOPS } });
      console.log(`Updated ${route.from_location} -> ${route.to_location} with ${STOPS.length} stops.`);
    }
  }
}

main()
  .catch((error) => {
    console.error('Failed to add stops to routes:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });