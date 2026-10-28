const db = require('../config/db');
// ADMIN STATS
const getStats = async () => {
  const rows = await db`
    SELECT
      (
        SELECT COUNT(*)
        FROM users
        WHERE role = 'CUSTOMER'
      ) AS customers,

      (
        SELECT COUNT(*)
        FROM service_providers
      ) AS providers,

      (
        SELECT COUNT(*)
        FROM service_providers
        WHERE verification_status = 'PENDING'
      ) AS pending_verifications,

      (
        SELECT COUNT(*)
        FROM bookings
      ) AS bookings,

      (
        SELECT COUNT(*)
        FROM bookings
        WHERE status = 'COMPLETED'
      ) AS completed_bookings,

      (
        SELECT COALESCE(SUM(amount), 0)
        FROM payments
        WHERE payment_status = 'SUCCESS'
      ) AS total_revenue
  `;

  return rows[0];
};

//GET USERS

const getUsers = async ({ role, q }) => {
  let rows;

  /*
   * No filters
   */
  if (!role && !q) {
    rows = await db`
      SELECT
        user_id,
        name,
        email,
        phone,
        role,
        is_active,
        created_at
      FROM users
      ORDER BY created_at DESC
    `;

    return rows;
  }


  /*
   * Role + Search
   */
  if (role && q) {
    const search = `%${q}%`;

    rows = await db`
      SELECT
        user_id,
        name,
        email,
        phone,
        role,
        is_active,
        created_at
      FROM users
      WHERE role = ${role}
        AND (
          name ILIKE ${search}
          OR email ILIKE ${search}
        )
      ORDER BY created_at DESC
    `;

    return rows;
  }


  /*
   * Role only
   */
  if (role) {
    rows = await db`
      SELECT
        user_id,
        name,
        email,
        phone,
        role,
        is_active,
        created_at
      FROM users
      WHERE role = ${role}
      ORDER BY created_at DESC
    `;

    return rows;
  }


  /*
   * Search only
   */
  const search = `%${q}%`;

  rows = await db`
    SELECT
      user_id,
      name,
      email,
      phone,
      role,
      is_active,
      created_at
    FROM users
    WHERE
      name ILIKE ${search}
      OR email ILIKE ${search}
    ORDER BY created_at DESC
  `;

  return rows;
};


/*
|--------------------------------------------------------------------------
| GET SERVICE PROVIDERS
|--------------------------------------------------------------------------
*/

const getProviders = async (status) => {
  let rows;

  /*
   * Status filter
   */
  if (status) {
    rows = await db`
      SELECT
        p.*,
        u.name,
        u.email,
        u.phone
      FROM service_providers p
      JOIN users u
        ON u.user_id = p.user_id
      WHERE p.verification_status = ${status}
      ORDER BY p.created_at DESC
    `;

    return rows;
  }


  /*
   * All providers
   */
  rows = await db`
    SELECT
      p.*,
      u.name,
      u.email,
      u.phone
    FROM service_providers p
    JOIN users u
      ON u.user_id = p.user_id
    ORDER BY p.created_at DESC
  `;

  return rows;
};


/*
|--------------------------------------------------------------------------
| BLOCK / UNBLOCK USER
|--------------------------------------------------------------------------
*/

const setUserBlocked = async (userId, blocked) => {
  const rows = await db`
    UPDATE users
    SET is_active = ${!blocked}
    WHERE user_id = ${userId}
    RETURNING
      user_id,
      name,
      role,
      is_active
  `;

  return rows[0];
};
module.exports = {
  getStats,
  getUsers,
  getProviders,
  setUserBlocked,
};