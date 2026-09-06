/**
 * Cleanup duplicate phone numbers in the Booking collection
 * Keeps the oldest booking per phone number, deletes the rest
 * 
 * This can be run as a pre-migration step or standalone maintenance task
 * 
 * Usage: node backend/scripts/cleanup-duplicate-phones.js
 */

const mongoose = require('mongoose');
const dns = require('dns');
require('dotenv').config();

async function cleanupDuplicates() {
  try {
    console.log('\n=== Cleaning Up Duplicate Phone Numbers ===\n');
    
    // Handle DNS
    const currentServers = dns.getServers();
    if (currentServers.length === 1 && (currentServers[0] === '127.0.0.1' || currentServers[0] === '::1')) {
      console.log('Switching DNS for Atlas connection...');
      dns.setServers(['8.8.8.8', '1.1.1.1']);
    }
    
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000
    });
    
    const Booking = require('../models/Booking');
    
    // Find all bookings with duplicate phone numbers
    const duplicates = await Booking.aggregate([
      {
        $group: {
          _id: '$phone_number',
          count: { $sum: 1 },
          ids: { $push: '$_id' },
          bookingIds: { $push: '$booking_id' },
          statuses: { $push: '$status' },
          createdAts: { $push: '$createdAt' }
        }
      },
      {
        $match: { count: { $gt: 1 } }
      }
    ]);
    
    if (duplicates.length === 0) {
      console.log('✓ No duplicates found');
      await mongoose.connection.close();
      return;
    }
    
    console.log(`Found ${duplicates.length} phone numbers with duplicates:\n`);
    
    let totalDeleted = 0;
    
    for (const dup of duplicates) {
      // Sort by createdAt: keep oldest (index 0)
      const indices = Array.from({ length: dup.ids.length }, (_, i) => i)
        .sort((a, b) => new Date(dup.createdAts[a]) - new Date(dup.createdAts[b]));
      
      const keepIndex = indices[0];
      const deleteIndices = indices.slice(1);
      const idsToDelete = deleteIndices.map(i => dup.ids[i]);
      
      console.log(`Phone: ${dup._id}, Count: ${dup.count}`);
      console.log(`  Keeping (oldest): ${dup.bookingIds[keepIndex]} (${dup.statuses[keepIndex]}) - created ${new Date(dup.createdAts[keepIndex]).toISOString()}`);
      console.log(`  Deleting ${deleteIndices.length}:`);
      
      for (const idx of deleteIndices) {
        console.log(`    - ${dup.bookingIds[idx]} (${dup.statuses[idx]}) - created ${new Date(dup.createdAts[idx]).toISOString()}`);
      }
      
      const result = await Booking.deleteMany({ _id: { $in: idsToDelete } });
      console.log(`  Deleted: ${result.deletedCount}\n`);
      totalDeleted += result.deletedCount;
    }
    
    console.log(`✓ Total deleted: ${totalDeleted}\n`);
    await mongoose.connection.close();
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

cleanupDuplicates();
