require('dotenv').config();

const assert = require('node:assert/strict');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const mongoose = require('mongoose');
const OtpCode = require('../models/OtpCode');
const OtpRateLimit = require('../models/OtpRateLimit');
const Student = require('../models/Student');

const TEST_EMAIL = 'otp-route-test@daystar.ac.ke';
const TEST_FILTER = { email: TEST_EMAIL };

async function request(server, path, body) {
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not configured');
  process.env.OTP_HMAC_SECRET = process.env.OTP_HMAC_SECRET || 'test-only-otp-hmac-secret';
  process.env.OTP_DELIVERY_MODE = 'console';
  process.env.NODE_ENV = 'test';

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  await Promise.all([Student.init(), OtpCode.init(), OtpRateLimit.init()]);
  await Promise.all([
    Student.deleteMany(TEST_FILTER),
    OtpCode.deleteMany(TEST_FILTER),
    OtpRateLimit.deleteMany(TEST_FILTER)
  ]);
  await Student.create({
    email: TEST_EMAIL,
    name: 'OTP Route Test Student',
    admission_number: 'OTP-TEST-001',
    has_bus_pass: true,
    pass_route: 'all'
  });

  const app = express();
  app.use(express.json());
  app.use('/api/auth', require('../routes/auth'));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  const originalLog = console.log;
  let deliveredCode;
  console.log = (...args) => {
    originalLog(...args);
    const match = args.join(' ').match(new RegExp(`OTP console delivery: ${TEST_EMAIL} (\\d{6})`));
    if (match) deliveredCode = match[1];
  };

  try {
    const requestResult = await request(server, '/api/auth/request-otp', { email: TEST_EMAIL });
    originalLog('REQUEST OTP response:', requestResult);
    assert.equal(requestResult.status, 200);
    assert.deepEqual(requestResult.body, { message: 'If the email is eligible, an OTP has been sent.' });
    assert.match(deliveredCode, /^\d{6}$/);

    const wrongResult = await request(server, '/api/auth/verify-otp', { email: TEST_EMAIL, code: '000000' });
    originalLog('WRONG OTP response:', wrongResult);
    assert.equal(wrongResult.status, 401);
    assert.deepEqual(wrongResult.body, { error: 'Invalid or expired OTP' });

    const validResult = await request(server, '/api/auth/verify-otp', { email: TEST_EMAIL, code: deliveredCode });
    originalLog('VALID OTP response:', validResult);
    assert.equal(validResult.status, 200);
    assert.equal(validResult.body.verified, true);

    const expiredCode = '654321';
    const expiredCodeHash = crypto
      .createHmac('sha256', process.env.OTP_HMAC_SECRET)
      .update(`${TEST_EMAIL}:${expiredCode}`)
      .digest('hex');
    const expiredDocument = await OtpCode.create({
      email: TEST_EMAIL,
      code_hash: expiredCodeHash,
      expires_at: new Date(Date.now() - 60000),
      used: false,
      attempts: 0
    });
    originalLog('EXPIRED OTP seeded document:', await OtpCode.findById(expiredDocument._id).lean());
    originalLog('EXPIRED OTP submitted code:', expiredCode);
    const expiredResult = await request(server, '/api/auth/verify-otp', { email: TEST_EMAIL, code: expiredCode });
    originalLog('EXPIRED OTP response:', expiredResult);
    assert.equal(expiredResult.status, 401);
    assert.deepEqual(expiredResult.body, { error: 'Invalid or expired OTP' });
    const expiredDocumentAfterAttempt = await OtpCode.findById(expiredDocument._id).lean();
    originalLog('EXPIRED OTP document after attempt:', expiredDocumentAfterAttempt);
    assert.equal(expiredDocumentAfterAttempt.used, false);
    assert.equal(expiredDocumentAfterAttempt.attempts, 0);

    const concurrentCode = '246810';
    const concurrentCodeHash = crypto
      .createHmac('sha256', process.env.OTP_HMAC_SECRET)
      .update(`${TEST_EMAIL}:${concurrentCode}`)
      .digest('hex');
    const concurrentDocument = await OtpCode.create({
      email: TEST_EMAIL,
      code_hash: concurrentCodeHash,
      expires_at: new Date(Date.now() + 60000),
      used: false,
      attempts: 0
    });
    originalLog('CONCURRENT OTP seeded document:', await OtpCode.findById(concurrentDocument._id).lean());
    originalLog('CONCURRENT OTP submitted code:', concurrentCode);
    const concurrentResults = await Promise.all([
      request(server, '/api/auth/verify-otp', { email: TEST_EMAIL, code: concurrentCode }),
      request(server, '/api/auth/verify-otp', { email: TEST_EMAIL, code: concurrentCode })
    ]);
    originalLog('CONCURRENT VERIFY responses:', JSON.stringify(concurrentResults, null, 2));
    const successfulConcurrentResults = concurrentResults.filter((result) => result.status === 200 && result.body.verified === true);
    const rejectedConcurrentResults = concurrentResults.filter((result) => result.status === 401 && result.body.error === 'Invalid or expired OTP');
    assert.equal(successfulConcurrentResults.length, 1);
    assert.equal(rejectedConcurrentResults.length, 1);
    const concurrentDocumentAfterAttempt = await OtpCode.findById(concurrentDocument._id).lean();
    originalLog('CONCURRENT OTP document after attempts:', concurrentDocumentAfterAttempt);
    assert.equal(concurrentDocumentAfterAttempt.used, true);

    originalLog('ALL OTP ROUTE TESTS PASSED');
  } finally {
    console.log = originalLog;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    const cleanup = await Promise.all([
      Student.deleteMany(TEST_FILTER),
      OtpCode.deleteMany(TEST_FILTER),
      OtpRateLimit.deleteMany(TEST_FILTER)
    ]);
    originalLog('Scoped cleanup results:', cleanup);
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error('OTP ROUTE TEST ERROR:', error);
  process.exitCode = 1;
});