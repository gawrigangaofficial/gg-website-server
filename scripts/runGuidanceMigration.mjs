import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pkg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const sqlPath = path.join(__dirname, '..', 'sql', 'create_product_guidance_requests.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');

const pool = new pkg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
});

try {
  await pool.query(sql);
  console.log('product_guidance_requests migration applied successfully.');
} catch (err) {
  console.error('Migration failed:', err.message);
  process.exit(1);
} finally {
  await pool.end();
}
