const express = require('express');
const router = express.Router();
const Bus = require('../models/Bus');

// Students book trips now (/api/trips), not buses. These just describe the fleet.
function serializeBus(bus) {
    return {
        id: bus._id,
        plate: bus.plate,
        capacity: bus.capacity,
        type: bus.type
    };
}

router.get('/', async (req, res) => {
    try {
        const buses = await Bus.find({}).sort({ plate: 1 }).lean();
        res.json(buses.map(serializeBus));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

router.get('/:plate', async (req, res) => {
    try {
        const bus = await Bus.findOne({ plate: req.params.plate }).lean();
        if (!bus) {
            return res.status(404).json({ error: 'Bus not found' });
        }
        res.json(serializeBus(bus));
    } catch (err) {
        console.error('DB ERROR:', err.message);
        res.status(500).json({ error: 'Database error' });
    }
});

module.exports = router;
