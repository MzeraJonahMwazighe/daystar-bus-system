require('dotenv').config();

const mongoose = require('mongoose');
const OtpRateLimit = require('../models/OtpRateLimit');
const { acquireOtpRateLimit } = require('../lib/otpRateLimit');

const TEST_EMAILS = [
  'otp-test-cooldown@daystar.ac.ke',
  'otp-test-hourly@daystar.ac.ke',
  'otp-test-new@daystar.ac.ke',
  'otp-test-reset@daystar.ac.ke'
];

function printResult(name, passed, result) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  console.log(result);
}

async function main() {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is not configured');
  }

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  console.log('Connected to MongoDB');

  await OtpRateLimit.init();
  console.log('OtpRateLimit indexes:');
  console.log(await OtpRateLimit.collection.indexes());

  const cleanupFilter = { email: { $in: TEST_EMAILS } };
  const beforeDelete = await OtpRateLimit.deleteMany(cleanupFilter);
  console.log('Initial scoped delete result:', beforeDelete);

  const now = new Date();
  const cooldownEmail = TEST_EMAILS[0];
  await OtpRateLimit.create({
    email: cooldownEmail,
    last_requested_at: new Date(now.getTime() - 59 * 1000),
    window_started_at: new Date(now.getTime() - 10 * 60 * 1000),
    request_count: 1
  });
  const cooldownResult = await acquireOtpRateLimit(cooldownEmail, now);
  printResult('cooldown request #2 rejected', !cooldownResult.allowed, cooldownResult);

  const hourlyEmail = TEST_EMAILS[1];
  await OtpRateLimit.create({
    email: hourlyEmail,
    last_requested_at: new Date(now.getTime() - 2 * 60 * 1000),
    window_started_at: new Date(now.getTime() - 10 * 60 * 1000),
    request_count: 5
  });
  const hourlyResult = await acquireOtpRateLimit(hourlyEmail, now);
  printResult('hourly request #6 rejected', !hourlyResult.allowed, hourlyResult);

  const newEmail = TEST_EMAILS[2];
  const newResult = await acquireOtpRateLimit(newEmail, now);
  const newDocument = await OtpRateLimit.findOne({ email: newEmail }).lean();
  printResult(
    'new email allowed with request_count 1',
    newResult.allowed && newDocument?.request_count === 1,
    { result: newResult, document: newDocument }
  );

  const resetEmail = TEST_EMAILS[3];
  await OtpRateLimit.create({
    email: resetEmail,
    last_requested_at: new Date(now.getTime() - 2 * 60 * 60 * 1000),
    window_started_at: new Date(now.getTime() - 2 * 60 * 60 * 1000),
    request_count: 5
  });
  const resetResult = await acquireOtpRateLimit(resetEmail, now);
  const resetDocument = await OtpRateLimit.findOne({ email: resetEmail }).lean();
  printResult(
    'expired hourly window resets request_count to 1',
    resetResult.allowed && resetDocument?.request_count === 1,
    { result: resetResult, document: resetDocument }
  );

  const afterScenarioDelete = await OtpRateLimit.deleteMany(cleanupFilter);
  console.log('Post-scenario scoped delete result:', afterScenarioDelete);
  const remainingAfterScenarioCleanup = await OtpRateLimit.countDocuments(cleanupFilter);
  console.log('Remaining scoped documents after four scenarios:', remainingAfterScenarioCleanup);

  const concurrentEmail = TEST_EMAILS[2];
  const concurrentResults = await Promise.all([
    acquireOtpRateLimit(concurrentEmail, now),
    acquireOtpRateLimit(concurrentEmail, now)
  ]);
  console.log('Concurrent same-new-email results:');
  console.log(concurrentResults);
  const concurrentAllowedCount = concurrentResults.filter((result) => result.allowed).length;
  const concurrentRejectedCount = concurrentResults.filter((result) => !result.allowed).length;
  printResult(
    'concurrent calls produce exactly one allowed and one rejected',
    concurrentAllowedCount === 1 && concurrentRejectedCount === 1,
    concurrentResults
  );

  const finalDelete = await OtpRateLimit.deleteMany(cleanupFilter);
  console.log('Final scoped delete result:', finalDelete);
  const remainingAfterFinalCleanup = await OtpRateLimit.countDocuments(cleanupFilter);
  console.log('Remaining scoped documents after all tests:', remainingAfterFinalCleanup);

  if (
    !cooldownResult.allowed &&
    !hourlyResult.allowed &&
    newResult.allowed &&
    newDocument?.request_count === 1 &&
    resetResult.allowed &&
    resetDocument?.request_count === 1 &&
    concurrentAllowedCount === 1 &&
    concurrentRejectedCount === 1 &&
    remainingAfterFinalCleanup === 0
  ) {
    console.log('ALL TESTS PASSED');
  } else {
    throw new Error('One or more OTP rate-limit tests failed');
  }
}

main()
  .catch((error) => {
    console.error('TEST SCRIPT ERROR:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });