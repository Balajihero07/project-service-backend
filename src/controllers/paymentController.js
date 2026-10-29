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

  const bookings = await db`
    SELECT
      b.*,
      p.upi_id,
      u.name AS provider_name
    FROM bookings b
    JOIN service_providers p
      ON p.provider_id = b.provider_id
    JOIN users u
      ON u.user_id = p.user_id
    WHERE b.booking_id = ${booking_id}
  `;

  const booking = bookings[0];

  if (!booking) {
    throw new ApiError(
      404,
      'Booking or assigned provider not found.'
    );
  }

  if (Number(booking.customer_id) !== Number(req.user.user_id)) {
    throw new ApiError(403, 'Forbidden');
  }

  if (booking.status !== 'COMPLETED') {
    throw new ApiError(
      400,
      'Payment is allowed only after the service is completed.'
    );
  }

  const amount = Number(
    booking.final_amount ?? booking.estimated_amount
  );

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ApiError(400, 'Invalid service payment amount.');
  }

  if (payment_method === 'QR' && !booking.upi_id) {
    throw new ApiError(
      400,
      'The assigned provider has not saved a UPI ID.'
    );
  }

  // Keep one open payment per booking.
  const existing = await db`
  SELECT *
  FROM payments
  WHERE booking_id = ${booking_id}
    AND payment_status IN ('PENDING', 'SUCCESS')
  ORDER BY payment_id DESC
  LIMIT 1
`;

if (existing[0]) {
  const currentPayment = existing[0];

  // Prevent switching payment methods for the same booking.
  if (currentPayment.payment_method !== payment_method) {
    throw new ApiError(
      409,
      `A payment already exists using ${currentPayment.payment_method}.`
    );
  }

  let upiUri = null;

  // Return the QR URI again only for an unpaid QR payment.
  if (
    currentPayment.payment_method === 'QR' &&
    currentPayment.payment_status === 'PENDING'
  ) {
    const payeeUpiId =
      currentPayment.payee_upi_id || booking.upi_id;

    if (!payeeUpiId) {
      throw new ApiError(
        400,
        "The provider's UPI ID is not configured."
      );
    }

    const params = new URLSearchParams({
      pa: payeeUpiId,
      pn: booking.provider_name,
      am: Number(currentPayment.amount).toFixed(2),
      cu: 'INR',
      tn: `Project Service booking ${booking_id}`,
    });

    upiUri = `upi://pay?${params.toString()}`;
  }

  return ok(
    res,
    currentPayment.payment_status === 'SUCCESS'
      ? 'Payment has already been confirmed.'
      : 'Existing payment retrieved.',
    {
      ...currentPayment,
      provider_name: booking.provider_name,
      upi_uri: upiUri,
    },
    200
  );
}

const payeeUpiId =
  payment_method === 'QR' ? booking.upi_id : null;

if (payment_method === 'QR' && !payeeUpiId) {
  throw new ApiError(
    400,
    "The provider's UPI ID is not configured."
  );
}

let rows;

try {
  rows = await db`
    INSERT INTO payments (
      booking_id,
      amount,
      payment_method,
      transaction_id,
      payee_upi_id
    )
    VALUES (
      ${booking_id},
      ${amount.toFixed(2)},
      ${payment_method},
      NULL,
      ${payeeUpiId}
    )
    RETURNING *
  `;
} catch (error) {
  if (
    error?.code === '23505' &&
    error?.constraint === 'payments_one_open_per_booking_uidx'
  ) {
    throw new ApiError(
      409,
      'A payment already exists for this booking. Refresh and try again.'
    );
  }

  throw error;
}

const payment = rows[0];

let upiUri = null;

if (payment_method === 'QR') {
  const params = new URLSearchParams({
    pa: payeeUpiId,
    pn: booking.provider_name,
    am: Number(payment.amount).toFixed(2),
    cu: 'INR',
    tn: `Project Service booking ${booking_id}`,
  });

  upiUri = `upi://pay?${params.toString()}`;
}

return ok(
  res,
  'Payment created. Waiting for provider confirmation.',
  {
    ...payment,
    provider_name: booking.provider_name,
    upi_uri: upiUri,
  },
  201
);
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
  const paymentId = Number(req.params.id);

  const rows = await db`
    ${db.unsafe(SELECT)}
    WHERE pay.payment_id = ${paymentId}
  `;

  const payment = rows[0];

  if (!payment) {
    throw new ApiError(404, 'Payment not found.');
  }

  const isAssignedProvider =
    Number(payment.provider_user_id) === Number(req.user.user_id);

  if (
    req.user.role !== 'ADMIN' &&
    !(
      req.user.role === 'PROVIDER' &&
      isAssignedProvider
    )
  ) {
    throw new ApiError(403, 'Only the assigned provider can confirm receipt.');
  }

  if (req.user.role === 'PROVIDER') {
    if (
      status !== 'SUCCESS' ||
      !['QR', 'CASH'].includes(payment.payment_method)
    ) {
      throw new ApiError(
        403,
        'Providers can only confirm received QR or cash payments.'
      );
    }
  }

  if (
    status === 'SUCCESS' &&
    !['QR', 'CASH'].includes(payment.payment_method)
  ) {
    throw new ApiError(
      400,
      'This payment method requires its own verification process.'
    );
  }

  if (status === 'REFUNDED' && req.user.role !== 'ADMIN') {
    throw new ApiError(403, 'Only admin can refund.');
  }

  if (
    payment.payment_status !== 'PENDING' &&
    !(status === 'REFUNDED' && payment.payment_status === 'SUCCESS')
  ) {
    throw new ApiError(
      409,
      `Cannot change payment from ${payment.payment_status} to ${status}.`
    );
  }

  if (status === 'SUCCESS') {
    const confirmed = await db`
      WITH updated_payment AS (
        UPDATE payments pay
        SET payment_status = 'SUCCESS',
            paid_at = NOW()
        FROM bookings b
        JOIN service_providers p
          ON p.provider_id = b.provider_id
        WHERE pay.payment_id = ${paymentId}
          AND pay.booking_id = b.booking_id
          AND pay.payment_status = 'PENDING'
          AND pay.payment_method IN ('QR', 'CASH')
          AND b.status = 'COMPLETED'
          AND (
            ${req.user.role === 'ADMIN'}::boolean
            OR p.user_id = ${req.user.user_id}
          )
        RETURNING pay.*
      ),
      closed_booking AS (
        UPDATE bookings b
        SET status = 'CLOSED',
            updated_at = NOW()
        FROM updated_payment pay
        WHERE b.booking_id = pay.booking_id
          AND b.status = 'COMPLETED'
        RETURNING b.booking_id
      )
      SELECT
        pay.*,
        closed.booking_id AS closed_booking_id
      FROM updated_payment pay
      JOIN closed_booking closed
        ON closed.booking_id = pay.booking_id
    `;

    if (!confirmed[0]) {
      throw new ApiError(
        409,
        'Payment was not confirmed. Reload the booking and check its status.'
      );
    }

    return ok(
      res,
      'Payment confirmed and booking closed.',
      confirmed[0]
    );
  }

  // Failed/refund transitions are retained for administrative handling.
  if (req.user.role !== 'ADMIN') {
    throw new ApiError(
      403,
      'Only admin can mark a payment failed or refunded.'
    );
  }

  const updated = await db`
    UPDATE payments
    SET payment_status = ${status},
        paid_at = CASE
          WHEN ${status} = 'SUCCESS' THEN NOW()
          ELSE paid_at
        END
    WHERE payment_id = ${paymentId}
      AND payment_status = ${payment.payment_status}
    RETURNING *
  `;

  if (!updated[0]) {
    throw new ApiError(
      409,
      'Payment status changed. Reload and try again.'
    );
  }

  return ok(res, `Payment ${status}.`, updated[0]);
});

