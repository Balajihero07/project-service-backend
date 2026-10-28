require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });
  try {
    await client.connect();
    await client.query(fs.readFileSync(path.join(__dirname, '../../sql/schema.sql'), 'utf8'));
    console.log('Database schema created and starter services inserted.');
  } catch (err) {
    console.error('DB init failed:', err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();
