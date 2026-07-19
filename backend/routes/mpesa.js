const express = require('express');
const router = express.Router();
const axios = require('axios');
const { generateTicketNumber, validatePhoneNumber } = require('../lib/bookingHelpers');

function getMpesaConfig() {
  return {
    consumerKey: process.env.MPESA_CONSUMER_KEY,
    consumerSecret: process.env.MPESA_CONSUMER_SECRET,
    shortcode: process.env.MPESA_SHORTCODE,
    passkey: process.env.MPESA_PASSKEY,
    callbackUrl: process.env.MPESA_CALLBACK_URL,
    initiatorName: process.env.MPESA_INITIATOR_NAME,
    securityCredential: process.env.MPESA_SECURITY_CREDENTIAL,
    env: process.env.MPESA_ENV || 'Sandbox'
  };
}

function getAccessToken() {
  const config = getMpesaConfig();
  const auth = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString('base64');
  return axios.get('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
    headers: { Authorization: `Basic ${auth}` }
  });
}

router.post('/stk-push', async (req, res) => {
  try {
    const { phone, amount, bookingId, passengerName } = req.body;

    if (!validatePhoneNumber(phone)) {
      return res.status(400).json({ error: 'Invalid phone number' });
    }

    if (!bookingId) {
      return res.status(400).json({ error: 'Booking ID is required' });
    }

    const config = getMpesaConfig();

    if (!config.consumerKey || !config.consumerSecret || !config.shortcode || !config.passkey) {
      return res.status(500).json({ error: 'Daraja credentials are not configured. Please set the MPESA_* environment variables.' });
    }

    const tokenResponse = await getAccessToken();
    const token = tokenResponse.data.access_token;
    const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
    const password = Buffer.from(`${config.shortcode}${config.passkey}${timestamp}`).toString('base64');

    const paymentResponse = await axios.post('https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest', {
      BusinessShortCode: config.shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: amount,
      PartyA: phone,
      PartyB: config.shortcode,
      PhoneNumber: phone,
      CallBackURL: config.callbackUrl || 'https://example.com/callback',
      AccountReference: bookingId,
      TransactionDesc: `Daystar bus booking for ${passengerName || 'student'}`
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });

    res.json({ success: true, transactionId: generateTicketNumber(), response: paymentResponse.data });
  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).json({ error: 'M-Pesa payment request failed', details: error.response?.data || error.message });
  }
});

module.exports = router;
