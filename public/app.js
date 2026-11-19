const DEFAULT_CENTER = [28.2096, 83.9856]; // Lakeside, Pokhara
let meta = null;
let cafes = [];
let markers = [];
let activeCafe = null;
let userLocation = null;
let userMarker = null;

// User state in localStorage
const STORAGE_KEYS = {
  FAVORITES: "cafe_finder_favorites",
  PREFERENCES: "cafe_finder_user_prefs",
};

// Filter and Purpose State
let currentPurpose = null;
let showOnlySaved = false;
let showOnlyOpenNow = false;
let searchQuery = "";
let currentSort = "distance";
let currentRadius = 2500;

// Purpose configurations (weights and tags)
const PURPOSE_CONFIG = {
  study: {
    weights: { wifi: 2.5, quiet: 2.5, outlets: 2.0, seating: 1.0 },
    tags: ["study", "laptop-friendly"],
  },
  work: {
    weights: { wifi: 2.5, outlets: 2.5, seating: 1.5, quiet: 1.0 },
    tags: ["laptop-friendly", "study"],
  },
  date: {
    weights: { coffee: 2.5, seating: 2.0, quiet: 1.5 },
    tags: ["date", "view"],
  },
  group: {
    weights: { seating: 2.5, coffee: 1.5, price: 1.5 },
    tags: ["group"],
  },
  outdoor: {
    weights: { seating: 1.5, coffee: 1.5 },
    tags: ["outdoor", "view", "pet-friendly"],
  },
};

// Leaflet map setup
const map = L.map("map", {
  zoomControl: false,
}).setView(DEFAULT_CENTER, 14);

L.control.zoom({ position: "topright" }).addTo(map);

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors",
  maxZoom: 19,
}).addTo(map);

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[c])
  );

// Anonymous Device ID Generator/Retriever
function getDeviceId() {
  let id = localStorage.getItem("cafe_device_id");
  if (!id) {
    id = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : "dev_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem("cafe_device_id", id);
  }
  return id;
}

// Track reviews submitted on this device to provide immediate UX feedback
function getDeviceReviewedCafes() {
  try {
    return JSON.parse(localStorage.getItem("cafe_reviewed_today")) || {};
  } catch {
    return {};
  }
}

function recordDeviceReview(cafeId) {
  const records = getDeviceReviewedCafes();
  records[cafeId] = Date.now();
  localStorage.setItem("cafe_reviewed_today", JSON.stringify(records));
}

function hasReviewedToday(cafeId) {
  const records = getDeviceReviewedCafes();
  const time = records[cafeId];
  if (!time) return false;
  return Date.now() - time < 24 * 60 * 60 * 1000;
}

const AUTH_TOKEN_KEY = "cafe_finder_auth_token";
let currentUser = null;

function getAuthToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

function setAuthToken(token) {
  if (token) localStorage.setItem(AUTH_TOKEN_KEY, token);
  else localStorage.removeItem(AUTH_TOKEN_KEY);
}

async function api(url, options = {}) {
  const token = getAuthToken();
  const headers = {
    "x-device-id": getDeviceId(),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };
  const res = await fetch(url, { ...options, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

let authMode = "login"; // "login" or "register"

function updateAuthUI() {
  const label = $("header-auth-label");
  const btn = $("btn-auth");
  if (!label || !btn) return;
  if (currentUser) {
    const firstName = (currentUser.name || "User").split(" ")[0];
    label.textContent = firstName;
    btn.setAttribute("aria-label", `Signed in as ${currentUser.name}. Open profile.`);
  } else {
    label.textContent = "Sign in";
    btn.setAttribute("aria-label", "Sign in or view profile");
  }
}

async function checkAuthSession() {
  const token = getAuthToken();
  if (!token) {
    currentUser = null;
    updateAuthUI();
    return;
  }
  try {
    const data = await api("/api/auth/me");
    currentUser = data.user;
  } catch {
    setAuthToken(null);
    currentUser = null;
  }
  updateAuthUI();
}

function openAuthModal(mode = "login") {
  setAuthTab(mode);
  const errEl = $("auth-error-msg");
  if (errEl) {
    errEl.style.display = "none";
    errEl.textContent = "";
  }
  const modal = $("auth-modal");
  if (modal) {
    modal.style.display = "flex";
    modal.setAttribute("aria-hidden", "false");
  }
  setTimeout(() => {
    const input = $("auth-email");
    if (input) input.focus();
  }, 100);
}

function closeAuthModal() {
  const modal = $("auth-modal");
  if (modal) {
    modal.style.display = "none";
    modal.setAttribute("aria-hidden", "true");
  }
}

function setAuthTab(mode) {
  authMode = mode;
  const isLogin = mode === "login";
  const tabLogin = $("tab-login");
  const tabRegister = $("tab-register");
  if (tabLogin) {
    tabLogin.classList.toggle("active", isLogin);
    tabLogin.setAttribute("aria-selected", String(isLogin));
  }
  if (tabRegister) {
    tabRegister.classList.toggle("active", !isLogin);
    tabRegister.setAttribute("aria-selected", String(!isLogin));
  }

  const title = $("auth-modal-title");
  if (title) title.textContent = isLogin ? "☕ Sign In" : "☕ Create Account";

  const nameGroup = $("auth-name-group");
  if (nameGroup) nameGroup.style.display = isLogin ? "none" : "flex";

  const submitBtn = $("btn-auth-submit");
  if (submitBtn) submitBtn.textContent = isLogin ? "Sign In" : "Create Account";

  const errEl = $("auth-error-msg");
  if (errEl) {
    errEl.style.display = "none";
    errEl.textContent = "";
  }
}

async function openProfileModal() {
  if (!currentUser) {
    openAuthModal();
    return;
  }
  const nameEl = $("profile-name");
  if (nameEl) nameEl.textContent = currentUser.name || "Coffee Lover";

  const emailEl = $("profile-email");
  if (emailEl) emailEl.textContent = currentUser.email || "";

  const listEl = $("profile-reviews-list");
  if (listEl) {
    listEl.innerHTML = `
      <div style="padding: 16px 0; text-align: center; color: var(--color-text-muted);">
        Loading your reviews…
      </div>
    `;
  }

  const modal = $("profile-modal");
  if (modal) {
    modal.style.display = "flex";
    modal.setAttribute("aria-hidden", "false");
  }

  try {
    const userReviews = await api("/api/users/me/reviews");
    const countEl = $("profile-reviews-count");
    if (countEl) countEl.textContent = userReviews.length;

    if (!listEl) return;

    if (!userReviews.length) {
      listEl.innerHTML = `
        <div class="empty-state" style="padding: 24px 12px">
          <div class="empty-state-icon">✍️</div>
          <h4>No reviews yet</h4>
          <p class="meta">You haven't reviewed any cafes yet. Find a cafe on the map and share your experience!</p>
        </div>
      `;
      return;
    }

    listEl.innerHTML = userReviews
      .map((r) => {
        const timeStr = formatTimeAgo(r.time) || new Date(r.time).toLocaleDateString();
        const scoreBadges = Object.entries(r.ratings || {})
          .map(([dim, val]) => `<span class="tag-chip" style="font-size:0.75rem">${esc(dim)}: ★${val}</span>`)
          .join(" ");
        const tagBadges = (r.tags || [])
          .map((t) => `<span class="badge" style="font-size:0.72rem">${esc(t)}</span>`)
          .join(" ");

        return `
          <div class="profile-review-card" id="user-review-${esc(r.id)}" data-cafe-id="${esc(r.cafeId)}">
            <div class="profile-review-header">
              <span class="profile-review-cafe-name">${esc(r.cafeName || r.cafeId)}</span>
              <span class="profile-review-date">${esc(timeStr)}</span>
            </div>
            ${scoreBadges ? `<div style="display:flex; flex-wrap:wrap; gap:4px; margin: 4px 0">${scoreBadges}</div>` : ""}
            ${tagBadges ? `<div style="display:flex; flex-wrap:wrap; gap:4px; margin-bottom: 4px">${tagBadges}</div>` : ""}
            ${r.comment ? `<p style="margin: 4px 0 8px; font-size: 0.88rem; color: var(--color-text); font-style: italic;">“${esc(r.comment)}”</p>` : ""}
            <div class="profile-review-actions">
              <button type="button" class="secondary btn-review-action btn-edit-user-review" data-cafe-id="${esc(r.cafeId)}" data-cafe-name="${esc(r.cafeName || '')}">
                ✏️ Edit Review
              </button>
              <button type="button" class="secondary btn-review-action btn-review-delete btn-delete-user-review" data-id="${esc(r.id)}" data-cafe-name="${esc(r.cafeName || r.cafeId)}">
                🗑️ Delete
              </button>
            </div>
          </div>
        `;
      })
      .join("");

    // Wire edit buttons
    listEl.querySelectorAll(".btn-edit-user-review").forEach((btn) => {
      btn.onclick = async () => {
        const cafeId = btn.dataset.cafeId;
        const cafeName = btn.dataset.cafeName;
        closeProfileModal();
        let targetCafe = cafes.find((c) => c.id === cafeId);
        if (!targetCafe) {
          targetCafe = {
            id: cafeId,
            name: cafeName || "Cafe",
            lat: DEFAULT_CENTER[0],
            lng: DEFAULT_CENTER[1],
            community: { overall: 0, count: 0, scores: {}, topTags: [] },
          };
        } else {
          map.setView([targetCafe.lat, targetCafe.lng], 16);
        }
        await openDetail(targetCafe);
        setTimeout(() => {
          const form = $("review-form");
          if (form) form.scrollIntoView({ behavior: "smooth" });
        }, 300);
      };
    });

    // Wire delete buttons
    listEl.querySelectorAll(".btn-delete-user-review").forEach((btn) => {
      btn.onclick = async () => {
        const reviewId = btn.dataset.id;
        const cafeName = btn.dataset.cafeName;
        if (!confirm(`Are you sure you want to delete your review for "${cafeName}"?`)) return;

        btn.disabled = true;
        try {
          await api(`/api/reviews/${encodeURIComponent(reviewId)}`, { method: "DELETE" });
          showToast("Review deleted.");
          await openProfileModal();
          await loadCafes();
          if (activeCafe && activeCafe.id === btn.closest(".profile-review-card")?.dataset.cafeId) {
            await openDetail(activeCafe);
          }
        } catch (err) {
          alert("Failed to delete review: " + err.message);
          btn.disabled = false;
        }
      };
    });
  } catch (err) {
    if (listEl) {
      listEl.innerHTML = `
        <div class="empty-state error-state" style="padding: 16px">
          <p class="meta" style="color: #721C24">Error loading reviews: ${esc(err.message)}</p>
        </div>
      `;
    }
  }
}

function closeProfileModal() {
  const modal = $("profile-modal");
  if (modal) {
    modal.style.display = "none";
    modal.setAttribute("aria-hidden", "true");
  }
}

// Toast Notifications
let toastTimer;
function showToast(message) {
  const toast = $("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.style.display = "none";
  }, 2800);
}

// Distance Calculation (Haversine Formula)
function getDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function formatDistance(km) {
  if (km == null || isNaN(km)) return "";
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

// Recency Helper
function formatTimeAgo(timestamp) {
  if (!timestamp) return null;
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `last ${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr === 1) return "last 1 hr ago";
  return `last ${diffHr} hrs ago`;
}

// Geolocation promise wrapper for verified check-in
function getCurrentCoordinates() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      return reject(new Error("Geolocation is not supported by your browser."));
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => {
        let msg = "Location access is required to verify that you are at this cafe.";
        if (err.code === err.PERMISSION_DENIED) {
          msg = "GPS permission denied. Please allow location access to submit a verified check-in.";
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          msg = "GPS position unavailable. Please ensure location services are enabled.";
        } else if (err.code === err.TIMEOUT) {
          msg = "Location request timed out. Please try again.";
        }
        reject(new Error(msg));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 }
    );
  });
}

// Generate HTML for Usual Busyness by Hour chart (Phase 6)
function renderHourlyChartHtml(historyData) {
  const currentHour = new Date().getHours();
  const hourly = historyData?.hourly || [];
  const totalReports = historyData?.totalReports || 0;

  const heightMap = {
    quiet: "32%",
    moderate: "65%",
    packed: "100%",
    unknown: "8px",
  };

  const barsHtml = hourly
    .map((h) => {
      const isCurrent = h.hour === currentHour;
      const height = heightMap[h.level] || "8px";
      const levelText =
        h.level === "unknown"
          ? "No reports"
          : `${h.level} (${h.reports} ${h.reports === 1 ? "report" : "reports"})`;

      return `
        <div class="hourly-col ${isCurrent ? "is-current" : ""}" title="${esc(h.label)}: ${esc(levelText)}">
          ${isCurrent ? '<span class="hourly-now-tag">Now</span>' : ""}
          <div class="hourly-bar ${esc(h.level)}" style="height: ${height}"></div>
          <span class="hourly-label">${esc(h.label.replace(" ", ""))}</span>
        </div>
      `;
    })
    .join("");

  return `
    <div class="hourly-busyness-section">
      <div class="hourly-busyness-header">
        <span class="hourly-busyness-title">📊 Usual Busyness by Hour</span>
        <small class="meta">${totalReports} check-in ${totalReports === 1 ? "record" : "records"}</small>
      </div>
      <div class="hourly-chart-wrapper">
        <div class="hourly-chart" role="img" aria-label="Usual busyness levels by hour">
          ${barsHtml}
        </div>
      </div>
      <div class="hourly-legend">
        <span class="hourly-legend-item"><span class="legend-dot quiet"></span> Quiet</span>
        <span class="hourly-legend-item"><span class="legend-dot moderate"></span> Moderate</span>
        <span class="hourly-legend-item"><span class="legend-dot packed"></span> Packed</span>
      </div>
    </div>
  `;
}

// Real-time Server-Sent Events (SSE) Listener (Phase 6)
function initEventSource() {
  if (!window.EventSource) return;
  try {
    const es = new EventSource("/api/events");

    es.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "busyness_update" && msg.cafeId) {
          onBusynessUpdated(msg.cafeId, msg.busyness);
        }
      } catch {}
    };

    es.onerror = () => {
      // Browser automatically retries with exponential backoff
    };
  } catch (err) {
    console.warn("SSE connection initialization error:", err.message);
  }
}

function onBusynessUpdated(cafeId, newBusyness) {
  const cafe = cafes.find((c) => c.id === cafeId);
  if (cafe) {
    cafe.busyness = newBusyness;
  }

  // 1. Update list card chip if visible
  const card = document.querySelector(`.cafe-card[data-id="${cafeId}"]`);
  if (card) {
    const chip = card.querySelector(".cafe-busyness-chip");
    if (chip) {
      const recency = formatTimeAgo(newBusyness.lastTime);
      const repCount = newBusyness.reports || 1;
      const recencyText = recency ? ` · ${repCount} ${repCount === 1 ? "report" : "reports"}, ${recency}` : "";
      chip.className = `badge cafe-busyness-chip busy-${esc(newBusyness.level)} pulse-update`;
      chip.textContent = `${newBusyness.level} now${recencyText}`;
    }
  }

  // 2. Update map marker icon color
  const marker = markers.find((m) => m._cafeId === cafeId);
  if (marker && cafe) {
    marker.setIcon(createCustomMarker(cafe));
  }

  // 3. Update active detail panel if open
  if (activeCafe && activeCafe.id === cafeId) {
    activeCafe.busyness = newBusyness;
    const detailChip = $("detail-busyness-badge");
    if (detailChip) {
      detailChip.className = `badge busy-${esc(newBusyness.level)} pulse-update`;
      detailChip.textContent = `${newBusyness.level} now`;
    }
    const recencyEl = $("detail-busyness-recency");
    if (recencyEl) {
      const recency = formatTimeAgo(newBusyness.lastTime);
      const repCount = newBusyness.reports || 1;
      recencyEl.textContent = `${repCount} ${repCount === 1 ? "report" : "reports"} in the last 2h${recency ? " (" + recency + ")" : ""}.`;
    }
    showToast(`Live busyness updated for ${cafe ? cafe.name : "cafe"}! 📡`);
  }
}

// Robust Open/Closed Status Parser from OSM opening_hours
const DAY_MAP = { mo: 1, tu: 2, we: 3, th: 4, fr: 5, sa: 6, su: 0 };
const DAY_NAMES = ["su", "mo", "tu", "we", "th", "fr", "sa"];

function checkOpenStatus(openingHoursStr) {
  if (!openingHoursStr) return null;
  const raw = openingHoursStr.trim();
  const lower = raw.toLowerCase();

  if (lower === "24/7") return { isOpen: true, text: "Open 24/7" };
  if (lower === "off" || lower === "closed") return { isOpen: false, text: "Closed" };

  try {
    const now = new Date();
    const currentDayIdx = now.getDay(); // 0 is Su, 1 is Mo...
    const currentDayName = DAY_NAMES[currentDayIdx];
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    // Split rules by semicolon
    const rules = raw.split(";").map((r) => r.trim()).filter(Boolean);
    let matchedToday = false;
    let isOpen = false;

    for (const rule of rules) {
      const ruleLower = rule.toLowerCase();
      if (ruleLower.includes("off") || ruleLower.includes("closed")) {
        // e.g. "Su off"
        if (ruleLower.includes(currentDayName)) {
          return { isOpen: false, text: "Closed today" };
        }
        continue;
      }

      // Check if day range matches
      let dayApplies = false;
      const dayMatch = ruleLower.match(/([a-z]{2})\s*-\s*([a-z]{2})/);
      if (dayMatch) {
        const startDay = DAY_MAP[dayMatch[1]];
        const endDay = DAY_MAP[dayMatch[2]];
        if (startDay != null && endDay != null) {
          if (startDay <= endDay) {
            dayApplies = currentDayIdx >= startDay && currentDayIdx <= endDay;
          } else {
            // Wraps around week e.g. Fr-Mo
            dayApplies = currentDayIdx >= startDay || currentDayIdx <= endDay;
          }
        }
      } else {
        // Check for single day mentions
        const hasDayMention = Object.keys(DAY_MAP).some((d) => ruleLower.includes(d));
        if (hasDayMention) {
          dayApplies = ruleLower.includes(currentDayName);
        } else {
          // No days specified -> applies daily
          dayApplies = true;
        }
      }

      if (dayApplies) {
        matchedToday = true;
        // Parse time range e.g. "07:00-21:00" or "07:00 - 21:00"
        const timeMatches = rule.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g);
        if (timeMatches) {
          for (const tm of timeMatches) {
            const parts = tm.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
            if (parts) {
              const startMin = parseInt(parts[1], 10) * 60 + parseInt(parts[2], 10);
              const endMin = parseInt(parts[3], 10) * 60 + parseInt(parts[4], 10);
              if (endMin > startMin) {
                if (currentMinutes >= startMin && currentMinutes < endMin) {
                  isOpen = true;
                  break;
                }
              } else {
                // Overnight e.g. 18:00 - 02:00
                if (currentMinutes >= startMin || currentMinutes < endMin) {
                  isOpen = true;
                  break;
                }
              }
            }
          }
        }
      }
    }

    if (matchedToday) {
      return { isOpen, text: isOpen ? "Open now" : "Closed" };
    }
  } catch {
    // If parsing fails, return raw string
  }

  return { isOpen: null, text: raw };
}

// Favorites Storage in localStorage
function getFavorites() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.FAVORITES)) || [];
  } catch {
    return [];
  }
}

function isFavorite(cafeId) {
  return getFavorites().includes(cafeId);
}

function toggleFavorite(cafeId) {
  let favs = getFavorites();
  const exists = favs.includes(cafeId);
  if (exists) {
    favs = favs.filter((id) => id !== cafeId);
    showToast("Removed from saved favorites");
  } else {
    favs.push(cafeId);
    showToast("Saved to your favorites ❤️");
  }
  localStorage.setItem(STORAGE_KEYS.FAVORITES, JSON.stringify(favs));
  updateFavoritesCount();
  render();
  if (activeCafe && activeCafe.id === cafeId) {
    updateDetailFavBtn(activeCafe.id);
  }
}

function updateFavoritesCount() {
  const count = getFavorites().length;
  const countEl = $("saved-count");
  if (countEl) countEl.textContent = count;
}

// User Preferences in localStorage
function getUserPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.PREFERENCES));
    if (saved && typeof saved === "object") return saved;
  } catch {
    // ignore
  }
  return {
    coffee: 4,
    wifi: 4,
    outlets: 3,
    quiet: 4,
    seating: 3,
    price: 3,
  };
}

function saveUserPreferences(prefs) {
  localStorage.setItem(STORAGE_KEYS.PREFERENCES, JSON.stringify(prefs));
  showToast("Preferences saved ✨");
  render();
}

// Calculate Match % for a Cafe
function calculateMatchPercentage(cafe) {
  const prefs = getUserPreferences();
  const scores = cafe.community.scores;
  let totalWeight = 0;
  let weightedScore = 0;

  for (const dim of meta?.dimensions || []) {
    const weight = prefs[dim] || 3;
    const score = scores[dim];
    totalWeight += weight * 5;
    if (typeof score === "number" && !isNaN(score)) {
      weightedScore += weight * score;
    } else {
      // Unrated dimension gets a neutral baseline (3.0 out of 5)
      weightedScore += weight * 3.0;
    }
  }

  if (totalWeight === 0) return 80;
  return Math.min(99, Math.max(50, Math.round((weightedScore / totalWeight) * 100)));
}

// Calculate Purpose Score for ranking
function calculatePurposeScore(cafe, purpose) {
  const config = PURPOSE_CONFIG[purpose];
  if (!config) return 0;

  let score = 0;
  const cafeScores = cafe.community.scores;

  for (const [dim, weight] of Object.entries(config.weights)) {
    const val = cafeScores[dim];
    if (typeof val === "number") {
      score += val * weight;
    } else {
      score += 2.5 * weight;
    }
  }

  // Bonus for matching tags
  const cafeTags = cafe.community.topTags || [];
  for (const tag of config.tags) {
    if (cafeTags.includes(tag)) {
      score += 3.0;
    }
  }

  return score;
}

// Custom Map Markers
function createCustomMarker(cafe) {
  const level = cafe.busyness?.level || "unknown";

  const html = `
    <div class="custom-marker marker-${level}" data-id="${esc(cafe.id)}" title="${esc(cafe.name)} (${level})">
      <svg class="marker-pin-svg" viewBox="0 0 36 44" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path class="pin-fill" d="M18 0C8.06 0 0 8.06 0 18C0 29.5 16 43 17.2 43.9C17.7 44.3 18.3 44.3 18.8 43.9C20 43 36 29.5 36 18C36 8.06 27.94 0 18 0Z" />
        <circle cx="18" cy="18" r="13" fill="#FFFFFF" fill-opacity="0.95" />
      </svg>
      <div class="marker-dot">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M20 3H4v10c0 2.21 1.79 4 4 4h6c2.21 0 4-1.79 4-4v-3h2c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 5h-2V5h2v3zM4 19h16v2H4z"/>
        </svg>
      </div>
    </div>
  `;

  return L.divIcon({
    className: "leaflet-div-marker",
    html: html,
    iconSize: [36, 44],
    iconAnchor: [18, 43],
    popupAnchor: [0, -40],
  });
}

// Bottom Sheet Drag Controller
function initBottomSheet() {
  const sheet = $("sidebar");
  const handle = $("list-sheet-handle");
  if (!sheet || !handle) return;

  let startY = 0;
  let startHeight = 0;
  let isDragging = false;
  let currentSnap = "half";

  function getSnapHeights() {
    const vh = window.innerHeight;
    return {
      collapsed: 74,
      half: Math.round(vh * 0.52),
      expanded: Math.round(vh * 0.88),
    };
  }

  function setSnap(snap) {
    if (window.innerWidth >= 768) {
      sheet.style.height = "";
      sheet.dataset.snap = "";
      return;
    }
    currentSnap = snap;
    const heights = getSnapHeights();
    sheet.classList.add("snapping");
    sheet.style.height = `${heights[snap]}px`;
    sheet.dataset.snap = snap;
    setTimeout(() => sheet.classList.remove("snapping"), 320);
  }

  handle.addEventListener("pointerdown", (e) => {
    if (window.innerWidth >= 768) return;
    isDragging = true;
    startY = e.clientY;
    startHeight = sheet.getBoundingClientRect().height;
    sheet.classList.remove("snapping");
    sheet.classList.add("dragging");
    handle.setPointerCapture(e.pointerId);
  });

  handle.addEventListener("pointermove", (e) => {
    if (!isDragging || window.innerWidth >= 768) return;
    const deltaY = e.clientY - startY;
    const newHeight = startHeight - deltaY;
    const heights = getSnapHeights();
    const clampedHeight = Math.max(heights.collapsed, Math.min(newHeight, heights.expanded + 20));
    sheet.style.height = `${clampedHeight}px`;
  });

  const finishDrag = () => {
    if (!isDragging) return;
    isDragging = false;
    sheet.classList.remove("dragging");
    if (window.innerWidth >= 768) return;

    const currentHeight = sheet.getBoundingClientRect().height;
    const heights = getSnapHeights();

    const snaps = ["collapsed", "half", "expanded"];
    let closestSnap = "half";
    let minDiff = Infinity;
    for (const snap of snaps) {
      const diff = Math.abs(currentHeight - heights[snap]);
      if (diff < minDiff) {
        minDiff = diff;
        closestSnap = snap;
      }
    }
    setSnap(closestSnap);
  };

  handle.addEventListener("pointerup", finishDrag);
  handle.addEventListener("pointercancel", finishDrag);

  handle.addEventListener("click", (e) => {
    if (window.innerWidth >= 768) return;
    if (Math.abs(e.clientY - startY) > 8) return;
    if (currentSnap === "collapsed") setSnap("half");
    else if (currentSnap === "half") setSnap("expanded");
    else setSnap("collapsed");
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth >= 768) {
      sheet.style.height = "";
    } else {
      setSnap(currentSnap);
    }
    map.invalidateSize();
  });

  if (window.innerWidth < 768) {
    setSnap("half");
  }
}

// Detail Panel Drag-Down-to-Dismiss on Mobile
function initDetailSheetDrag() {
  const panel = $("detail-panel");
  const handle = $("detail-sheet-handle");
  if (!panel || !handle) return;

  let startY = 0;
  let isDragging = false;

  handle.addEventListener("pointerdown", (e) => {
    if (window.innerWidth >= 768) return;
    isDragging = true;
    startY = e.clientY;
    panel.classList.remove("snapping");
    panel.classList.add("dragging");
    handle.setPointerCapture(e.pointerId);
  });

  handle.addEventListener("pointermove", (e) => {
    if (!isDragging || window.innerWidth >= 768) return;
    const deltaY = e.clientY - startY;
    if (deltaY > 0) {
      panel.style.transform = `translateY(${deltaY}px)`;
    }
  });

  const finishDetailDrag = () => {
    if (!isDragging) return;
    isDragging = false;
    panel.classList.remove("dragging");
    if (window.innerWidth >= 768) return;

    const deltaY = e.clientY - startY;
    if (deltaY > 100) {
      panel.style.transform = "";
      closeDetail();
    } else {
      panel.classList.add("snapping");
      panel.style.transform = "translateY(0)";
      setTimeout(() => {
        panel.classList.remove("snapping");
        panel.style.transform = "";
      }, 300);
    }
  };

  handle.addEventListener("pointerup", finishDetailDrag);
  handle.addEventListener("pointercancel", finishDetailDrag);
}

function openDetailPanel() {
  const panel = $("detail-panel");
  const backdrop = $("detail-backdrop");
  panel.classList.add("open");
  panel.setAttribute("aria-hidden", "false");
  backdrop.classList.add("visible");
  backdrop.setAttribute("aria-hidden", "false");
}

function closeDetail() {
  const panel = $("detail-panel");
  const backdrop = $("detail-backdrop");
  panel.classList.remove("open");
  panel.setAttribute("aria-hidden", "true");
  panel.style.transform = "";
  backdrop.classList.remove("visible");
  backdrop.setAttribute("aria-hidden", "true");
  activeCafe = null;

  document.querySelectorAll(".custom-marker.active").forEach((m) => m.classList.remove("active"));
  map.invalidateSize();
}

function updateDetailFavBtn(cafeId) {
  const btn = $("detail-fav-btn");
  if (!btn) return;
  const saved = isFavorite(cafeId);
  btn.classList.toggle("active", saved);
  btn.querySelector(".fav-icon").textContent = saved ? "❤️" : "🤍";
  btn.setAttribute("aria-label", saved ? "Remove from favorites" : "Save to favorites");
}

// Geolocation: "Near me" Handler
function handleNearMe() {
  if (!navigator.geolocation) {
    showToast("Geolocation is not supported by your browser");
    return;
  }

  showToast("Locating your position… 📍");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      userLocation = [lat, lng];

      // Add or update pulsing user marker
      if (!userMarker) {
        const userIcon = L.divIcon({
          className: "leaflet-div-marker",
          html: '<div class="user-location-marker" title="Your location"></div>',
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        });
        userMarker = L.marker([lat, lng], { icon: userIcon }).addTo(map);
      } else {
        userMarker.setLatLng([lat, lng]);
      }

      map.setView([lat, lng], 15);
      showToast("Found you! Showing cafes nearby ☕");
      loadCafes();
    },
    (err) => {
      console.warn("Geolocation denied or failed:", err.message);
      showToast("Location access denied. Centered on Lakeside, Pokhara.");
      userLocation = null;
    },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

// Web Share API Handler
async function handleShareCafe(cafe) {
  const shareData = {
    title: `${cafe.name} — Cafe Finder`,
    text: `Check out ${cafe.name} on Cafe Finder! ${cafe.address ? "(" + cafe.address + ")" : ""}`,
    url: window.location.href,
  };

  if (navigator.share) {
    try {
      await navigator.share(shareData);
      showToast("Shared successfully!");
    } catch {
      // User cancelled share
    }
  } else {
    // Clipboard fallback
    try {
      await navigator.clipboard.writeText(`${shareData.text} — ${shareData.url}`);
      showToast("Link and details copied to clipboard! 📋");
    } catch {
      showToast("Couldn't copy link");
    }
  }
}

// Preferences Modal
function openPreferencesModal() {
  const modal = $("preferences-modal");
  const list = $("pref-dimensions-list");
  const prefs = getUserPreferences();

  list.innerHTML = (meta?.dimensions || [])
    .map((dim) => {
      const val = prefs[dim] || 3;
      return `
        <div class="pref-dimension-row">
          <div class="pref-dimension-header">
            <span>${esc(dim)}</span>
            <span class="pref-slider-val" id="pref-val-${esc(dim)}">${val} / 5</span>
          </div>
          <div class="pref-slider-wrapper">
            <input
              type="range"
              min="1"
              max="5"
              value="${val}"
              id="pref-range-${esc(dim)}"
              data-dim="${esc(dim)}"
              aria-label="${esc(dim)} importance"
            />
          </div>
        </div>
      `;
    })
    .join("");

  // Live value update
  list.querySelectorAll("input[type='range']").forEach((slider) => {
    slider.addEventListener("input", () => {
      const dim = slider.dataset.dim;
      $(`pref-val-${dim}`).textContent = `${slider.value} / 5`;
    });
  });

  modal.style.display = "flex";
  modal.setAttribute("aria-hidden", "false");
}

function closePreferencesModal() {
  const modal = $("preferences-modal");
  modal.style.display = "none";
  modal.setAttribute("aria-hidden", "true");
}

// Skeletons
function renderSkeletons() {
  const list = $("list");
  $("sheet-count").textContent = "Loading…";
  let html = "";
  for (let i = 0; i < 4; i++) {
    html += `
      <div class="skeleton-card" aria-hidden="true">
        <div class="skeleton-header">
          <div class="skeleton-shimmer skeleton-title"></div>
          <div class="skeleton-shimmer skeleton-distance"></div>
        </div>
        <div class="skeleton-badges-row">
          <div class="skeleton-shimmer skeleton-badge"></div>
          <div class="skeleton-shimmer skeleton-badge"></div>
        </div>
        <div class="skeleton-shimmer skeleton-text"></div>
        <div class="skeleton-tags-row">
          <div class="skeleton-shimmer skeleton-tag"></div>
          <div class="skeleton-shimmer skeleton-tag"></div>
        </div>
      </div>
    `;
  }
  list.innerHTML = html;
}

async function loadCafes() {
  const c = userLocation ? { lat: userLocation[0], lng: userLocation[1] } : map.getCenter();
  renderSkeletons();
  try {
    cafes = await api(`/api/cafes?lat=${c.lat}&lng=${c.lng}&radius=${currentRadius}`);
    render();
  } catch (err) {
    $("sheet-count").textContent = "Offline";
    $("list").innerHTML = `
      <div class="empty-state error-state">
        <div class="empty-state-icon">⚠️</div>
        <h3>Unable to load cafes</h3>
        <p>${esc(err.message || "Please check your network connection.")}</p>
        <button type="button" class="secondary" id="btn-retry">Try again</button>
      </div>
    `;
    const btn = $("btn-retry");
    if (btn) btn.onclick = () => loadCafes();
  }
}

// Filter Matching Logic
function passesFilters(cafe) {
  // Search query filter
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    const nameMatch = cafe.name.toLowerCase().includes(q);
    const addressMatch = (cafe.address || "").toLowerCase().includes(q);
    if (!nameMatch && !addressMatch) return false;
  }

  // Saved / Favorites filter
  if (showOnlySaved && !isFavorite(cafe.id)) {
    return false;
  }

  // Open now filter
  if (showOnlyOpenNow) {
    const status = checkOpenStatus(cafe.openingHours);
    if (!status || status.isOpen !== true) return false;
  }

  // Tag filter
  const tag = $("filter-tag").value;
  const minWifi = Number($("filter-wifi").value);
  const minQuiet = Number($("filter-quiet").value);
  const s = cafe.community;

  if (tag && !s.topTags.includes(tag)) return false;
  if (minWifi && !(s.scores.wifi >= minWifi)) return false;
  if (minQuiet && !(s.scores.quiet >= minQuiet)) return false;

  return true;
}

function updateActiveFiltersBadge() {
  let count = 0;
  if ($("filter-tag").value) count++;
  if (Number($("filter-wifi").value) > 0) count++;
  if (Number($("filter-quiet").value) > 0) count++;
  if (currentSort !== "distance") count++;
  if (currentRadius !== 2500) count++;

  const badge = $("active-filters-count");
  if (badge) {
    if (count > 0) {
      badge.textContent = count;
      badge.style.display = "inline-flex";
    } else {
      badge.style.display = "none";
    }
  }
}

function render() {
  markers.forEach((m) => m.remove());
  markers = [];
  const refCenter = userLocation ? { lat: userLocation[0], lng: userLocation[1] } : map.getCenter();

  // Enrich visible cafes with distance and match %
  let visible = cafes.filter(passesFilters).map((cafe) => {
    const distKm = getDistanceKm(refCenter.lat, refCenter.lng, cafe.lat, cafe.lng);
    const matchPct = calculateMatchPercentage(cafe);
    const purposeScore = currentPurpose ? calculatePurposeScore(cafe, currentPurpose) : 0;
    return {
      ...cafe,
      _distKm: distKm,
      _matchPct: matchPct,
      _purposeScore: purposeScore,
    };
  });

  // Sorting
  if (currentPurpose) {
    // If purpose chip is active, rank by purpose score
    visible.sort((a, b) => b._purposeScore - a._purposeScore);
  } else if (currentSort === "distance") {
    visible.sort((a, b) => a._distKm - b._distKm);
  } else if (currentSort === "rating") {
    visible.sort((a, b) => (b.community.overall || 0) - (a.community.overall || 0));
  } else if (currentSort === "match") {
    visible.sort((a, b) => b._matchPct - a._matchPct);
  } else if (currentSort === "quiet") {
    const order = { quiet: 3, moderate: 2, packed: 1, unknown: 0 };
    visible.sort((a, b) => {
      const la = a.busyness?.level || "unknown";
      const lb = b.busyness?.level || "unknown";
      return (order[lb] || 0) - (order[la] || 0);
    });
  }

  $("sheet-count").textContent = `${visible.length} cafes`;
  updateActiveFiltersBadge();

  if (!visible.length) {
    let emptyMsg = "No cafes match your current filters. Try loosening filters or clearing search.";
    if (showOnlySaved) {
      emptyMsg = "You haven't saved any cafes yet. Tap the heart icon ❤️ on any cafe to save it for quick access!";
    }

    $("list").innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">☕</div>
        <h3>No quiet cafes nearby</h3>
        <p>${esc(emptyMsg)}</p>
        <button type="button" class="secondary" id="btn-reset-filters">Reset filters</button>
      </div>
    `;
    const resetBtn = $("btn-reset-filters");
    if (resetBtn) {
      resetBtn.onclick = () => {
        searchQuery = "";
        $("search-input").value = "";
        $("btn-clear-search").style.display = "none";
        showOnlySaved = false;
        $("btn-filter-saved").classList.remove("active");
        showOnlyOpenNow = false;
        $("btn-filter-opennow").classList.remove("active");
        currentPurpose = null;
        document.querySelectorAll(".purpose-chip").forEach((c) => c.classList.remove("active"));
        $("filter-tag").value = "";
        $("filter-wifi").value = "0";
        $("filter-quiet").value = "0";
        render();
      };
    }
    return;
  }

  $("list").innerHTML = "";

  for (const cafe of visible) {
    const marker = L.marker([cafe.lat, cafe.lng], {
      icon: createCustomMarker(cafe),
    }).addTo(map);
    marker._cafeId = cafe.id;

    marker.on("click", () => openDetail(cafe));
    markers.push(marker);

    const distText = formatDistance(cafe._distKm);
    const openStatus = checkOpenStatus(cafe.openingHours);

    let openBadge = "";
    if (openStatus) {
      if (openStatus.isOpen === true) {
        openBadge = `<span class="badge badge-open">● Open now</span>`;
      } else if (openStatus.isOpen === false) {
        openBadge = `<span class="badge badge-closed">Closed</span>`;
      } else if (openStatus.text) {
        openBadge = `<span class="badge">${esc(openStatus.text)}</span>`;
      }
    }

    // Busyness Chip with Recency Info ("3 reports, last 12 min ago")
    let busyChip = `<span class="badge cafe-busyness-chip busy-unknown">busyness unknown</span>`;
    if (cafe.busyness) {
      const recency = formatTimeAgo(cafe.busyness.lastTime);
      const reportsCount = cafe.busyness.reports || 1;
      const recencyText = recency ? ` · ${reportsCount} ${reportsCount === 1 ? "report" : "reports"}, ${recency}` : "";
      busyChip = `<span class="badge cafe-busyness-chip busy-${esc(cafe.busyness.level)}">${esc(cafe.busyness.level)} now${esc(recencyText)}</span>`;
    }

    const scoreBadge = cafe.community.overall
      ? `<span class="badge badge-score">★ ${cafe.community.overall} <small>(${cafe.community.count})</small></span>`
      : '<span class="badge">No ratings yet</span>';

    const matchBadge = `<span class="badge badge-match">✨ ${cafe._matchPct}% Match</span>`;

    const tagChips = cafe.community.topTags
      .slice(0, 3)
      .map((t) => `<span class="tag-chip">${esc(t)}</span>`)
      .join("");

    const saved = isFavorite(cafe.id);

    const el = document.createElement("div");
    el.className = "cafe-card";
    el.dataset.id = cafe.id;
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    el.setAttribute("aria-label", `View ${cafe.name}`);

    el.innerHTML = `
      <div class="cafe-card-header">
        <div class="cafe-card-title-group">
          <h3 class="cafe-card-title">${esc(cafe.name)}</h3>
        </div>
        <div class="cafe-card-actions">
          ${distText ? `<span class="cafe-distance">${esc(distText)}</span>` : ""}
          <button type="button" class="btn-card-fav ${saved ? "saved" : ""}" data-id="${esc(cafe.id)}" aria-label="${saved ? "Remove favorite" : "Save favorite"}">
            ${saved ? "❤️" : "🤍"}
          </button>
        </div>
      </div>
      <div class="cafe-card-badges">
        ${matchBadge}
        ${scoreBadge}
        ${openBadge}
      </div>
      <div class="cafe-card-badges">
        ${busyChip}
      </div>
      <div class="cafe-card-address">${esc(cafe.address || "Address unknown")}</div>
      ${tagChips ? `<div class="cafe-card-tags">${tagChips}</div>` : ""}
    `;

    // Favorite click inside card
    const favBtn = el.querySelector(".btn-card-fav");
    if (favBtn) {
      favBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleFavorite(cafe.id);
      });
    }

    const selectCafe = () => {
      map.setView([cafe.lat, cafe.lng], 16);
      openDetail(cafe);
    };

    el.addEventListener("click", selectCafe);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selectCafe();
      }
    });

    $("list").appendChild(el);
  }
}

// Generate Dimension Bars
function renderDimensionBars(communityScores) {
  return meta.dimensions
    .map((d) => {
      const val = communityScores[d];
      const hasScore = typeof val === "number" && !isNaN(val);
      const percentage = hasScore ? Math.min(100, Math.round((val / 5) * 100)) : 0;
      const scoreDisplay = hasScore ? `${val} ★` : "– (unrated)";

      return `
        <div class="dimension-bar-item">
          <div class="dimension-bar-header">
            <span class="dimension-name">${esc(d)}</span>
            <span class="dimension-value ${hasScore ? "" : "empty"}">${esc(scoreDisplay)}</span>
          </div>
          <div class="dimension-track">
            <div class="dimension-fill" style="width: ${percentage}%"></div>
          </div>
        </div>
      `;
    })
    .join("");
}

// Generate Interactive Star / Cup Rating Inputs (with optional initial values for editing)
function renderRatingInputs(initialRatings = {}) {
  const hasInit = Object.keys(initialRatings).length > 0;
  return meta.dimensions
    .map((d) => {
      const defaultVal = initialRatings[d] || 3;
      const isIncluded = hasInit ? initialRatings[d] != null : true;
      return `
        <div class="rate-dimension-card ${isIncluded ? "" : "disabled"}" id="rate-card-${esc(d)}" data-dimension="${esc(d)}">
          <div class="rate-dimension-top">
            <span class="rate-dimension-title">${esc(d)}</span>
            <label class="rate-toggle-label" title="Include ${esc(d)} in review">
              <input type="checkbox" name="use-${esc(d)}" ${isIncluded ? "checked" : ""} data-target="${esc(d)}" />
              <span>Include</span>
            </label>
          </div>
          <div class="star-rating-group" role="radiogroup" aria-label="Rate ${esc(d)} 1 to 5">
            <input type="hidden" name="r-${esc(d)}" id="input-${esc(d)}" value="${defaultVal}" />
            ${[1, 2, 3, 4, 5]
              .map(
                (num) =>
                  `<button type="button" class="cup-btn ${num <= defaultVal ? "active" : ""}" data-val="${num}" data-dim="${esc(d)}" aria-label="${num} of 5 cups">☕</button>`
              )
              .join("")}
            <span class="cup-score-label" id="label-${esc(d)}">${defaultVal} / 5</span>
          </div>
        </div>
      `;
    })
    .join("");
}

// Open Detail Panel
async function openDetail(cafe) {
  activeCafe = cafe;
  const content = $("detail-content");
  content.innerHTML = `
    <div style="padding: 24px 0">
      <div class="skeleton-shimmer" style="height: 28px; width: 60%; margin-bottom: 12px"></div>
      <div class="skeleton-shimmer" style="height: 16px; width: 40%; margin-bottom: 20px"></div>
      <div class="skeleton-shimmer" style="height: 140px; width: 100%; border-radius: 12px"></div>
    </div>
  `;
  openDetailPanel();
  updateDetailFavBtn(cafe.id);

  document.querySelectorAll(".custom-marker").forEach((m) => {
    m.classList.toggle("active", m.dataset.id === cafe.id);
  });

  try {
    const [reviews, historyData] = await Promise.all([
      api(`/api/cafes/${encodeURIComponent(cafe.id)}/reviews`),
      api(`/api/cafes/${encodeURIComponent(cafe.id)}/busyness-history`).catch(() => ({ totalReports: 0, hourly: [] })),
    ]);
    const s = cafe.community;

    const myReview = currentUser ? reviews.find((r) => r.userId === currentUser.id) : null;

    const dimensionBars = renderDimensionBars(s.scores);
    const ratingInputs = renderRatingInputs(myReview ? myReview.ratings : {});
    const matchPct = calculateMatchPercentage(cafe);
    const hourlyChartHtml = renderHourlyChartHtml(historyData);

    let photoGalleryHtml = "";
    if (cafe.google?.photos?.length) {
      photoGalleryHtml = `
        <div class="cafe-photo-gallery" role="region" aria-label="Cafe photos from Google Places">
          ${cafe.google.photos
            .map(
              (p) => `
                <div class="cafe-photo-item">
                  <img src="${esc(p.url)}" alt="Photo of ${esc(cafe.name)}" loading="lazy" />
                </div>
              `
            )
            .join("")}
        </div>
      `;
    }

    let phoneBtnHtml = "";
    if (cafe.phone) {
      phoneBtnHtml = `
        <a href="tel:${esc(cafe.phone)}" class="btn-action btn-phone">
          <span aria-hidden="true">📞</span> Call
        </a>
      `;
    }

    let googleAttributionHtml = "";
    if (cafe.google) {
      googleAttributionHtml = `
        <div class="google-attribution">
          <span aria-hidden="true">ℹ️</span> Data and photos enriched via Google Places · &copy; Google
        </div>
      `;
    }

    const tagBoxes = meta.tags
      .map((t) => {
        const isChecked = myReview?.tags?.includes(t) || false;
        return `<label class="tag-checkbox-pill ${isChecked ? "active" : ""}">
          <input type="checkbox" name="tag" value="${esc(t)}" ${isChecked ? "checked" : ""} /> ${esc(t)}
        </label>`;
      })
      .join("");

    const checkinBtns = meta.busyLevels
      .map(
        (l) =>
          `<button type="button" class="btn-checkin secondary" data-level="${esc(l)}">
            ${esc(l)}
          </button>`
      )
      .join("");

    const openStatus = checkOpenStatus(cafe.openingHours);
    let openBadge = "";
    if (openStatus) {
      if (openStatus.isOpen === true) {
        openBadge = `<span class="badge badge-open">● Open now</span>`;
      } else if (openStatus.isOpen === false) {
        openBadge = `<span class="badge badge-closed">Closed</span>`;
      } else if (openStatus.text) {
        openBadge = `<span class="badge">${esc(openStatus.text)}</span>`;
      }
    }

    const overallScoreBadge = s.overall
      ? `<span class="badge badge-score">★ ${s.overall} (${s.count} ${s.count === 1 ? "review" : "reviews"})</span>`
      : '<span class="badge">No reviews yet</span>';

    const matchBadge = `<span class="badge badge-match">✨ ${matchPct}% Match</span>`;

    // Recency display
    let busynessSubtext = "No check-ins reported in the last 2 hours.";
    let busyBadgeText = "Busyness unknown";
    let busyBadgeClass = "busy-unknown";
    if (cafe.busyness) {
      const recency = formatTimeAgo(cafe.busyness.lastTime);
      const repCount = cafe.busyness.reports || 1;
      busyBadgeClass = `busy-${esc(cafe.busyness.level)}`;
      busyBadgeText = `${esc(cafe.busyness.level)} now`;
      busynessSubtext = `${repCount} ${repCount === 1 ? "report" : "reports"} in the last 2h${recency ? " (" + recency + ")" : ""}.`;
    }

    // Google Maps and OSM directions links
    const gmapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${cafe.lat},${cafe.lng}`;

    const reviewList =
      reviews
        .slice(0, 5)
        .map(
          (r) =>
            `<div class="review-item">
              <span class="review-author">${esc(r.user || "Anonymous")}</span>
              <span class="review-comment">${esc(r.comment || "(No comment provided)")}</span>
            </div>`
        )
        .join("") || '<p class="meta" style="padding: 12px 0">No reviews yet. Be the first to rate this cafe!</p>';

    let rateSectionNotice = "";
    let rateSubmitText = "Submit Rating";
    let rateSubmitDisabled = false;
    let userFieldHtml = "";

    if (currentUser) {
      if (myReview) {
        rateSectionNotice = `
          <div class="already-reviewed-notice" role="status" style="border-left-color: var(--color-accent); background: rgba(56, 36, 23, 0.08);">
            <span aria-hidden="true">✏️</span> <b>Your Review:</b> You have rated this cafe. You can modify your scores or comment below anytime.
          </div>
        `;
        rateSubmitText = "Update My Review";
      } else {
        rateSectionNotice = `
          <p class="meta" style="margin: 4px 0 12px; font-size: 0.82rem;">
            Reviewing as <b>${esc(currentUser.name)}</b>. Your review will be saved to your profile.
          </p>
        `;
        rateSubmitText = "Submit Review";
      }
    } else {
      if (hasReviewedToday(cafe.id)) {
        rateSectionNotice = `
          <div class="already-reviewed-notice" role="status">
            ✅ You've already reviewed this cafe today. <button type="button" class="btn-text-link" id="link-auth-inline">Sign in</button> to edit your review anytime!
          </div>
        `;
        rateSubmitDisabled = true;
        rateSubmitText = "Already Reviewed Today";
      } else {
        rateSectionNotice = `
          <p class="anonymous-note" role="note">
            💡 <button type="button" class="btn-text-link" id="link-auth-inline">Sign in</button> to manage and edit your reviews anytime, or submit anonymously below (1 review/device/day).
          </p>
        `;
        userFieldHtml = `<input type="text" name="user" placeholder="Your name (optional)" aria-label="Your name" />`;
      }
    }

    content.innerHTML = `
      ${photoGalleryHtml}

      <div class="detail-header-section">
        <h2>${esc(cafe.name)}</h2>
        <div class="detail-meta">
          ${esc(cafe.address || "Address unknown")}${cafe.openingHours ? " · " + esc(cafe.openingHours) : ""}
        </div>
        <div class="detail-badges-row">
          ${matchBadge}
          ${overallScoreBadge}
          ${openBadge}
          <span id="detail-busyness-badge" class="badge ${busyBadgeClass}">${esc(busyBadgeText)}</span>
        </div>
      </div>

      <div class="detail-cta-bar">
        <a href="${gmapsUrl}" target="_blank" rel="noopener noreferrer" class="btn-action btn-directions">
          <span aria-hidden="true">🗺️</span> Directions
        </a>
        ${phoneBtnHtml}
        <button type="button" class="btn-action btn-share" id="btn-detail-share">
          <span aria-hidden="true">🔗</span> Share
        </button>
      </div>

      <h4>☕ Community Dimension Scores</h4>
      <div class="dimension-bars">${dimensionBars}</div>

      <h4>📍 Live Busyness Check-in</h4>
      <div class="checkin-section">
        <p id="detail-busyness-recency" class="checkin-recency">${esc(busynessSubtext)}</p>
        <div class="checkin-buttons">${checkinBtns}</div>
        ${hourlyChartHtml}
      </div>

      <h4>✍️ Rate this Cafe</h4>
      ${rateSectionNotice}
      <form id="review-form">
        <div class="rating-dimensions-container">${ratingInputs}</div>

        <p class="meta" style="margin: 16px 0 6px">Add vibe tags:</p>
        <div class="tags-container">${tagBoxes}</div>

        ${userFieldHtml}
        <textarea name="comment" rows="3" placeholder="Leave a helpful comment (optional)" aria-label="Comment">${esc(myReview?.comment || "")}</textarea>

        <div class="form-actions" style="margin-top: 14px;">
          <button type="submit" ${rateSubmitDisabled ? "disabled" : ""}>
            ${rateSubmitText}
          </button>
        </div>
      </form>

      <h4>💬 Recent Community Reviews</h4>
      <div class="reviews-list">${reviewList}</div>

      ${googleAttributionHtml}
    `;

    // Inline auth link inside notice
    const inlineAuthLink = content.querySelector("#link-auth-inline");
    if (inlineAuthLink) {
      inlineAuthLink.onclick = () => {
        openAuthModal("login");
      };
    }

    // Share button in detail view
    const shareBtn = $("btn-detail-share");
    if (shareBtn) {
      shareBtn.onclick = () => handleShareCafe(cafe);
    }

    // Interactive cup ratings
    content.querySelectorAll(".star-rating-group").forEach((group) => {
      const btns = group.querySelectorAll(".cup-btn");
      const hiddenInput = group.querySelector('input[type="hidden"]');
      const scoreLabel = group.querySelector(".cup-score-label");

      btns.forEach((btn) => {
        btn.addEventListener("click", () => {
          const val = Number(btn.dataset.val);
          hiddenInput.value = val;
          scoreLabel.textContent = `${val} / 5`;
          btns.forEach((b) => {
            const bVal = Number(b.dataset.val);
            b.classList.toggle("active", bVal <= val);
          });
        });

        btn.addEventListener("pointerenter", () => {
          const val = Number(btn.dataset.val);
          btns.forEach((b) => {
            const bVal = Number(b.dataset.val);
            b.style.color = bVal <= val ? "var(--color-accent-hover)" : "var(--color-border)";
          });
        });
      });

      group.addEventListener("pointerleave", () => {
        const curVal = Number(hiddenInput.value);
        btns.forEach((b) => {
          b.style.color = "";
          const bVal = Number(b.dataset.val);
          b.classList.toggle("active", bVal <= curVal);
        });
      });
    });

    // Dimension inclusion toggle
    content.querySelectorAll(".rate-toggle-label input").forEach((toggle) => {
      toggle.addEventListener("change", () => {
        const dim = toggle.dataset.target;
        const card = $(`rate-card-${dim}`);
        if (card) {
          card.classList.toggle("disabled", !toggle.checked);
        }
      });
    });

    // Verified Check-in Buttons (GPS Verified within ~150m)
    content.querySelectorAll("[data-level]").forEach((b) => {
      b.onclick = async () => {
        const originalText = b.textContent;
        b.disabled = true;
        b.textContent = "Verifying GPS… 📍";

        try {
          const coords = await getCurrentCoordinates();
          const res = await api(`/api/cafes/${encodeURIComponent(cafe.id)}/checkin`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              level: b.dataset.level,
              userLat: coords.lat,
              userLng: coords.lng,
              cafeLat: cafe.lat,
              cafeLng: cafe.lng,
              deviceId: getDeviceId(),
            }),
          });

          showToast(`Verified check-in! Reported ${b.dataset.level} busyness (${res.distance}m away). Thanks! 📍`);
          b.textContent = originalText;
          b.disabled = false;

          if (res.busyness) {
            cafe.busyness = res.busyness;
            onBusynessUpdated(cafe.id, res.busyness);
          }

          // Refresh the hourly chart in-place
          try {
            const updatedHistory = await api(`/api/cafes/${encodeURIComponent(cafe.id)}/busyness-history`);
            const chartSection = content.querySelector(".hourly-busyness-section");
            if (chartSection) {
              chartSection.outerHTML = renderHourlyChartHtml(updatedHistory);
            }
          } catch {}
        } catch (err) {
          showToast(err.message);
          b.textContent = originalText;
          b.disabled = false;
        }
      };
    });

    // Tag checkboxes toggle
    content.querySelectorAll(".tag-checkbox-pill input").forEach((input) => {
      input.addEventListener("change", () => {
        input.parentElement.classList.toggle("active", input.checked);
      });
    });

    // Review form submission
    const form = $("review-form");
    if (form) {
      form.onsubmit = async (e) => {
        e.preventDefault();
        const f = new FormData(form);
        const ratings = {};
        for (const d of meta.dimensions) {
          if (f.get(`use-${d}`)) {
            ratings[d] = Number(f.get(`r-${d}`));
          }
        }
        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.disabled = true;

        try {
          await api(`/api/cafes/${encodeURIComponent(cafe.id)}/reviews`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              cafeName: cafe.name,
              ratings,
              tags: f.getAll("tag"),
              user: currentUser ? currentUser.name : (f.get("user") || "Anonymous"),
              comment: f.get("comment"),
              deviceId: getDeviceId(),
            }),
          });
          recordDeviceReview(cafe.id);
          showToast(myReview ? "Review updated! ⭐" : "Review submitted successfully! ⭐");
          await openDetail(cafe);
          await loadCafes();
        } catch (err) {
          showToast(err.message);
          if (submitBtn) submitBtn.disabled = false;
        }
      };
    }
  } catch (err) {
    content.innerHTML = `
      <div class="empty-state error-state">
        <div class="empty-state-icon">⚠️</div>
        <h3>Failed to load details</h3>
        <p>${esc(err.message)}</p>
      </div>
    `;
  }
}

// App Initialization
async function init() {
  initBottomSheet();
  initDetailSheetDrag();
  updateFavoritesCount();

  await checkAuthSession();
  initEventSource();

  // Auth & Profile Header and Modal buttons
  $("btn-auth").onclick = () => {
    if (currentUser) openProfileModal();
    else openAuthModal("login");
  };
  $("btn-close-auth").onclick = closeAuthModal;
  $("btn-close-profile").onclick = closeProfileModal;
  $("tab-login").onclick = () => setAuthTab("login");
  $("tab-register").onclick = () => setAuthTab("register");
  $("btn-signout").onclick = () => {
    setAuthToken(null);
    currentUser = null;
    updateAuthUI();
    closeProfileModal();
    showToast("Signed out successfully.");
    if (activeCafe) openDetail(activeCafe);
    render();
  };

  // Auth Form Submission
  $("auth-form").onsubmit = async (e) => {
    e.preventDefault();
    const errorEl = $("auth-error-msg");
    errorEl.style.display = "none";
    const submitBtn = $("btn-auth-submit");
    submitBtn.disabled = true;

    const email = $("auth-email").value.trim();
    const password = $("auth-password").value;
    const name = $("auth-name").value.trim();

    try {
      let res;
      if (authMode === "login") {
        res = await api("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
      } else {
        res = await api("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email, password }),
        });
      }

      setAuthToken(res.token);
      currentUser = res.user;
      updateAuthUI();
      closeAuthModal();
      $("auth-form").reset();
      showToast(`Welcome, ${currentUser.name}! ☕`);
      if (activeCafe) await openDetail(activeCafe);
      render();
    } catch (err) {
      errorEl.textContent = err.message || "Authentication failed.";
      errorEl.style.display = "block";
    } finally {
      submitBtn.disabled = false;
    }
  };

  // Close modals on backdrop click
  $("auth-modal").addEventListener("click", (e) => {
    if (e.target === $("auth-modal")) closeAuthModal();
  });
  $("profile-modal").addEventListener("click", (e) => {
    if (e.target === $("profile-modal")) closeProfileModal();
  });

  // Detail panel buttons
  $("detail-close-btn").onclick = closeDetail;
  $("detail-back-btn").onclick = closeDetail;
  $("detail-backdrop").onclick = closeDetail;
  $("detail-fav-btn").onclick = () => {
    if (activeCafe) toggleFavorite(activeCafe.id);
  };
  $("detail-share-btn").onclick = () => {
    if (activeCafe) handleShareCafe(activeCafe);
  };

  // Header buttons
  $("btn-near-me").onclick = handleNearMe;
  $("btn-preferences").onclick = openPreferencesModal;
  $("btn-close-prefs").onclick = closePreferencesModal;
  $("btn-reset-prefs").onclick = () => {
    saveUserPreferences({ coffee: 4, wifi: 4, outlets: 3, quiet: 4, seating: 3, price: 3 });
    openPreferencesModal();
  };
  $("btn-save-prefs").onclick = () => {
    const prefs = {};
    for (const d of meta?.dimensions || []) {
      const slider = $(`pref-range-${d}`);
      if (slider) prefs[d] = Number(slider.value);
    }
    saveUserPreferences(prefs);
    closePreferencesModal();
  };

  // Purpose Chips Toolbar
  document.querySelectorAll(".purpose-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const purpose = chip.dataset.purpose;
      if (currentPurpose === purpose) {
        currentPurpose = null;
        chip.classList.remove("active");
      } else {
        document.querySelectorAll(".purpose-chip").forEach((c) => c.classList.remove("active"));
        currentPurpose = purpose;
        chip.classList.add("active");
        showToast(`Filtered for ${purpose.toUpperCase()} mode 🎯`);
      }
      render();
    });
  });

  // Search input
  const searchInput = $("search-input");
  const clearSearchBtn = $("btn-clear-search");
  searchInput.addEventListener("input", () => {
    searchQuery = searchInput.value.trim();
    clearSearchBtn.style.display = searchQuery ? "inline-flex" : "none";
    render();
  });
  clearSearchBtn.addEventListener("click", () => {
    searchInput.value = "";
    searchQuery = "";
    clearSearchBtn.style.display = "none";
    render();
    searchInput.focus();
  });

  // Quick Toggles: Saved & Open Now
  const savedToggleBtn = $("btn-filter-saved");
  savedToggleBtn.addEventListener("click", () => {
    showOnlySaved = !showOnlySaved;
    savedToggleBtn.classList.toggle("active", showOnlySaved);
    savedToggleBtn.setAttribute("aria-pressed", String(showOnlySaved));
    render();
  });

  const openNowToggleBtn = $("btn-filter-opennow");
  openNowToggleBtn.addEventListener("click", () => {
    showOnlyOpenNow = !showOnlyOpenNow;
    openNowToggleBtn.classList.toggle("active", showOnlyOpenNow);
    openNowToggleBtn.setAttribute("aria-pressed", String(showOnlyOpenNow));
    render();
  });

  // Expandable filters toggle
  const toggleFiltersBtn = $("btn-toggle-filters");
  const filtersSection = $("filters");
  toggleFiltersBtn.addEventListener("click", () => {
    const isOpen = filtersSection.style.display !== "none";
    filtersSection.style.display = isOpen ? "none" : "block";
    toggleFiltersBtn.classList.toggle("active", !isOpen);
    toggleFiltersBtn.setAttribute("aria-expanded", String(!isOpen));
  });

  // Sort & Radius selects
  $("sort-select").addEventListener("change", (e) => {
    currentSort = e.target.value;
    render();
  });

  $("radius-select").addEventListener("change", (e) => {
    currentRadius = Number(e.target.value);
    loadCafes();
  });

  // Keyboard Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if ($("auth-modal").style.display !== "none") {
        closeAuthModal();
      } else if ($("profile-modal").style.display !== "none") {
        closeProfileModal();
      } else if ($("preferences-modal").style.display !== "none") {
        closePreferencesModal();
      } else if ($("detail-panel").classList.contains("open")) {
        closeDetail();
      }
    }
  });

  // Load Meta & populate filter dropdowns
  meta = await api("/api/meta");
  for (const t of meta.tags) {
    $("filter-tag").insertAdjacentHTML(
      "beforeend",
      `<option value="${esc(t)}">${esc(t)}</option>`
    );
  }
  ["filter-tag", "filter-wifi", "filter-quiet"].forEach((id) =>
    $(id).addEventListener("change", render)
  );

  await loadCafes();
}

// Map pan reload (only if not searching specific text)
map.on("moveend", () => {
  if (!searchQuery && !showOnlySaved) {
    clearTimeout(window._t);
    window._t = setTimeout(loadCafes, 800);
  }
});

init();

// Register Service Worker for offline app shell PWA support
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        console.log("ServiceWorker registered with scope:", reg.scope);
      })
      .catch((err) => {
        console.warn("ServiceWorker registration failed:", err.message);
      });
  });
}
