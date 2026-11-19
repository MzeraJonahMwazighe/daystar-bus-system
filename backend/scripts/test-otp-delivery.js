// Checks email delivery of sign-in codes through the Brevo API, using a fake Brevo server
// on this machine (no real email is sent). Uses the real database for codes and rate limits.
// Run: node backend/scripts/test-otp-delivery.js
require('dotenv').config();

const assert = require('node:assert/strict');
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const OtpCode = require('../models/OtpCode');
const OtpRateLimit = require('../models/OtpRateLimit');
const Staff = require('../models/Staff');
const Student = require('../models/Student');

const STUDENT_EMAIL = 'deliverytest250777@daystar.ac.ke';
const STAFF_EMAIL = 'delivery-test-staff@daystar.ac.ke';
const NETWORK_EMAIL = 'deliverytest250778@daystar.ac.ke';
const ALL_TEST_EMAILS = [STUDENT_EMAIL, STAFF_EMAIL, NETWORK_EMAIL];

// ---------- fake Brevo ----------
const brevo = { mode: 'ok', requests: [] };
const fakeBrevo = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => {
    brevo.requests.push({ path: req.url, apiKey: req.headers['api-key'], body: JSON.parse(raw || '{}') });
    if (brevo.mode === 'fail') {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 'unauthorized', message: 'Key not found' }));
      return;
    }
    res.writeHead(201, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ messageId: '<fake-message-id@brevo>' }));
  });
});

let server;
async function post(path, body) {
  const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

function lastCode() {
  const text = brevo.requests.at(-1)?.body?.textContent || '';
  return (/(\d{6})/.exec(text) || [])[1];
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not configured');
  process.env.OTP_HMAC_SECRET = process.env.OTP_HMAC_SECRET || 'test-only-otp-hmac-secret';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-jwt-secret';
  process.env.NODE_ENV = 'test';
  delete process.env.OTP_DELIVERY_MODE;
  process.env.BREVO_API_KEY = 'test-only-brevo-key';
  process.env.EMAIL_FROM = 'Daystar Bus <buses@example.com>';

  await new Promise((resolve) => fakeBrevo.listen(0, '127.0.0.1', resolve));
  process.env.BREVO_API_URL = `http://127.0.0.1:${fakeBrevo.address().port}/v3/smtp/email`;

  const { parseSender } = require('../lib/otp');
  assert.deepEqual(parseSender('Daystar Bus <buses@example.com>'), { name: 'Daystar Bus', email: 'buses@example.com' });
  assert.deepEqual(parseSender('buses@example.com'), { name: 'Daystar Bus System', email: 'buses@example.com' });
  console.log('0 parseSender: OK');

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  await Promise.all([OtpCode.init(), OtpRateLimit.init(), Staff.init(), Student.init()]);
  const cleanupFilter = { email: { $in: ALL_TEST_EMAILS } };
  await Promise.all([OtpCode.deleteMany(cleanupFilter), OtpRateLimit.deleteMany(cleanupFilter), Staff.deleteMany(cleanupFilter), Student.deleteMany(cleanupFilter)]);
  await Staff.create({ email: STAFF_EMAIL, name: 'Delivery Test Admin', role: 'campus_admin', campus: 'athi' });

  const app = express();
  app.use(express.json());
  app.use('/api/auth', require('../routes/auth'));
  app.use('/api/staff/auth', require('../routes/staffAuth'));
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    // ---------- 1. Brevo refuses -> clear 503, code cancelled, no 60-second wait ----------
    brevo.mode = 'fail';
    const failed = await post('/api/auth/request-otp', { email: STUDENT_EMAIL });
    console.log('1a STUDENT request while Brevo refuses:', JSON.stringify(failed));
    assert.equal(failed.status, 503);
    assert.match(failed.body.error, /couldn't send the email/);
    const cancelled = await OtpCode.find({ email: STUDENT_EMAIL }).lean();
    console.log('1b codes stored after failed send:', JSON.stringify(cancelled.map((doc) => ({ used: doc.used, audience: doc.audience }))));
    assert.equal(cancelled.length, 1);
    assert.equal(cancelled[0].used, true);
    const refunded = await OtpRateLimit.findOne({ email: STUDENT_EMAIL }).lean();
    console.log('1c rate limit after failed send:', JSON.stringify({ last_requested_at: refunded.last_requested_at, request_count: refunded.request_count }));
    assert.equal(refunded.request_count, 0);

    // ---------- 2. Brevo accepts -> immediate retry works, email is well-formed, code verifies ----------
    brevo.mode = 'ok';
    const retry = await post('/api/auth/request-otp', { email: STUDENT_EMAIL });
    console.log('2a STUDENT retry right away, Brevo accepts:', JSON.stringify(retry));
    assert.equal(retry.status, 200);
    const sent = brevo.requests.at(-1);
    console.log('2b request Brevo received:', JSON.stringify({ path: sent.path, apiKey: sent.apiKey, sender: sent.body.sender, to: sent.body.to, subject: sent.body.subject, textContent: sent.body.textContent.replace(/\d{6}/, '<code>') }));
    assert.equal(sent.path, '/v3/smtp/email');
    assert.equal(sent.apiKey, 'test-only-brevo-key');
    assert.deepEqual(sent.body.sender, { name: 'Daystar Bus', email: 'buses@example.com' });
    assert.deepEqual(sent.body.to, [{ email: STUDENT_EMAIL }]);
    assert.equal(sent.body.subject, 'Daystar Bus System verification code');
    assert.match(lastCode(), /^\d{6}$/);

    const verify = await post('/api/auth/verify-otp', { email: STUDENT_EMAIL, code: lastCode() });
    console.log('2c VERIFY the emailed code:', JSON.stringify(verify));
    assert.equal(verify.status, 200);
    assert.equal(verify.body.needs_profile, true);

    const tooSoon = await post('/api/auth/request-otp', { email: STUDENT_EMAIL });
    console.log('2d request again within 60s after a successful send:', JSON.stringify(tooSoon));
    assert.equal(tooSoon.status, 429);

    // ---------- 3. Staff codes go the same way ----------
    brevo.mode = 'fail';
    const staffFailed = await post('/api/staff/auth/request-otp', { email: STAFF_EMAIL });
    console.log('3a STAFF request while Brevo refuses:', JSON.stringify(staffFailed));
    assert.equal(staffFailed.status, 503);
    brevo.mode = 'ok';
    const staffRetry = await post('/api/staff/auth/request-otp', { email: STAFF_EMAIL });
    console.log('3b STAFF retry, Brevo accepts:', JSON.stringify(staffRetry));
    assert.equal(staffRetry.status, 200);
    assert.equal(brevo.requests.at(-1).body.subject, 'Daystar Bus System staff sign-in code');
    const staffVerify = await post('/api/staff/auth/verify-otp', { email: STAFF_EMAIL, code: lastCode() });
    console.log('3c STAFF verify the emailed code:', JSON.stringify({ status: staffVerify.status, verified: staffVerify.body.verified }));
    assert.equal(staffVerify.status, 200);

    // ---------- 4. Brevo unreachable (network error) -> same clear 503 ----------
    process.env.BREVO_API_URL = 'http://127.0.0.1:9/unreachable';
    const unreachable = await post('/api/auth/request-otp', { email: NETWORK_EMAIL });
    console.log('4 STUDENT request while Brevo is unreachable:', JSON.stringify(unreachable));
    assert.equal(unreachable.status, 503);

    console.log('ALL OTP DELIVERY TESTS PASSED');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => fakeBrevo.close(resolve));
    const cleanup = await Promise.all([OtpCode.deleteMany(cleanupFilter), OtpRateLimit.deleteMany(cleanupFilter), Staff.deleteMany(cleanupFilter), Student.deleteMany(cleanupFilter)]);
    console.log('SCOPED CLEANUP:', JSON.stringify(cleanup.map((result) => result.deletedCount)));
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error('OTP DELIVERY TEST ERROR:', error);
  process.exitCode = 1;
});
