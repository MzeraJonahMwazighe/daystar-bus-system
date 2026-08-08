require('dotenv').config();

const http = require('http');
const mongoose = require('mongoose');
const { connectToDatabase } = require('./backend/db');
const Booking = require('./backend/models/Booking');
const Trip = require('./backend/models/Trip');

const seatsToBook = [1, 2];
const data = JSON.stringify({
    busPlate: 'KDA347R',
    seats: seatsToBook,
    destination: 'athi',
    totalAmount: 400,
    campus: 'nairobi',
    passengerName: 'Smoke Test',
    phoneNumber: '0712345678'
});

async function cleanupBooking(bookingId) {
    if (!bookingId) {
        return;
    }

    const booking = await Booking.findOne({ booking_id: bookingId }).lean();
    if (!booking) {
        return;
    }

    const trip = await Trip.findById(booking.trip).lean();
    if (!trip) {
        return;
    }

    await Trip.updateOne(
        { _id: booking.trip },
        {
            $set: {
                'seats.$[elem].status': 'available',
                'seats.$[elem].booking_id': null,
                'seats.$[elem].reserved_by': null,
                'seats.$[elem].expires_at': null
            }
        },
        { arrayFilters: [{ 'elem.seat_number': { $in: seatsToBook } }] }
    );

    await Booking.deleteOne({ _id: booking._id });
}

function makeRequest() {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 3000,
            path: '/api/bookings',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': data.length
            }
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => {
                body += chunk;
            });
            res.on('end', () => {
                resolve({ statusCode: res.statusCode, body });
            });
        });

        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

async function run() {
    try {
        await connectToDatabase();
        const response = await makeRequest();
        const parsed = response.body ? JSON.parse(response.body) : {};
        console.log('Status:', response.statusCode);
        console.log('Response:', response.body);

        const bookingId = parsed.booking_id || parsed.bookingId;
        if (response.statusCode >= 200 && response.statusCode < 300 && bookingId) {
            await cleanupBooking(bookingId);
            console.log('Cleaned up booking:', bookingId);
        }
    } catch (error) {
        console.error('Smoke test failed:', error);
    } finally {
        await mongoose.disconnect();
    }
}

run();