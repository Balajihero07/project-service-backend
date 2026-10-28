const db = require('../config/db');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { ok } = require('../utils/response');

// POST /api/reviews (customer, once per completed booking)
exports.create = asyncHandler(async (req, res) => {
  const { booking_id, rating, comment } = req.body;
  const br = await db`
    SELECT * FROM bookings WHERE booking_id = ${booking_id}
  `;
  const b = br[0];
  if (!b) throw new ApiError(404, 'Booking not found');
  if (b.customer_id !== req.user.user_id) throw new ApiError(403, 'Forbidden');
  if (b.status !== 'COMPLETED') throw new ApiError(400, 'You can review only completed bookings');

  const rows = await db`
    INSERT INTO reviews (booking_id, customer_id, provider_id, rating, comment)
    VALUES (
      ${booking_id},
      ${req.user.user_id},
      ${b.provider_id},
      ${rating},
      ${comment || null}
    )
    RETURNING *
  `;
  ok(res, 'Review submitted', rows[0], 201);
});
