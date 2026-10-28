require('dotenv').config();

const { neon } = require('@neondatabase/serverless');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be configured.');
}

module.exports = neon(process.env.DATABASE_URL);
