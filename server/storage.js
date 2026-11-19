// Dual Storage Provider: PostgreSQL with fallback to JSON storage (data/db.json)
// Maintains all existing function signatures for seamless compatibility.

const fs = require("fs");
const path = require("path");
let pg = null;

try {
  pg = require("pg");
} catch {
  // pg not installed or optional
}

const FILE = path.join(__dirname, "..", "data", "db.json");
const DATABASE_URL = process.env.DATABASE_URL;

let pgPool = null;
let pgInitialized = false;

if (DATABASE_URL && pg) {
  try {
    pgPool = new pg.Pool({
      connectionString: DATABASE_URL,
      ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
      connectionTimeoutMillis: 5000,
    });

    pgPool.on("error", (err) => {
      console.warn("PostgreSQL Pool warning:", err.message);
    });
  } catch (err) {
    console.warn("Failed to create PostgreSQL pool, using JSON storage fallback:", err.message);
    pgPool = null;
  }
}

// Auto-initialize PostgreSQL tables if connected
async function initPgSchema() {
  if (!pgPool || pgInitialized) return;
  const client = await pgPool.connect();
  try {
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
        time BIGINT NOT NULL,
        device_id VARCHAR(64)
      );

      ALTER TABLE checkins ADD COLUMN IF NOT EXISTS device_id VARCHAR(64);

      CREATE INDEX IF NOT EXISTS idx_reviews_cafe ON reviews(cafe_id);
      CREATE INDEX IF NOT EXISTS idx_reviews_user ON reviews(user_id);
      CREATE INDEX IF NOT EXISTS idx_checkins_cafe_time ON checkins(cafe_id, time);
    `);
    pgInitialized = true;
    console.log("PostgreSQL schema verified and ready.");
  } catch (err) {
    console.warn("PostgreSQL schema initialization failed, falling back to JSON storage:", err.message);
    pgPool = null;
  } finally {
    client.release();
  }
}

// JSON file storage fallback
function loadJson() {
  try {
    const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (!data.users) data.users = [];
    if (!data.reviews) data.reviews = [];
    if (!data.checkins) data.checkins = [];
    return data;
  } catch {
    return { users: [], reviews: [], checkins: [] };
  }
}

function saveJson(db) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
}

// ==========================================
// User Account Storage
// ==========================================
async function createUser(user) {
  if (pgPool) {
    try {
      await initPgSchema();
      await pgPool.query(
        `INSERT INTO users (id, email, password_hash, name, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [user.id, user.email.toLowerCase(), user.passwordHash, user.name, user.createdAt || Date.now()]
      );
      return user;
    } catch (err) {
      if (err.code === "23505") throw new Error("Email already registered.");
      throw err;
    }
  }

  // JSON fallback
  const db = loadJson();
  if (db.users.some((u) => u.email.toLowerCase() === user.email.toLowerCase())) {
    throw new Error("Email already registered.");
  }
  db.users.push(user);
  saveJson(db);
  return user;
}

async function getUserByEmail(email) {
  if (!email) return null;
  if (pgPool) {
    try {
      await initPgSchema();
      const res = await pgPool.query("SELECT * FROM users WHERE email = $1 LIMIT 1", [email.toLowerCase()]);
      if (!res.rows.length) return null;
      const r = res.rows[0];
      return {
        id: r.id,
        email: r.email,
        passwordHash: r.password_hash,
        name: r.name,
        createdAt: Number(r.created_at),
      };
    } catch {
      // Fallback
    }
  }

  const db = loadJson();
  return db.users.find((u) => u.email.toLowerCase() === email.toLowerCase()) || null;
}

async function getUserById(id) {
  if (!id) return null;
  if (pgPool) {
    try {
      await initPgSchema();
      const res = await pgPool.query("SELECT * FROM users WHERE id = $1 LIMIT 1", [id]);
      if (!res.rows.length) return null;
      const r = res.rows[0];
      return {
        id: r.id,
        email: r.email,
        passwordHash: r.password_hash,
        name: r.name,
        createdAt: Number(r.created_at),
      };
    } catch {
      // Fallback
    }
  }

  const db = loadJson();
  return db.users.find((u) => u.id === id) || null;
}

// ==========================================
// Review Storage (Preserves existing signatures)
// ==========================================
async function addReview(review) {
  if (pgPool) {
    try {
      await initPgSchema();
      // Upsert: if user already reviewed cafe, update existing review
      await pgPool.query(
        `INSERT INTO reviews (id, cafe_id, cafe_name, user_id, device_id, user_name, time, ratings, tags, comment)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (cafe_id, user_id) DO UPDATE SET
           user_name = EXCLUDED.user_name,
           cafe_name = COALESCE(EXCLUDED.cafe_name, reviews.cafe_name),
           time = EXCLUDED.time,
           ratings = EXCLUDED.ratings,
           tags = EXCLUDED.tags,
           comment = EXCLUDED.comment`,
        [
          review.id,
          review.cafeId,
          review.cafeName || review.cafeId,
          review.userId || null,
          review.deviceId || null,
          review.user,
          review.time,
          JSON.stringify(review.ratings),
          JSON.stringify(review.tags || []),
          review.comment || "",
        ]
      );
      return review;
    } catch (err) {
      console.warn("Postgres addReview failed, saving to JSON:", err.message);
    }
  }

  const db = loadJson();
  // If registered user reviewed, update existing or push new
  if (review.userId) {
    const existingIdx = db.reviews.findIndex(
      (r) => r.cafeId === review.cafeId && r.userId === review.userId
    );
    if (existingIdx >= 0) {
      db.reviews[existingIdx] = { ...db.reviews[existingIdx], ...review };
      saveJson(db);
      return db.reviews[existingIdx];
    }
  }

  db.reviews.push(review);
  saveJson(db);
  return review;
}

async function updateReview(reviewId, updateData, userId = null) {
  if (pgPool) {
    try {
      await initPgSchema();
      const params = [
        updateData.user,
        JSON.stringify(updateData.ratings),
        JSON.stringify(updateData.tags || []),
        updateData.comment || "",
        Date.now(),
        reviewId,
      ];
      let query = `UPDATE reviews SET user_name = $1, ratings = $2, tags = $3, comment = $4, time = $5 WHERE id = $6`;
      if (userId) {
        query += ` AND user_id = $7`;
        params.push(userId);
      }
      query += ` RETURNING *`;
      const res = await pgPool.query(query, params);
      if (res.rows.length) {
        const r = res.rows[0];
        return {
          id: r.id,
          cafeId: r.cafe_id,
          cafeName: r.cafe_name || r.cafe_id,
          userId: r.user_id,
          deviceId: r.device_id,
          user: r.user_name,
          time: Number(r.time),
          ratings: r.ratings,
          tags: r.tags,
          comment: r.comment,
        };
      }
      return null;
    } catch {
      // Fallback
    }
  }

  const db = loadJson();
  const idx = db.reviews.findIndex((r) => r.id === reviewId && (!userId || r.userId === userId));
  if (idx >= 0) {
    db.reviews[idx] = {
      ...db.reviews[idx],
      ...updateData,
      time: Date.now(),
    };
    saveJson(db);
    return db.reviews[idx];
  }
  return null;
}

async function getReviews(cafeId) {
  if (pgPool) {
    try {
      await initPgSchema();
      const res = await pgPool.query(
        "SELECT * FROM reviews WHERE cafe_id = $1 ORDER BY time DESC",
        [cafeId]
      );
      return res.rows.map((r) => ({
        id: r.id,
        cafeId: r.cafe_id,
        cafeName: r.cafe_name || r.cafe_id,
        userId: r.user_id,
        deviceId: r.device_id,
        user: r.user_name,
        time: Number(r.time),
        ratings: r.ratings,
        tags: r.tags,
        comment: r.comment,
      }));
    } catch {
      // Fallback
    }
  }

  return loadJson().reviews.filter((r) => r.cafeId === cafeId);
}

async function getUserReviews(userId) {
  if (!userId) return [];
  if (pgPool) {
    try {
      await initPgSchema();
      const res = await pgPool.query(
        "SELECT * FROM reviews WHERE user_id = $1 ORDER BY time DESC",
        [userId]
      );
      return res.rows.map((r) => ({
        id: r.id,
        cafeId: r.cafe_id,
        cafeName: r.cafe_name || r.cafe_id,
        userId: r.user_id,
        deviceId: r.device_id,
        user: r.user_name,
        time: Number(r.time),
        ratings: r.ratings,
        tags: r.tags,
        comment: r.comment,
      }));
    } catch {
      // Fallback
    }
  }

  return loadJson().reviews.filter((r) => r.userId === userId);
}

async function getReviewByUserAndCafe(userId, cafeId) {
  if (!userId || !cafeId) return null;
  if (pgPool) {
    try {
      await initPgSchema();
      const res = await pgPool.query(
        "SELECT * FROM reviews WHERE user_id = $1 AND cafe_id = $2 LIMIT 1",
        [userId, cafeId]
      );
      if (!res.rows.length) return null;
      const r = res.rows[0];
      return {
        id: r.id,
        cafeId: r.cafe_id,
        cafeName: r.cafe_name || r.cafe_id,
        userId: r.user_id,
        deviceId: r.device_id,
        user: r.user_name,
        time: Number(r.time),
        ratings: r.ratings,
        tags: r.tags,
        comment: r.comment,
      };
    } catch {
      // Fallback
    }
  }

  return loadJson().reviews.find((r) => r.userId === userId && r.cafeId === cafeId) || null;
}

async function getAllReviews() {
  if (pgPool) {
    try {
      await initPgSchema();
      const res = await pgPool.query("SELECT * FROM reviews ORDER BY time DESC");
      return res.rows.map((r) => ({
        id: r.id,
        cafeId: r.cafe_id,
        cafeName: r.cafe_name || r.cafe_id,
        userId: r.user_id,
        deviceId: r.device_id,
        user: r.user_name,
        time: Number(r.time),
        ratings: r.ratings,
        tags: r.tags,
        comment: r.comment,
      }));
    } catch {
      // Fallback
    }
  }

  return loadJson().reviews;
}

async function deleteReview(reviewId, userId) {
  if (pgPool) {
    try {
      await initPgSchema();
      const res = await pgPool.query(
        "DELETE FROM reviews WHERE id = $1 AND user_id = $2 RETURNING id",
        [reviewId, userId]
      );
      return res.rowCount > 0;
    } catch {
      // Fallback
    }
  }

  const db = loadJson();
  const initialLen = db.reviews.length;
  db.reviews = db.reviews.filter((r) => !(r.id === reviewId && r.userId === userId));
  if (db.reviews.length !== initialLen) {
    saveJson(db);
    return true;
  }
  return false;
}

// ==========================================
// Live Busyness Checkin Storage
// ==========================================
async function addCheckin(checkin) {
  if (pgPool) {
    try {
      await initPgSchema();
      await pgPool.query(
        `INSERT INTO checkins (cafe_id, level, time, device_id) VALUES ($1, $2, $3, $4)`,
        [checkin.cafeId, checkin.level, checkin.time, checkin.deviceId || null]
      );
      return checkin;
    } catch {
      // Fallback
    }
  }

  const db = loadJson();
  db.checkins.push(checkin);
  saveJson(db);
  return checkin;
}

async function getRecentCheckins(cafeId, withinMs) {
  const cutoff = Date.now() - withinMs;
  if (pgPool) {
    try {
      await initPgSchema();
      const res = await pgPool.query(
        "SELECT * FROM checkins WHERE cafe_id = $1 AND time >= $2 ORDER BY time DESC",
        [cafeId, cutoff]
      );
      return res.rows.map((r) => ({
        cafeId: r.cafe_id,
        level: r.level,
        time: Number(r.time),
        deviceId: r.device_id,
      }));
    } catch {
      // Fallback
    }
  }

  return loadJson().checkins.filter((c) => c.cafeId === cafeId && c.time >= cutoff);
}

async function getAllCheckins(cafeId) {
  if (pgPool) {
    try {
      await initPgSchema();
      const res = await pgPool.query(
        "SELECT * FROM checkins WHERE cafe_id = $1 ORDER BY time DESC",
        [cafeId]
      );
      return res.rows.map((r) => ({
        cafeId: r.cafe_id,
        level: r.level,
        time: Number(r.time),
        deviceId: r.device_id,
      }));
    } catch {
      // Fallback
    }
  }

  return loadJson()
    .checkins.filter((c) => c.cafeId === cafeId)
    .sort((a, b) => b.time - a.time);
}

async function hasDeviceCheckedInRecently(cafeId, deviceId, withinMs = 15 * 60 * 1000) {
  if (!deviceId) return false;
  const cutoff = Date.now() - withinMs;

  if (pgPool) {
    try {
      await initPgSchema();
      const res = await pgPool.query(
        "SELECT 1 FROM checkins WHERE cafe_id = $1 AND device_id = $2 AND time >= $3 LIMIT 1",
        [cafeId, deviceId, cutoff]
      );
      return res.rows.length > 0;
    } catch {
      // Fallback
    }
  }

  const db = loadJson();
  return db.checkins.some((c) => c.cafeId === cafeId && c.deviceId === deviceId && c.time >= cutoff);
}

async function hasDeviceReviewedCafeRecently(cafeId, deviceId, withinMs = 24 * 60 * 60 * 1000) {
  if (!deviceId) return false;
  const cutoff = Date.now() - withinMs;

  if (pgPool) {
    try {
      await initPgSchema();
      const res = await pgPool.query(
        "SELECT 1 FROM reviews WHERE cafe_id = $1 AND device_id = $2 AND time >= $3 LIMIT 1",
        [cafeId, deviceId, cutoff]
      );
      return res.rows.length > 0;
    } catch {
      // Fallback
    }
  }

  const db = loadJson();
  return db.reviews.some((r) => r.cafeId === cafeId && r.deviceId === deviceId && r.time >= cutoff);
}

module.exports = {
  addReview,
  updateReview,
  getReviews,
  getAllReviews,
  getUserReviews,
  getReviewByUserAndCafe,
  deleteReview,
  addCheckin,
  getRecentCheckins,
  getAllCheckins,
  hasDeviceCheckedInRecently,
  hasDeviceReviewedCafeRecently,
  createUser,
  getUserByEmail,
  getUserById,
  initPgSchema,
};
