
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

async function checkDb() {
  try {
    const client = await pool.connect();
    const res = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    console.log("Tables in public schema:");
    res.rows.forEach(row => console.log(row.table_name));
    client.release();
  } catch (err) {
    console.error("Error connecting to DB:", err);
  } finally {
    await pool.end();
  }
}

checkDb();
