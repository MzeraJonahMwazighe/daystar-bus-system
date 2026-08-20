const express = require('express');
const router = express.Router();
const axios = require('axios');
const Booking = require('../models/Booking');
const { normalizePhoneNumber, isSafaricomNumber } = require('../lib/bookingHelpers');
const { confirmBookingPayment } = require('../lib/paymentHelpers');

let accessTokenCache = { token: null, expiresAt: 0 };

function getMpesaConfig() {
  const env = String(process.env.MPESA_ENV || 'Sandbox').toLowerCase();

  return {
    consumerKey: process.env.MPESA_CONSUMER_KEY,
    consumerSecret: process.env.MPESA_CONSUMER_SECRET,
    shortcode: process.env.MPESA_SHORTCODE,
    passkey: process.env.MPESA_PASSKEY,
    callbackUrl: process.env.MPESA_CALLBACK_URL,
    initiatorName: process.env.MPESA_INITIATOR_NAME,
    securityCredential: process.env.MPESA_SECURITY_CREDENTIAL,
    env,
    baseUrl: env === 'production'
      ? 'https://api.safaricom.co.ke'
      : 'https://sandbox.safaricom.co.ke'
  };
}

async function getAccessToken() {
  const config = getMpesaConfig();

  if (accessTokenCache.token && Date.now() < accessTokenCache.expiresAt - 60_000) {
    return accessTokenCache.token;
  }

  const auth = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString('base64');
  const tokenResponse = await axios.get(`${config.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` }
  });

  const expiresInSeconds = Number(tokenResponse.data.expires_in) || 3600;
  accessTokenCache = {
    token: tokenResponse.data.access_token,
    expiresAt: Date.now() + expiresInSeconds * 1000
  };

  return accessTokenCache.token;
}

router.post('/stk-push', async (req, res) => {
  let paymentClaimed = false;

  try {
    const { bookingId, phoneNumber } = req.body;

    if (!bookingId) {
      return res.status(400).json({ error: 'Booking ID is required' });
    }

    const booking = await Booking.findOneAndUpdate(
      {
        booking_id: bookingId,
        status: 'reserved',
        checkout_request_id: { $in: [null, undefined] }
      },
      { $set: { checkout_request_id: 'PENDING' } },
      { new: true }
    );

    if (!booking) {
      return res.status(409).json({
        error: 'Payment already in progress or booking unavailable for payment'
      });
    }

    paymentClaimed = true;
    const releasePaymentClaim = () => Booking.updateOne(
      {
        booking_id: bookingId,
        status: 'reserved',
        checkout_request_id: 'PENDING'
      },
      { $set: { checkout_request_id: null } }
    );

    let normalizedPhone;
    try {
      normalizedPhone = normalizePhoneNumber(phoneNumber);
    } catch (error) {
      await releasePaymentClaim();
      return res.status(400).json({ error: error.message });
    }

    if (!isSafaricomNumber(normalizedPhone)) {
      await releasePaymentClaim();
      return res.status(400).json({ error: 'M-Pesa payments require a Safaricom number' });
    }

    const config = getMpesaConfig();

    if (!config.consumerKey || !config.consumerSecret || !config.shortcode || !config.passkey) {
      await releasePaymentClaim();
      return res.status(500).json({ error: 'Daraja credentials are not configured. Please set the MPESA_* environment variables.' });
    }

    if (!config.callbackUrl) {
      await releasePaymentClaim();
      return res.status(500).json({ error: 'MPESA_CALLBACK_URL is not configured. Please set it in the environment.' });
    }

    const token = await getAccessToken();
    const timestamp = formatDarajaTimestamp();
    const password = Buffer.from(`${config.shortcode}${config.passkey}${timestamp}`).toString('base64');

    const paymentResponse = await axios.post(`${config.baseUrl}/mpesa/stkpush/v1/processrequest`, {
      BusinessShortCode: config.shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: booking.total_amount,
      PartyA: normalizedPhone,
      PartyB: config.shortcode,
      PhoneNumber: normalizedPhone,
      CallBackURL: config.callbackUrl,
      AccountReference: bookingId,
      TransactionDesc: `Daystar bus booking for ${booking.passenger_name || 'student'}`
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });

    const checkoutRequestId = paymentResponse.data.CheckoutRequestID;
    if (!checkoutRequestId) {
      throw new Error('Daraja did not return a CheckoutRequestID');
    }

    const checkoutUpdate = await Booking.updateOne(
      {
        _id: booking._id,
        booking_id: bookingId,
        status: 'reserved',
        checkout_request_id: 'PENDING'
      },
      {
        $set: {
          checkout_request_id: checkoutRequestId,
          phone_number: normalizedPhone
        }
      }
    );

    if (checkoutUpdate.modifiedCount === 0) {
      throw new Error('Unable to save the Daraja CheckoutRequestID');
    }

    res.json({ success: true, message: 'Check your phone to complete payment' });
  } catch (error) {
    if (paymentClaimed) {
      await Booking.updateOne(
        {
          booking_id: req.body?.bookingId,
          status: 'reserved',
          checkout_request_id: 'PENDING'
        },
        { $set: { checkout_request_id: null } }
      ).catch((rollbackError) => {
        console.error('Failed to roll back M-Pesa payment claim:', rollbackError);
      });
    }

    console.error(error.response?.data || error.message);
    res.status(500).json({ error: 'M-Pesa payment request failed', details: error.response?.data || error.message });
  }
});

router.post('/callback', async (req, res) => {
  try {
    const callback = req.body?.Body?.stkCallback;
    const resultCode = callback?.ResultCode;
    const resultDesc = callback?.ResultDesc;
    const checkoutRequestId = callback?.CheckoutRequestID;

    if (resultCode === 0) {
      const metadata = extractCallbackMetadata(callback.CallbackMetadata?.Item);
      const booking = await Booking.findOne({ checkout_request_id: checkoutRequestId });

      if (!booking) {
        throw new Error(`Booking not found for CheckoutRequestID ${checkoutRequestId}`);
      }

      const paidAmount = Number(metadata.Amount);
      const bookingAmount = Number(booking.total_amount);
      const amountDifference = Math.abs(paidAmount - bookingAmount);

      if (!Number.isFinite(paidAmount) || !Number.isFinite(bookingAmount) || amountDifference > 0.01) {
        console.warn('M-Pesa callback amount mismatch; booking left unconfirmed:', {
          bookingId: booking.booking_id,
          paidAmount: metadata.Amount,
          bookingAmount: booking.total_amount
        });
        return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
      }

      await Booking.updateOne(
        { _id: booking._id },
        {
          $set: {
            mpesa_receipt_number: metadata.MpesaReceiptNumber,
            mpesa_transaction_date: metadata.TransactionDate,
            mpesa_phone_number: metadata.PhoneNumber
          }
        }
      );

      await confirmBookingPayment(booking.booking_id);
    } else {
      console.warn('M-Pesa payment failed:', {
        checkoutRequestId,
        resultCode,
        resultDesc
      });
    }
  } catch (error) {
    console.error('M-Pesa callback processing failed:', error);
  }

  return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

function formatDarajaTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function extractCallbackMetadata(items = []) {
  return items.reduce((metadata, item) => {
    if (item?.Name) {
      metadata[item.Name] = item.Value;
    }
    return metadata;
  }, {});
}

module.exports = router;
