/**
 * One-time migration: Create unique partial index on phone_number
 * and clean up any duplicate active bookings
 * 
 * This migration should be run ONCE before the server starts accepting traffic
 * with the phone uniqueness constraint enforced.
 * 
 * Usage: node backend/scripts/migrate-phone-index.js
 */

const mongoose = require('mongoose');
const dns = require('dns');
require('dotenv').config();

async function migratePhoneIndex() {
  try {
    console.log('\n=== Migration: Phone Number Uniqueness Constraint ===\n');
    
    // Handle DNS for Atlas connection
    const currentServers = dns.getServers();
    if (currentServers.length === 1 && (currentServers[0] === '127.0.0.1' || currentServers[0] === '::1')) {
      console.log('Switching DNS for Atlas connection...');
      dns.setServers(['8.8.8.8', '1.1.1.1']);
    }
    
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000
    });
    console.log('✓ Connected to MongoDB\n');
    
    const Booking = require('../models/Booking');
    
    // Step 1: Find and clean up duplicate active bookings
    console.log('--- Step 1: Cleaning Duplicate Bookings ---\n');
    
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
    
    console.log(`Found ${duplicates.length} phone numbers with duplicate bookings\n`);
    
    let totalDeleted = 0;
    
    if (duplicates.length > 0) {
      for (const dup of duplicates) {
        // Sort by createdAt ascending: index 0 is oldest (keep this one)
        const indices = Array.from({ length: dup.ids.length }, (_, i) => i)
          .sort((a, b) => new Date(dup.createdAts[a]) - new Date(dup.createdAts[b]));
        
        const keepIndex = indices[0];
        const deleteIndices = indices.slice(1);
        const idsToDelete = deleteIndices.map(i => dup.ids[i]);
        
        console.log(`Phone: ${dup._id}`);
        console.log(`  Total duplicate bookings: ${dup.count}`);
        console.log(`  Keeping (oldest): ${dup.bookingIds[keepIndex]} (created ${new Date(dup.createdAts[keepIndex]).toISOString()})`);
        
        if (deleteIndices.length > 0) {
          const delNames = deleteIndices.map(i => `${dup.bookingIds[i]} (${dup.statuses[i]})`).join(', ');
          console.log(`  Deleting (${deleteIndices.length}): ${delNames}`);
          
          const result = await Booking.deleteMany({ _id: { $in: idsToDelete } });
          console.log(`  Deleted: ${result.deletedCount}\n`);
          totalDeleted += result.deletedCount;
        }
      }
    } else {
      console.log('No duplicates found ✓\n');
    }
    
    console.log(`Total bookings deleted: ${totalDeleted}\n`);
    
    // Step 2: Create unique partial index
    console.log('--- Step 2: Creating Unique Partial Index ---\n');
    
    try {
      // Drop old index if it exists (in case it was created without unique flag)
      try {
        await Booking.collection.dropIndex('phone_number_1');
        console.log('Dropped existing phone_number_1 index (will recreate with unique flag)');
      } catch (err) {
        // Index doesn't exist, that's fine
      }
      
      // Create new unique partial index (foreground, so migration blocks until done)
      await Booking.collection.createIndex(
        { phone_number: 1 },
        {
          unique: true,
          background: false,
          partialFilterExpression: { status: { $in: ['reserved', 'booked'] } }
        }
      );
      console.log('✓ Unique partial index created successfully\n');
    } catch (indexError) {
      console.error('✗ Failed to create index:', indexError.message);
      throw indexError;
    }
    
    // Step 3: Verify the index
    console.log('--- Step 3: Verification ---\n');
    
    const indexList = await Booking.collection.listIndexes().toArray();
    const phoneIndex = indexList.find(idx => idx.name === 'phone_number_1');
    
    if (phoneIndex && phoneIndex.unique && phoneIndex.partialFilterExpression) {
      console.log('✓ Index verification PASSED');
      console.log(`  Name: ${phoneIndex.name}`);
      console.log(`  Unique: ${phoneIndex.unique}`);
      console.log(`  Background: ${phoneIndex.background}`);
      console.log(`  PartialFilterExpression: ${JSON.stringify(phoneIndex.partialFilterExpression)}\n`);
    } else {
      throw new Error('Index verification failed - index missing or lacks expected properties');
    }
    
    console.log('=== Migration Complete ===\n');
    
    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('\n✗ Migration FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

migratePhoneIndex();
