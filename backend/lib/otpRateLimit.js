const OtpRateLimit = require('../models/OtpRateLimit');

const COOLDOWN_MS = 60 * 1000;
const WINDOW_MS = 60 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 5;

async function acquireOtpRateLimit(email, now = new Date()) {
  const cooldownCutoff = new Date(now.getTime() - COOLDOWN_MS);
  const windowCutoff = new Date(now.getTime() - WINDOW_MS);

  try {
    const rateLimit = await OtpRateLimit.findOneAndUpdate(
      {
        email,
        $and: [
          {
            $or: [
              { last_requested_at: { $exists: false } },
              { last_requested_at: { $lte: cooldownCutoff } }
            ]
          },
          {
            $or: [
              { window_started_at: { $exists: false } },
              { window_started_at: { $lte: windowCutoff } },
              { request_count: { $lt: MAX_REQUESTS_PER_WINDOW } }
            ]
          }
        ]
      },
      [
        {
          $set: {
            email,
            last_requested_at: now,
            window_started_at: {
              $cond: [
                { $lte: ['$window_started_at', windowCutoff] },
                now,
                '$window_started_at'
              ]
            },
            request_count: {
              $cond: [
                { $lte: ['$window_started_at', windowCutoff] },
                1,
                { $add: ['$request_count', 1] }
              ]
            }
          }
        }
      ],
      { upsert: true, new: true }
    );

    return { allowed: Boolean(rateLimit), rateLimit };
  } catch (error) {
    if (error.code === 11000 && (error.keyPattern?.email || error.keyValue?.email === email)) {
      return { allowed: false, reason: 'rate_limited' };
    }

    throw error;
  }
}

module.exports = {
  acquireOtpRateLimit
};