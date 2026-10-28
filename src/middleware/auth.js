const jwt = require('jsonwebtoken');
const db = require('../config/db');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

// Authentication: verifies JWT and loads the user
exports.protect = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new ApiError(401, 'Authentication required');

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    throw new ApiError(401, 'Invalid or expired token');
  }

  const rows = await db`
    SELECT user_id, name, email, phone, role, is_active
    FROM users
    WHERE user_id = ${payload.id}
  `;
  if (!rows[0]) throw new ApiError(401, 'User no longer exists');
  if (!rows[0].is_active) throw new ApiError(403, 'Account is blocked');

  req.user = rows[0];
  next();
});

// Authorization: role-based access control
exports.authorize = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : next(new ApiError(403, 'Forbidden: insufficient permissions'));
