const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateFare, calculateZoneFare, generateTicketNumber, validatePhoneNumber, normalizePhoneNumber, isSafaricomNumber } = require('../backend/lib/bookingHelpers');

test('calculateFare returns correct fares for known routes', () => {
  assert.equal(calculateFare('athi', 'nairobi'), 200);
  assert.equal(calculateFare('nairobi', 'athi'), 200);
  assert.equal(calculateFare('athi', 'syokimau'), 150);
  assert.equal(calculateFare('syokimau', 'nairobi'), 150);
});

test('calculateZoneFare applies same-zone and cross-zone fares', () => {
  const route = {
    stops: [
      { name: 'Valley Road Campus', zone: 'valley_road_side' },
      { name: 'Mbagathi', zone: 'valley_road_side' },
      { name: 'Katani (Syokimau)', zone: 'athi_river_side' }
    ]
  };

  assert.equal(calculateZoneFare('Valley Road Campus', 'Mbagathi', route), 150);
  assert.equal(calculateZoneFare('Mbagathi', 'Katani (Syokimau)', route), 200);
  assert.equal(calculateZoneFare('Katani (Syokimau)', 'Mbagathi', route), 200);
});

test('calculateZoneFare rejects stops missing from the route', () => {
  assert.throws(
    () => calculateZoneFare('Unknown stop', 'Mbagathi', { stops: [{ name: 'Mbagathi', zone: 'valley_road_side' }] }),
    /Stop not found in route\.stops: boarding stop 'Unknown stop'/
  );
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

test('normalizePhoneNumber converts Kenyan mobile formats to Daraja format', () => {
  assert.equal(normalizePhoneNumber('0712345678'), '254712345678');
  assert.equal(normalizePhoneNumber('0112345678'), '254112345678');
  assert.equal(normalizePhoneNumber('+254712345678'), '254712345678');
  assert.equal(normalizePhoneNumber('254712345678'), '254712345678');
  assert.equal(normalizePhoneNumber('712345678'), '254712345678');
  assert.equal(normalizePhoneNumber(' 0712 345 678'), '254712345678');
});

test('normalizePhoneNumber rejects invalid phone formats', () => {
  assert.throws(() => normalizePhoneNumber('abc'), /Invalid phone number format/);
  assert.throws(() => normalizePhoneNumber('07123'), /Invalid phone number format/);
  assert.throws(() => normalizePhoneNumber('25471234567'), /Invalid phone number format/);
});

test('isSafaricomNumber recognizes Safaricom and non-Safaricom prefixes', () => {
  assert.equal(isSafaricomNumber('254712345678'), true);
  assert.equal(isSafaricomNumber('254790123456'), true);
  assert.equal(isSafaricomNumber('254730123456'), false);
  assert.equal(isSafaricomNumber('254119123456'), false);
});
