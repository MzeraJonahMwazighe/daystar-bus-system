const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Route = require('../models/Route');
const { calculateZoneFare } = require('../lib/bookingHelpers');

router.get('/:routeId/fare', async (req, res) => {
    const { routeId } = req.params;
    const { boardingStop, alightingStop } = req.query;

    if (!boardingStop || !alightingStop) {
        return res.status(400).json({ error: 'boardingStop and alightingStop are required' });
    }

    if (!mongoose.isValidObjectId(routeId)) {
        return res.status(400).json({ error: 'Invalid route ID' });
    }

    try {
        const route = await Route.findById(routeId).lean();
        if (!route) {
            return res.status(404).json({ error: 'Route not found' });
        }

        let farePerSeat;
        try {
            farePerSeat = calculateZoneFare(boardingStop, alightingStop, route);
        } catch (error) {
            return res.status(400).json({ error: error.message });
        }

        return res.json({
            routeId: route._id,
            boardingStop,
            alightingStop,
            farePerSeat
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Database error' });
    }
});

module.exports = router;
