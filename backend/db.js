const mongoose = require('mongoose');
const dns = require('dns');

let isConnected = false;

async function connectToDatabase() {
  if (isConnected) return;

  if (!process.env.MONGODB_URI) {
    console.log('MongoDB URI not configured; using SQLite for now');
    return;
  }

  const currentServers = dns.getServers();
  if (currentServers.length === 1 && (currentServers[0] === '127.0.0.1' || currentServers[0] === '::1')) {
    console.log('Local DNS server is set to localhost; switching DNS resolver to public servers for Atlas.');
    dns.setServers(['8.8.8.8', '1.1.1.1']);
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000
    });
    isConnected = true;
    console.log('Connected to MongoDB');
  } catch (error) {
    console.error('MongoDB connection error:', error.message);
    if (error.message.includes('querySrv') && currentServers.length === 1 && (currentServers[0] === '127.0.0.1' || currentServers[0] === '::1')) {
      console.log('Retrying MongoDB connection after DNS fallback...');
      dns.setServers(['8.8.8.8', '1.1.1.1']);
      try {
        await mongoose.connect(process.env.MONGODB_URI, {
          serverSelectionTimeoutMS: 10000
        });
        isConnected = true;
        console.log('Connected to MongoDB after DNS fallback');
      } catch (retryError) {
        console.error('MongoDB retry error:', retryError.message);
      }
    }
  }
}

module.exports = { connectToDatabase };
