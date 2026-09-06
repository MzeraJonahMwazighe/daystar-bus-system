/**
 * Verify and display full specifications of all indexes on the Booking collection
 * Useful for production debugging and verifying index properties
 * 
 * Usage: node backend/scripts/verify-indexes.js
 */

const mongoose = require('mongoose');
const dns = require('dns');
require('dotenv').config();

async function getFullIndexSpec() {
  try {
    console.log('\n=== MongoDB Booking Collection Index Details ===\n');
    
    // Handle DNS
    const currentServers = dns.getServers();
    if (currentServers.length === 1 && (currentServers[0] === '127.0.0.1' || currentServers[0] === '::1')) {
      console.log('Switching DNS for Atlas connection...');
      dns.setServers(['8.8.8.8', '1.1.1.1']);
    }
    
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000
    });
    
    const db = conn.connection.db;
    
    // Use MongoDB admin command to get full index specs
    const indexList = await db.collection('bookings').listIndexes().toArray();
    
    console.log('All indexes with full specifications:\n');
    indexList.forEach((idx, i) => {
      console.log(`[${i}] Index: ${idx.name || 'unnamed'}`);
      console.log(`    Spec: ${JSON.stringify(idx, null, 4)}`);
      console.log();
    });
    
    // Check specifically for phone_number index
    console.log('=== Phone Number Index Details ===\n');
    const phoneIndex = indexList.find(idx => idx.name === 'phone_number_1');
    
    if (phoneIndex) {
      console.log('✓ phone_number_1 index found!\n');
      console.log('Full specification:');
      console.log(JSON.stringify(phoneIndex, null, 2));
      
      if (phoneIndex.partialFilterExpression) {
        console.log('\n✓ partialFilterExpression is present!');
        console.log(`  Expression: ${JSON.stringify(phoneIndex.partialFilterExpression)}`);
      } else {
        console.log('\n✗ partialFilterExpression NOT found!');
      }
      
      if (phoneIndex.unique) {
        console.log('\n✓ Unique constraint is ENABLED');
      } else {
        console.log('\n✗ WARNING: Unique constraint is NOT enabled');
      }
    } else {
      console.log('✗ phone_number_1 index NOT found!');
    }
    
    await mongoose.connection.close();
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

getFullIndexSpec();
