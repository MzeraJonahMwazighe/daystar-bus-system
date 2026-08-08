const express = require('express');
const router = express.Router();
const Bus = require('../models/Bus');
const Trip = require('../models/Trip');

function buildBookedSeats(trip) {
    if (!trip || !Array.isArray(trip.seats)) {
        return [];
    }

    const now = new Date();

    return trip.seats
        .filter(seat => {
            if (!seat || seat.seat_number == null) {
                return false;
            }

            if (seat.status === 'booked') {
                return true;
            }

            if (seat.status === 'reserved') {
                return !seat.expires_at || seat.expires_at > now;
            }

            return false;
        })
        .map(seat => ({
            seat_number: seat.seat_number,
            status: seat.status
        }));
}

// GET ALL BUSES
router.get('/', async (req, res) => {
    try {
        const buses = await Bus.find({}).lean();
        const busIds = buses.map(bus => bus._id);

        const trips = await Trip.find({ bus: { $in: busIds }, status: 'active' })
            .sort({ createdAt: -1 })
            .lean();

        const tripMap = {};
        const activeTripCounts = {};

        trips.forEach(trip => {
            const busId = trip.bus.toString();
            activeTripCounts[busId] = (activeTripCounts[busId] || 0) + 1;

            if (!tripMap[busId]) {
                tripMap[busId] = trip;
            }
        });

        Object.keys(activeTripCounts).forEach(busId => {
            if (activeTripCounts[busId] > 1) {
                console.warn(`Warning: multiple active trips found for bus ${busId}. Using the most recently created one.`);
            }
        });

        const result = buses.map(bus => ({
            id: bus._id,
            plate: bus.plate,
            capacity: bus.capacity,
            type: bus.type,
            route: bus.route,
            bookedSeats: buildBookedSeats(tripMap[bus._id.toString()])
        }));

        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

// GET BUS BY PLATE
router.get('/:plate', async (req, res) => {
    const plate = req.params.plate;

    try {
        const bus = await Bus.findOne({ plate }).lean();

        if (!bus) {
            return res.status(404).json({ error: 'Bus not found' });
        }

        const trips = await Trip.find({ bus: bus._id, status: 'active' })
            .sort({ createdAt: -1 })
            .lean();

        if (trips.length > 1) {
            console.warn(`Warning: multiple active trips found for bus ${bus._id}. Using the most recently created one.`);
        }

        const trip = trips[0];

        res.json({
            plate: bus.plate,
            capacity: bus.capacity,
            type: bus.type,
            route: bus.route,
            bookedSeats: buildBookedSeats(trip)
        });
    } catch (err) {
        console.error('DB ERROR:', err.message);
        res.status(500).json({ error: 'Database error' });
    }
});

module.exports = router;
