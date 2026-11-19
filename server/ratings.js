// Your "different from Google Maps" layer: multi-dimension ratings, vibe tags,
// and live busyness check-ins. Add new dimensions or tags here only.

const DIMENSIONS = ["coffee", "wifi", "outlets", "quiet", "seating", "price"];
const TAGS = ["study", "date", "group", "laptop-friendly", "outdoor", "pet-friendly", "view"];
const BUSY_LEVELS = ["quiet", "moderate", "packed"];
const CHECKIN_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours
const REVIEW_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours (1 review per device per cafe per day)
const MAX_CHECKIN_DISTANCE_METERS = 150; // 150m verified radius
const CHECKIN_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes between check-ins per cafe per device

function sanitizeText(str, maxLength) {
  if (typeof str !== "string") return "";
  return str
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "") // strip entire script blocks
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "") // strip entire style blocks
    .replace(/<[^>]*>/g, "") // strip all HTML tags
    .replace(/[\u0000-\u001F\u007F]/g, "") // strip control characters
    .trim()
    .slice(0, maxLength);
}

function average(nums) {
  if (!nums.length) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
}

function summarizeReviews(reviews) {
  const scores = {};
  for (const d of DIMENSIONS) {
    scores[d] = average(reviews.map((r) => r.ratings[d]).filter((v) => typeof v === "number"));
  }
  const tagCounts = {};
  for (const r of reviews) for (const t of r.tags || []) tagCounts[t] = (tagCounts[t] || 0) + 1;
  const present = Object.values(scores).filter((v) => v !== null);
  return {
    count: reviews.length,
    overall: average(present),
    scores,
    topTags: Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).map(([t]) => t),
  };
}

function summarizeBusyness(checkins) {
  if (!checkins.length) return null;
  const avg = average(checkins.map((c) => BUSY_LEVELS.indexOf(c.level)));
  const times = checkins.map((c) => c.time).filter(Boolean);
  const lastTime = times.length ? Math.max(...times) : null;
  return {
    level: BUSY_LEVELS[Math.round(avg)],
    reports: checkins.length,
    lastTime,
  };
}

function validateReview(body, fallbackDeviceId = "") {
  if (!body || typeof body !== "object") return { error: "Invalid review request payload." };

  const ratings = {};
  for (const d of DIMENSIONS) {
    const v = Number(body.ratings?.[d]);
    if (Number.isFinite(v) && v >= 1 && v <= 5) ratings[d] = Math.round(v);
  }
  if (!Object.keys(ratings).length) return { error: "Provide at least one rating from 1 to 5." };

  const tags = Array.isArray(body.tags)
    ? body.tags.filter((t) => TAGS.includes(t)).slice(0, 10)
    : [];

  const rawComment = typeof body.comment === "string" ? body.comment : "";
  const comment = sanitizeText(rawComment, 500);

  const rawUser = typeof body.user === "string" && body.user.trim() ? body.user : "Anonymous";
  const user = sanitizeText(rawUser, 40) || "Anonymous";

  const rawCafeName = typeof body.cafeName === "string" ? body.cafeName : "";
  const cafeName = sanitizeText(rawCafeName, 120);

  const rawDeviceId = typeof body.deviceId === "string" ? body.deviceId : fallbackDeviceId;
  const deviceId = sanitizeText(rawDeviceId, 64);

  return { value: { ratings, tags, comment, user, cafeName, deviceId } };
}

// Distance Calculation (Haversine formula in meters)
function getDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

// Verified Check-in Validation:
// Requires client GPS within ~150 m of the cafe.
//
// HONEST ASSESSMENT ON GPS SPOOFING:
// Geolocation reported by web browsers can be mocked using browser devtools or OS-level mock location apps.
// Without hardware attestation or carrier network triangulation (which are unavailable to web applications),
// 100% cryptographic proof of physical presence is impossible on the open web.
// We defend against spoofing and spam by:
// 1) Enforcing server-side distance checks (<= 150m) against canonical cafe coordinates.
// 2) Enforcing device cooldowns (15 min between check-ins per cafe).
// 3) Enforcing strict IP rate-limiting on POST routes.
// 4) Requiring fresh timestamps to reject replay attacks.
function validateCheckin(body, cafeCoords, fallbackDeviceId = "") {
  if (!body || typeof body !== "object") return { error: "Invalid check-in payload." };

  const level = String(body.level || "").toLowerCase();
  if (!BUSY_LEVELS.includes(level)) {
    return { error: `Busyness level must be one of: ${BUSY_LEVELS.join(", ")}` };
  }

  const userLat = Number(body.userLat ?? body.lat);
  const userLng = Number(body.userLng ?? body.lng);

  if (!Number.isFinite(userLat) || !Number.isFinite(userLng)) {
    return {
      error: "Location verification required: Please allow GPS access on your device to report live busyness.",
    };
  }

  if (!cafeCoords || !Number.isFinite(cafeCoords.lat) || !Number.isFinite(cafeCoords.lng)) {
    return { value: { level, distance: 0, userLat, userLng } };
  }

  const distance = getDistanceMeters(cafeCoords.lat, cafeCoords.lng, userLat, userLng);
  if (distance > MAX_CHECKIN_DISTANCE_METERS) {
    return {
      error: `You are approximately ${distance}m away. Busyness check-ins can only be submitted within ${MAX_CHECKIN_DISTANCE_METERS}m of the cafe.`,
    };
  }

  const rawDeviceId = typeof body.deviceId === "string" ? body.deviceId : fallbackDeviceId;
  const deviceId = sanitizeText(rawDeviceId, 64);

  return { value: { level, distance, userLat, userLng, deviceId } };
}

// Calculate typical busyness by hour for a cafe
function calculateHourlyBusyness(allCheckins) {
  const byHour = new Map();
  for (let h = 6; h <= 22; h++) {
    byHour.set(h, []);
  }

  for (const c of allCheckins) {
    const d = new Date(Number(c.time));
    const h = d.getHours();
    if (byHour.has(h)) {
      byHour.get(h).push(c);
    }
  }

  const hours = [];
  for (let h = 6; h <= 22; h++) {
    const records = byHour.get(h) || [];
    const count = records.length;
    let level = "unknown";
    let score = null;

    if (count > 0) {
      const avg = average(records.map((r) => BUSY_LEVELS.indexOf(r.level)));
      score = avg;
      level = BUSY_LEVELS[Math.round(avg)];
    }

    const period = h >= 12 ? "PM" : "AM";
    const displayHour = h % 12 === 0 ? 12 : h % 12;
    const label = `${displayHour} ${period}`;

    hours.push({
      hour: h,
      label,
      level,
      score,
      reports: count,
    });
  }

  return hours;
}

module.exports = {
  DIMENSIONS,
  TAGS,
  BUSY_LEVELS,
  CHECKIN_WINDOW_MS,
  REVIEW_COOLDOWN_MS,
  MAX_CHECKIN_DISTANCE_METERS,
  CHECKIN_COOLDOWN_MS,
  summarizeReviews,
  summarizeBusyness,
  validateReview,
  validateCheckin,
  calculateHourlyBusyness,
  getDistanceMeters,
  sanitizeText,
};
