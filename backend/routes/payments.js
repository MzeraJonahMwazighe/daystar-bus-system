const express = require('express');
const router = express.Router();

// Process M-Pesa payment
router.post('/mpesa', (req, res) => {
    try {
        const { phone, amount, bookingId } = req.body;

        // Validate M-Pesa phone format
        if (!/^07\d{8}$/.test(phone)) {
            return res.status(400).json({ error: 'Invalid M-Pesa phone number' });
        }

        if (!amount || amount <= 0) {
            return res.status(400).json({ error: 'Invalid amount' });
        }

        // Simulate STK push
        const payment = {
            transactionId: 'TXN' + Math.floor(Math.random() * 1000000),
            phone,
            amount,
            bookingId,
            status: 'pending',
            timestamp: new Date().toISOString()
        };

        res.json({ 
            success: true, 
            message: 'Payment request sent',
            payment 
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Verify payment
router.get('/verify/:transactionId', (req, res) => {
    try {
        const verification = {
            transactionId: req.params.transactionId,
            status: 'completed',
            verified: true
        };
        res.json(verification);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
