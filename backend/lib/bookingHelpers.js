function calculateFare(fromCampus, toDestination) {
  const normalizedFrom = String(fromCampus || '').toLowerCase();
  const normalizedTo = String(toDestination || '').toLowerCase();

  if (normalizedTo === 'syokimau' || normalizedFrom === 'syokimau') {
    return 150;
  }

  return 200;
}

function generateTicketNumber() {
  if (process.env.FIXED_BOOKING_ID) {
    return process.env.FIXED_BOOKING_ID;
  }

  const randomSegment = Math.floor(100000 + Math.random() * 900000);
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `BUS-${randomSegment}-${suffix}`;
}

function validatePhoneNumber(phone) {
  return /^07\d{8}$/.test(String(phone || '').trim());
}

function normalizePhoneNumber(input) {
  const cleaned = String(input || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/^\+/, '');

  if (!/^\d+$/.test(cleaned)) {
    throw new Error('Invalid phone number format');
  }

  if (cleaned.startsWith('254') && cleaned.length === 12) {
    return cleaned;
  }

  if (cleaned.startsWith('0') && cleaned.length === 10) {
    const nationalNumber = cleaned.slice(1);
    if (/^[17]\d{8}$/.test(nationalNumber)) {
      return `254${nationalNumber}`;
    }
  }

  if (cleaned.length === 9 && /^[17]\d{8}$/.test(cleaned)) {
    return `254${cleaned}`;
  }

  throw new Error('Invalid phone number format');
}

function isSafaricomNumber(normalizedNumber) {
  const digits = String(normalizedNumber || '').trim();
  if (!/^254\d{9}$/.test(digits)) {
    return false;
  }

  const nationalPrefix = digits.slice(3, 6);
  const safaricomPrefixes = new Set([
    '700', '701', '702', '703', '704', '705',
    '710', '711', '712', '713', '714', '715', '716', '717', '718', '719',
    '720', '721', '722', '723', '724', '725', '726', '727', '728', '729',
    '740', '741', '742', '743', '744', '745', '746', '747', '748',
    '790', '791', '792', '793', '794', '795', '796', '797', '798', '799',
    '100', '101', '102', '103', '104', '105', '106', '107', '108', '109',
    '110', '111', '112', '113', '114', '115'
  ]);

  return safaricomPrefixes.has(nationalPrefix);
}

function buildTicketPayload({ ticketId, busPlate, seats, destination, time, amount, passengerName, phoneNumber }) {
  return {
    ticket: ticketId,
    bus: busPlate,
    seats,
    time,
    destination,
    amount,
    passengerName,
    phoneNumber
  };
}

module.exports = {
  calculateFare,
  generateTicketNumber,
  validatePhoneNumber,
  normalizePhoneNumber,
  isSafaricomNumber,
  buildTicketPayload
};
