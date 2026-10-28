const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const calls = [];
const results = [];
const mockDb = async (strings, ...values) => {
  const sql = strings.reduce((text, part, index) => {
    const value = values[index];
    const formatted = value?.rawSql !== undefined
      ? value.rawSql
      : value === undefined
      ? ''
      : value === null
        ? 'NULL'
        : typeof value === 'string'
          ? `'${value}'`
          : String(value);
    return text + part + formatted;
  }, '');
  calls.push(sql);
  const result = results.shift();
  if (result instanceof Error) throw result;
  return result || [];
};
mockDb.unsafe = (value) => ({ rawSql: value });
mockDb.transaction = async (callback) => Promise.all(callback(mockDb));

const originalLoad = Module._load;
Module._load = function loadWithMock(request, parent, isMain) {
  const parentPath = parent?.filename || '';
  if (request === '../config/db' &&
      (parentPath.endsWith(`${path.sep}bookingService.js`) ||
       parentPath.endsWith(`${path.sep}paymentController.js`))) {
    return mockDb;
  }
  return originalLoad.call(this, request, parent, isMain);
};

const bookingService = require('../src/services/bookingService');
const paymentController = require('../src/controllers/paymentController');
Module._load = originalLoad;

const reset = () => {
  calls.length = 0;
  results.length = 0;
};

const response = () => ({
  statusCode: null,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

test.beforeEach(reset);

test('provider acceptance conditionally assigns only an open requested booking', async () => {
  results.push([], [], [{ booking_id: 17 }]);

  const bookingId = await bookingService.acceptBooking(17, 8);

  assert.equal(bookingId, 17);
  const acceptQuery = calls.at(-1);
  assert.match(acceptQuery, /r\.status = 'SENT'/);
  assert.match(acceptQuery, /b\.status = 'REQUESTED'/);
  assert.match(acceptQuery, /b\.provider_id IS NULL/);
  assert.match(acceptQuery, /p\.user_id = 8/);
  assert.match(acceptQuery, /status = 'ACCEPTED'/);
});

test('provider rejection updates only that provider request', async () => {
  results.push([], [], [{ booking_id: 17 }], [{ booking_id: 17 }], []);

  await bookingService.rejectBooking(17, 8);

  const rejectQuery = calls.find((sql) =>
    sql.includes('UPDATE booking_provider_requests') && sql.includes("SET status = 'REJECTED'")
  );
  assert.ok(rejectQuery);
  assert.match(rejectQuery, /p\.user_id = 8/);
  assert.match(rejectQuery, /r\.status = 'SENT'/);
  assert.match(rejectQuery, /b\.status = 'REQUESTED'/);
});

test('provider active list is assigned-provider scoped and paginated', async () => {
  results.push([{ booking_id: 17, status: 'ACCEPTED' }], [{ total: 1 }]);

  const result = await bookingService.listProviderBookings(8, 'active', {
    status: 'ACCEPTED', page: 2, limit: 5,
  });

  assert.equal(result.pagination.page, 2);
  assert.equal(result.pagination.total_pages, 1);
  assert.match(calls[0], /p\.user_id = 8/);
  assert.match(calls[0], /b\.status IN \('ACCEPTED', 'ON_THE_WAY', 'STARTED'\)/);
  assert.match(calls[0], /LIMIT 5 OFFSET 5/);
  assert.match(calls[1], /p\.user_id = 8/);
});

test('provider history rejects active status filters', async () => {
  await assert.rejects(
    bookingService.listProviderBookings(8, 'history', { status: 'STARTED' }),
    { statusCode: 400 }
  );
  assert.equal(calls.length, 0);
});

test('customer booking history query is customer scoped and newest first', async () => {
  results.push([], [], [{ booking_id: 17 }]);

  const bookings = await bookingService.listBookings({ user_id: 31, role: 'CUSTOMER' });

  assert.equal(bookings.length, 1);
  assert.match(calls[2], /b\.customer_id = 31/);
  assert.match(calls[2], /ORDER BY b\.created_at DESC\s*$/);
  assert.doesNotMatch(calls[2], /ORDER BY b\.created_at DESC\s+LIMIT/);
});

test('another customer cannot fetch booking details', async () => {
  results.push([], [], [{
    booking_id: 17,
    customer_id: 31,
    provider_user_id: 8,
  }]);

  await assert.rejects(
    bookingService.loadBooking(17, { user_id: 32, role: 'CUSTOMER' }),
    { statusCode: 403 }
  );
});

test('valid OTP moves an assigned provider booking to STARTED', async () => {
  process.env.JWT_SECRET = 'test-secret';
  results.push([{ status: 'STARTED', otp_attempts: 0 }]);

  await bookingService.verifyBookingOtp(17, 8, '123456');

  assert.match(calls[0], /SET status = CASE/);
  assert.match(calls[0], /THEN 'STARTED'/);
  assert.match(calls[0], /p\.user_id = 8/);
  assert.match(calls[0], /b\.otp_used_at IS NULL/);
  assert.match(calls[0], /b\.otp_expires_at > NOW\(\)/);
});

test('expired or missing OTP cannot start work', async () => {
  process.env.JWT_SECRET = 'test-secret';
  results.push([], [{
    status: 'ACCEPTED',
    otp_expires_at: new Date(Date.now() - 1000),
    otp_attempts: 0,
    otp_used_at: null,
    provider_user_id: 8,
  }]);

  await assert.rejects(
    bookingService.verifyBookingOtp(17, 8, '123456'),
    { statusCode: 400 }
  );
});

test('completion requires a STARTED booking and provider ownership', async () => {
  results.push([{ booking_id: 17 }]);

  await bookingService.updateBookingStatus(17, { user_id: 8, role: 'PROVIDER' }, 'COMPLETED');

  assert.match(calls[0], /b\.status = 'STARTED'/);
  assert.match(calls[0], /p\.user_id = 8/);
  assert.match(calls[0], /completed_at = CASE WHEN 'COMPLETED' = 'COMPLETED' THEN NOW\(\)/);
});

test('payment derives amount and ignores a client transaction ID', async () => {
  results.push(
    [{ booking_id: 17, customer_id: 31, status: 'COMPLETED', final_amount: '325.00' }],
    [],
    [{ payment_id: 41, amount: '325.00', payment_method: 'CASH', payment_status: 'PENDING' }]
  );
  const res = response();
  const errors = [];

  await paymentController.create({
    body: { booking_id: 17, payment_method: 'CASH', transaction_id: 'untrusted' },
    user: { user_id: 31, role: 'CUSTOMER' },
  }, res, (error) => errors.push(error));

  assert.equal(errors.length, 0);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.amount, '325.00');
  assert.match(calls[2], /'325\.00', 'CASH', NULL/);
});

test('provider cannot mark a non-cash payment successful', async () => {
  results.push([{
    payment_id: 41,
    payment_status: 'PENDING',
    payment_method: 'ONLINE',
    customer_id: 31,
    provider_user_id: 8,
  }]);
  const errors = [];

  await paymentController.updateStatus({
    params: { id: '41' },
    body: { status: 'SUCCESS' },
    user: { user_id: 8, role: 'PROVIDER' },
  }, response(), (error) => errors.push(error));

  assert.equal(errors[0]?.statusCode, 403);
  assert.equal(calls.length, 1);
});

test('customer cannot create payment for another customer booking', async () => {
  results.push([{
    booking_id: 17,
    customer_id: 31,
    status: 'COMPLETED',
    final_amount: '325.00',
  }]);
  const errors = [];

  await paymentController.create({
    body: { booking_id: 17, payment_method: 'CASH' },
    user: { user_id: 32, role: 'CUSTOMER' },
  }, response(), (error) => errors.push(error));

  assert.equal(errors[0]?.statusCode, 403);
  assert.equal(calls.length, 1);
});

test('unrelated users cannot fetch payment details', async () => {
  results.push([{
    payment_id: 41,
    customer_id: 31,
    provider_user_id: 8,
  }]);
  const errors = [];

  await paymentController.get({
    params: { id: '41' },
    user: { user_id: 32, role: 'CUSTOMER' },
  }, response(), (error) => errors.push(error));

  assert.equal(errors[0]?.statusCode, 403);
});

test('concurrent duplicate payment constraint maps to HTTP 409', async () => {
  const duplicate = new Error('duplicate');
  duplicate.code = '23505';
  duplicate.constraint = 'payments_one_open_per_booking_uidx';
  results.push(
    [{ booking_id: 17, customer_id: 31, status: 'COMPLETED', estimated_amount: '300.00' }],
    [],
    duplicate
  );
  const errors = [];

  await paymentController.create({
    body: { booking_id: 17, payment_method: 'CASH' },
    user: { user_id: 31, role: 'CUSTOMER' },
  }, response(), (error) => errors.push(error));

  assert.equal(errors[0]?.statusCode, 409);
});