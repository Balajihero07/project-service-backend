const db = require('../config/db');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { ok } = require('../utils/response');

const SELECT = `
  SELECT pay.*, b.customer_id, p.user_id AS provider_user_id
  FROM payments pay
  JOIN bookings b ON b.booking_id = pay.booking_id
  JOIN service_providers p ON p.provider_id = b.provider_id`;

const canView = (pay, user) =>
  user.role === 'ADMIN' || pay.customer_id === user.user_id || pay.provider_user_id === user.user_id;

// POST /api/payments (customer) -> creates a PENDING payment for a completed booking
exports.create = asyncHandler(async (req, res) => {
  const { booking_id, payment_method } = req.body;
  const br = await db`
    SELECT * FROM bookings WHERE booking_id = ${booking_id}
  `;
  const b = br[0];
  if (!b) throw new ApiError(404, 'Booking not found');
  if (b.customer_id !== req.user.user_id) throw new ApiError(403, 'Forbidden');
  if (b.status !== 'COMPLETED') throw new ApiError(400, 'Payment is allowed only for completed bookings');

  const existing = await db`
    SELECT 1
    FROM payments
    WHERE booking_id = ${booking_id}
      AND payment_status IN ('PENDING', 'SUCCESS')
  `;
  if (existing[0]) throw new ApiError(409, 'A payment already exists for this booking');

  const amount = b.final_amount ?? b.estimated_amount;
  let rows;
  try {
    rows = await db`
      INSERT INTO payments (booking_id, amount, payment_method, transaction_id)
      VALUES (${booking_id}, ${amount}, ${payment_method}, NULL)
      RETURNING *
    `;
  } catch (error) {
    if (error?.code === '23505' &&
        error?.constraint === 'payments_one_open_per_booking_uidx') {
      throw new ApiError(409, 'A payment already exists for this booking');
    }
    throw error;
  }
  ok(res, 'Payment recorded (pending confirmation)', rows[0], 201);
});

// GET /api/payments  (role-scoped list)
exports.list = asyncHandler(async (req, res) => {
  const customerId =
    req.user.role === 'CUSTOMER' ? req.user.user_id : null;
  const providerUserId =
    req.user.role === 'PROVIDER' ? req.user.user_id : null;
  const rows = await db`
    ${db.unsafe(SELECT)}
    WHERE (${customerId}::integer IS NULL OR b.customer_id = ${customerId})
      AND (${providerUserId}::integer IS NULL OR p.user_id = ${providerUserId})
    ORDER BY pay.payment_id DESC
  `;
  ok(res, 'Payments fetched', rows);
});

// GET /api/payments/:id
exports.get = asyncHandler(async (req, res) => {
  const rows = await db`
    ${db.unsafe(SELECT)}
    WHERE pay.payment_id = ${req.params.id}
  `;
  if (!rows[0]) throw new ApiError(404, 'Payment not found');
  if (!canView(rows[0], req.user)) throw new ApiError(403, 'Forbidden');
  ok(res, 'Payment fetched', rows[0]);
});

// PUT /api/payments/:id/status  (provider confirms receipt / admin) body: { status }
// NOTE: with a real gateway (Razorpay etc.) this should be driven by a verified webhook instead.
exports.updateStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const rows = await db`
    ${db.unsafe(SELECT)}
    WHERE pay.payment_id = ${req.params.id}
  `;
  const pay = rows[0];
  if (!pay) throw new ApiError(404, 'Payment not found');

  const isProvider = pay.provider_user_id === req.user.user_id;
  if (req.user.role !== 'ADMIN' && !isProvider) throw new ApiError(403, 'Forbidden');
  if (req.user.role === 'PROVIDER' &&
      (pay.payment_method !== 'CASH' || status !== 'SUCCESS')) {
    throw new ApiError(403, 'Providers may only confirm received cash payments');
  }
  if (status === 'SUCCESS' && pay.payment_method !== 'CASH') {
    throw new ApiError(400, 'Online payment success requires a verified payment gateway confirmation');
  }
  if (status === 'REFUNDED' && req.user.role !== 'ADMIN') throw new ApiError(403, 'Only admin can refund');
  if (pay.payment_status !== 'PENDING' && !(status === 'REFUNDED' && pay.payment_status === 'SUCCESS'))
    throw new ApiError(400, `Cannot change payment from ${pay.payment_status} to ${status}`);

  const upd = await db`
    UPDATE payments
    SET payment_status = ${status},
        paid_at = CASE
          WHEN ${status} = 'SUCCESS' THEN NOW()
          ELSE paid_at
        END
    WHERE payment_id = ${req.params.id}
      AND payment_status = ${pay.payment_status}
    RETURNING *
  `;
  if (!upd[0]) throw new ApiError(409, 'Payment status changed; reload and try again');
  ok(res, `Payment ${status}`, upd[0]);
});
