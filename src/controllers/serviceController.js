const db = require('../config/db');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { ok } = require('../utils/response');

// GET /api/services?q=&category=
exports.list = asyncHandler(async (req, res) => {
  const { q, category } = req.query;
  const search = q ? `%${q}%` : null;
  const rows = await db`
    SELECT *
    FROM services
    WHERE is_active = TRUE
      AND (${search}::text IS NULL OR service_name ILIKE ${search} OR description ILIKE ${search})
      AND (${category || null}::text IS NULL OR category = ${category || null})
    ORDER BY service_name
  `;
  ok(res, 'Services fetched', rows);
});

// GET /api/services/:id
exports.get = asyncHandler(async (req, res) => {
  const rows = await db`
    SELECT * FROM services WHERE service_id = ${req.params.id}
  `;
  if (!rows[0]) throw new ApiError(404, 'Service not found');
  ok(res, 'Service fetched', rows[0]);
});

// POST /api/services (admin)
exports.create = asyncHandler(async (req, res) => {
  const { service_name, description, category, base_price = 0 } = req.body;
  const rows = await db`
    INSERT INTO services (service_name, description, category, base_price)
    VALUES (${service_name}, ${description}, ${category}, ${base_price})
    RETURNING *
  `;
  ok(res, 'Service created', rows[0], 201);
});

// PUT /api/services/:id (admin)
exports.update = asyncHandler(async (req, res) => {
  const { service_name, description, category, base_price, is_active } = req.body;
  const rows = await db`
    UPDATE services
    SET service_name = COALESCE(${service_name}, service_name),
        description = COALESCE(${description}, description),
        category = COALESCE(${category}, category),
        base_price = COALESCE(${base_price}, base_price),
        is_active = COALESCE(${is_active}, is_active)
    WHERE service_id = ${req.params.id}
    RETURNING *
  `;
  if (!rows[0]) throw new ApiError(404, 'Service not found');
  ok(res, 'Service updated', rows[0]);
});

// DELETE /api/services/:id (admin) -> deactivate
exports.remove = asyncHandler(async (req, res) => {
  const rows = await db`
    UPDATE services
    SET is_active = FALSE
    WHERE service_id = ${req.params.id}
    RETURNING service_id
  `;
  if (!rows.length) throw new ApiError(404, 'Service not found');
  ok(res, 'Service deactivated');
});
