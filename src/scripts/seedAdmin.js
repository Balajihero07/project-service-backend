require('dotenv').config();
const bcrypt = require('bcrypt');
const db = require('../config/db');

(async () => {
  try {
    const { ADMIN_NAME = 'Admin', ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_PHONE = '9999999999' } = process.env;
    if (!ADMIN_EMAIL || !ADMIN_PASSWORD) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD in .env');
    await db`
      INSERT INTO users (name, email, phone, password_hash, role)
      VALUES (
        ${ADMIN_NAME},
        LOWER(${ADMIN_EMAIL}),
        ${ADMIN_PHONE},
        ${await bcrypt.hash(ADMIN_PASSWORD, 10)},
        'ADMIN'
      )
      ON CONFLICT (email) DO NOTHING
    `;
    console.log(`Admin ready: ${ADMIN_EMAIL}`);
  } catch (err) {
    console.error('Seed failed:', err.message);
    process.exitCode = 1;
  }
})();
