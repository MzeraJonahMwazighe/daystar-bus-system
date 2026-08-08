require('dotenv').config();
const { connectToDatabase } = require('../db');
const Trip = require('../models/Trip');

async function main() {
  await connectToDatabase();

  const result = await Trip.deleteMany({});
  console.log(`Deleted ${result.deletedCount} Trip document(s).`);

  process.exit(0);
}

main().catch(err => {
  console.error('Failed to clear trips:', err);
  process.exit(1);
});
