// Migration script: Imports existing data from data/db.json into PostgreSQL
// Run with: node server/scripts/migrate.js [optional-postgres-url]

const fs = require("fs");
const path = require("path");
const pg = require("pg");

const DATABASE_URL = process.argv[2] || process.env.DATABASE_URL;
const DB_FILE = path.join(__dirname, "..", "..", "data", "db.json");

if (!DATABASE_URL) {
  console.error("Error: Please provide DATABASE_URL as an environment variable or argument.");
  console.error("Usage: node server/scripts/migrate.js postgres://user:pass@localhost:5432/cafefinder");
  process.exit(1);
}

async function migrate() {
  console.log("Connecting to PostgreSQL...");
  const pool = new pg.Pool({
    connectionString: DATABASE_URL,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  });

  const client = await pool.connect();
  try {
    console.log("Creating database schema if not present...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(64) PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(100) NOT NULL,
        created_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS reviews (
        id VARCHAR(64) PRIMARY KEY,
        cafe_id VARCHAR(128) NOT NULL,
        cafe_name VARCHAR(120),
        user_id VARCHAR(64),
        device_id VARCHAR(64),
        user_name VARCHAR(100) NOT NULL,
        time BIGINT NOT NULL,
        ratings JSONB NOT NULL,
        tags JSONB NOT NULL DEFAULT '[]',
        comment TEXT,
        CONSTRAINT unique_user_cafe UNIQUE (cafe_id, user_id)
      );

      ALTER TABLE reviews ADD COLUMN IF NOT EXISTS cafe_name VARCHAR(120);

      CREATE TABLE IF NOT EXISTS checkins (
        id SERIAL PRIMARY KEY,
        cafe_id VARCHAR(128) NOT NULL,
        level VARCHAR(32) NOT NULL,
        time BIGINT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_reviews_cafe ON reviews(cafe_id);
      CREATE INDEX IF NOT EXISTS idx_reviews_user ON reviews(user_id);
      CREATE INDEX IF NOT EXISTS idx_checkins_cafe_time ON checkins(cafe_id, time);
    `);

    let dbData = { users: [], reviews: [], checkins: [] };
    if (fs.existsSync(DB_FILE)) {
      try {
        dbData = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
      } catch (err) {
        console.warn("Could not parse data/db.json, starting with empty data:", err.message);
      }
    }

    console.log(`Found in data/db.json: ${(dbData.users || []).length} users, ${(dbData.reviews || []).length} reviews, ${(dbData.checkins || []).length} checkins.`);

    // 1. Migrate Users
    let userCount = 0;
    for (const u of dbData.users || []) {
      await client.query(
        `INSERT INTO users (id, email, password_hash, name, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [u.id, u.email.toLowerCase(), u.passwordHash, u.name, u.createdAt || Date.now()]
      );
      userCount++;
    }

    // 2. Migrate Reviews
    let reviewCount = 0;
    for (const r of dbData.reviews || []) {
      await client.query(
        `INSERT INTO reviews (id, cafe_id, cafe_name, user_id, device_id, user_name, time, ratings, tags, comment)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO NOTHING`,
        [
          r.id,
          r.cafeId,
          r.cafeName || r.cafeId,
          r.userId || null,
          r.deviceId || null,
          r.user || "Anonymous",
          r.time || Date.now(),
          JSON.stringify(r.ratings || {}),
          JSON.stringify(r.tags || []),
          r.comment || "",
        ]
      );
      reviewCount++;
    }

    // 3. Migrate Checkins
    let checkinCount = 0;
    for (const c of dbData.checkins || []) {
      await client.query(
        `INSERT INTO checkins (cafe_id, level, time) VALUES ($1, $2, $3)`,
        [c.cafeId, c.level, c.time || Date.now()]
      );
      checkinCount++;
    }

    console.log(`Migration complete! Successfully migrated:`);
    console.log(`  - ${userCount} users`);
    console.log(`  - ${reviewCount} reviews`);
    console.log(`  - ${checkinCount} check-ins`);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
