const express = require("express");
const path = require("path");
const crypto = require("crypto");

const places = require("./services/places");
const storage = require("./storage");
const ratings = require("./ratings");
const auth = require("./auth");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

// ==========================================
// Server-Sent Events (SSE) Real-Time Stream
// ==========================================
const sseClients = new Set();

app.get("/api/events", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });

  res.write("data: " + JSON.stringify({ type: "connected", time: Date.now() }) + "\n\n");
  sseClients.add(res);

  req.on("close", () => {
    sseClients.delete(res);
  });
});

function broadcastSSE(data) {
  const payload = "data: " + JSON.stringify(data) + "\n\n";
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

// Keep-alive ping every 30s to keep SSE connections open through proxies
setInterval(() => {
  for (const client of sseClients) {
    try {
      client.write(": keepalive\n\n");
    } catch {
      sseClients.delete(client);
    }
  }
}, 30000).unref();

// Simple in-memory rate limiting for POST routes (protects against spam without external dependencies)
// Approach: Tracks request timestamps per client IP. Limits clients to 20 POST requests per 10 minutes.
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const RATE_LIMIT_MAX_POSTS = 25;
const postRateLimits = new Map();

function postRateLimiter(req, res, next) {
  const ip = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || req.ip || "unknown";
  const now = Date.now();
  const timestamps = (postRateLimits.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);

  if (timestamps.length >= RATE_LIMIT_MAX_POSTS) {
    res.set("Retry-After", "60");
    return res.status(429).json({
      error: "Too many requests. Please slow down and try again shortly.",
    });
  }

  timestamps.push(now);
  postRateLimits.set(ip, timestamps);
  next();
}

// Periodic cleanup of stale rate-limit entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamps] of postRateLimits.entries()) {
    const valid = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    if (!valid.length) postRateLimits.delete(ip);
    else postRateLimits.set(ip, valid);
  }
}, RATE_LIMIT_WINDOW_MS).unref();

// Meta: lets the frontend build forms without hard-coding dimensions/tags.
app.get("/api/meta", (req, res) => {
  res.json({
    dimensions: ratings.DIMENSIONS,
    tags: ratings.TAGS,
    busyLevels: ratings.BUSY_LEVELS,
  });
});

// Cafes near a point, merged with community data.
app.get("/api/cafes", async (req, res) => {
  const lat = Number(req.query.lat ?? 28.2096);
  const lng = Number(req.query.lng ?? 83.9856);
  const radius = Math.min(Number(req.query.radius ?? 2000), 10000);
  const cafes = await places.searchNearby(lat, lng, radius);

  const enriched = await Promise.all(
    cafes.map(async (cafe) => {
      const reviews = await storage.getReviews(cafe.id);
      const checkins = await storage.getRecentCheckins(cafe.id, ratings.CHECKIN_WINDOW_MS);
      return {
        ...cafe,
        community: ratings.summarizeReviews(reviews),
        busyness: ratings.summarizeBusyness(checkins),
      };
    })
  );
  res.json(enriched);
});

// Reviews for one cafe.
app.get("/api/cafes/:id/reviews", async (req, res) => {
  const reviews = await storage.getReviews(req.params.id);
  res.json(reviews.sort((a, b) => b.time - a.time));
});

// ==========================================
// User Authentication Routes
// ==========================================
app.post("/api/auth/register", postRateLimiter, async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const name = ratings.sanitizeText(req.body.name || "Coffee Lover", 60) || "Coffee Lover";

  if (!email || !email.includes("@")) {
    return res.status(400).json({ error: "Please provide a valid email address." });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters long." });
  }

  try {
    const existing = await storage.getUserByEmail(email);
    if (existing) {
      return res.status(400).json({ error: "An account with this email already exists." });
    }

    const passwordHash = await auth.hashPassword(password);
    const user = {
      id: crypto.randomUUID(),
      email,
      passwordHash,
      name,
      createdAt: Date.now(),
    };
    await storage.createUser(user);

    const token = auth.generateToken(user);
    res.status(201).json({
      user: { id: user.id, email: user.email, name: user.name },
      token,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Registration failed." });
  }
});

app.post("/api/auth/login", postRateLimiter, async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  if (!email || !password) {
    return res.status(400).json({ error: "Please enter both email and password." });
  }

  const user = await storage.getUserByEmail(email);
  if (!user) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  const valid = await auth.verifyPassword(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  const token = auth.generateToken(user);
  res.json({
    user: { id: user.id, email: user.email, name: user.name },
    token,
  });
});

app.get("/api/auth/me", auth.optionalAuth, async (req, res) => {
  if (!req.user) return res.json({ user: null });
  const user = await storage.getUserById(req.user.id);
  if (!user) return res.json({ user: null });
  res.json({ user: { id: user.id, email: user.email, name: user.name } });
});

// Profile page: user reviews
app.get("/api/users/me/reviews", auth.requireAuth, async (req, res) => {
  const reviews = await storage.getUserReviews(req.user.id);
  res.json(reviews.sort((a, b) => b.time - a.time));
});

// Edit existing review
app.put("/api/reviews/:id", auth.requireAuth, postRateLimiter, async (req, res) => {
  const { error, value } = ratings.validateReview(req.body);
  if (error) return res.status(400).json({ error });

  const updated = await storage.updateReview(
    req.params.id,
    { ...value, user: req.user.name },
    req.user.id
  );
  if (!updated) return res.status(404).json({ error: "Review not found or unauthorized." });
  res.json(updated);
});

// Delete review
app.delete("/api/reviews/:id", auth.requireAuth, async (req, res) => {
  const success = await storage.deleteReview(req.params.id, req.user.id);
  if (!success) return res.status(404).json({ error: "Review not found or unauthorized." });
  res.json({ success: true });
});

// Add or edit a review (tied to user account if logged in; 1 review per user per cafe, editable).
app.post("/api/cafes/:id/reviews", auth.optionalAuth, postRateLimiter, async (req, res) => {
  const fallbackDeviceId = req.headers["x-device-id"] || "";
  const { error, value } = ratings.validateReview(req.body, fallbackDeviceId);
  if (error) return res.status(400).json({ error });

  // 1. If user is logged in: tie to account (1 review per user per cafe, editable)
  if (req.user) {
    const existing = await storage.getReviewByUserAndCafe(req.user.id, req.params.id);
    if (existing) {
      // Edit existing user review
      const updated = await storage.updateReview(
        existing.id,
        {
          ...value,
          cafeName: value.cafeName || existing.cafeName,
          user: req.user.name,
        },
        req.user.id
      );
      return res.json({ ...updated, isEdit: true });
    }

    const review = await storage.addReview({
      id: crypto.randomUUID(),
      cafeId: req.params.id,
      cafeName: value.cafeName || req.params.id,
      userId: req.user.id,
      time: Date.now(),
      ...value,
      user: req.user.name,
    });
    return res.status(201).json(review);
  }

  // 2. If anonymous: limit one review per device per cafe per day
  if (value.deviceId) {
    const alreadyReviewed = await storage.hasDeviceReviewedCafeRecently(
      req.params.id,
      value.deviceId,
      ratings.REVIEW_COOLDOWN_MS
    );
    if (alreadyReviewed) {
      return res.status(429).json({
        error: "You have already reviewed this cafe today. Sign in to edit your review anytime!",
      });
    }
  }

  const review = await storage.addReview({
    id: crypto.randomUUID(),
    cafeId: req.params.id,
    cafeName: value.cafeName || req.params.id,
    time: Date.now(),
    ...value,
  });
  res.status(201).json(review);
});

// Live busyness check-in: Verified GPS within ~150m of cafe
app.post("/api/cafes/:id/checkin", postRateLimiter, async (req, res) => {
  const cafeId = req.params.id;
  const fallbackDeviceId = req.headers["x-device-id"] || "";

  // 1. Check device cooldown (15 minutes per cafe per device)
  const deviceId = req.body?.deviceId || fallbackDeviceId;
  if (deviceId) {
    const isRecent = await storage.hasDeviceCheckedInRecently(cafeId, deviceId, ratings.CHECKIN_COOLDOWN_MS);
    if (isRecent) {
      return res.status(429).json({
        error: "You recently checked in at this cafe. Please wait a bit before reporting again.",
      });
    }
  }

  // 2. Lookup canonical cafe coordinates to verify user location
  let cafeCoords = await places.getCafeById(cafeId);
  if (!cafeCoords && req.body?.cafeLat != null && req.body?.cafeLng != null) {
    cafeCoords = { lat: Number(req.body.cafeLat), lng: Number(req.body.cafeLng) };
  }

  // 3. Verify GPS distance (<= 150m)
  const { error, value } = ratings.validateCheckin(req.body, cafeCoords, fallbackDeviceId);
  if (error) {
    return res.status(403).json({ error });
  }

  // 4. Save checkin
  const checkin = await storage.addCheckin({
    cafeId,
    level: value.level,
    time: Date.now(),
    deviceId: value.deviceId,
  });

  // 5. Recalculate live busyness summary
  const recentCheckins = await storage.getRecentCheckins(cafeId, ratings.CHECKIN_WINDOW_MS);
  const busyness = ratings.summarizeBusyness(recentCheckins);

  // 6. Broadcast real-time update via Server-Sent Events (SSE)
  broadcastSSE({
    type: "busyness_update",
    cafeId,
    busyness,
    timestamp: Date.now(),
  });

  res.status(201).json({
    success: true,
    checkin,
    busyness,
    distance: value.distance,
  });
});

// Hourly busyness history profile
app.get("/api/cafes/:id/busyness-history", async (req, res) => {
  const cafeId = req.params.id;
  const checkins = await storage.getAllCheckins(cafeId);
  const hourly = ratings.calculateHourlyBusyness(checkins);
  res.json({
    cafeId,
    totalReports: checkins.length,
    hourly,
  });
});

// Server-side photo proxy: streams Google Places photos without exposing API key
app.get("/api/places/photo", async (req, res) => {
  const photoRef = req.query.ref;
  const maxWidth = Math.min(Number(req.query.maxwidth || 800), 1600);
  if (!photoRef) {
    return res.status(400).json({ error: "Missing photo reference." });
  }
  try {
    const { buffer, contentType } = await places.fetchGooglePhoto(photoRef, maxWidth);
    res.set({
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400", // Cache in browser for 24 hours
    });
    res.send(buffer);
  } catch (err) {
    res.status(502).json({ error: "Failed to retrieve photo." });
  }
});

const DEFAULT_PORT = Number(process.env.PORT || 3000);

function startServer(port = DEFAULT_PORT, attempts = 0) {
  if (attempts >= 10) {
    console.error("Unable to find an open port after 10 attempts.");
    return;
  }
  const srv = app.listen(port, () => {
    console.log(`Cafe Finder running at http://localhost:${port}`);
  });
  srv.on("error", (err) => {
    if (err.code === "EADDRINUSE" || err.code === "EACCES") {
      console.warn(`Port ${port} unavailable, trying http://localhost:${port + 1}...`);
      startServer(port + 1, attempts + 1);
    } else {
      console.error("Server listen error:", err.message);
    }
  });
}

if (require.main === module) {
  startServer();
}

module.exports = app;
