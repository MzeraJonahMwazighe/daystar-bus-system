function calculateFare(fromCampus, toDestination) {
  const normalizedFrom = String(fromCampus || '').toLowerCase();
  const normalizedTo = String(toDestination || '').toLowerCase();

  if (normalizedTo === 'syokimau' || normalizedFrom === 'syokimau') {
    return 150;
  }

  return 200;
}

function generateTicketNumber() {
  const randomSegment = Math.floor(100000 + Math.random() * 900000);
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `BUS-${randomSegment}-${suffix}`;
}

function validatePhoneNumber(phone) {
  return /^07\d{8}$/.test(String(phone || '').trim());
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
  buildTicketPayload
};
