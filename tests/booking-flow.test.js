const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateFare, generateTicketNumber, validatePhoneNumber } = require('../backend/lib/bookingHelpers');

test('calculateFare returns correct fares for known routes', () => {
  assert.equal(calculateFare('athi', 'nairobi'), 200);
  assert.equal(calculateFare('nairobi', 'athi'), 200);
  assert.equal(calculateFare('athi', 'syokimau'), 150);
  assert.equal(calculateFare('syokimau', 'nairobi'), 150);
});

test('generateTicketNumber produces a ticket-like identifier', () => {
  const ticket = generateTicketNumber();
  assert.match(ticket, /^BUS-\d{6}-[A-Z0-9]{4}$/);
});

test('validatePhoneNumber accepts Kenyan mobile numbers and rejects invalid values', () => {
  assert.equal(validatePhoneNumber('0712345678'), true);
  assert.equal(validatePhoneNumber('254712345678'), false);
  assert.equal(validatePhoneNumber('07123'), false);
});
