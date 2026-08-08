const path = require('path');
const fixedBookingId = process.env.FIXED_BOOKING_ID;
if (!fixedBookingId) {
  return;
}

const bookingHelpersPath = path.resolve(process.cwd(), 'backend/lib/bookingHelpers.js');
const original = require(bookingHelpersPath);
require.cache[bookingHelpersPath] = {
  id: bookingHelpersPath,
  filename: bookingHelpersPath,
  loaded: true,
  exports: {
    ...original,
    generateTicketNumber: () => fixedBookingId
  }
};
