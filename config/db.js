require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false },
  // Shared pooler PREPARE ni qo‘llab-quvvatlamaydi, shuning uchun tayyor holatda ishlatamiz
});

module.exports = pool;
