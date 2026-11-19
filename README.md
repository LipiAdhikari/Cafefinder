# ☕ Cafe Finder

A responsive, community-driven cafe finder that helps people **find the right cafe for what they need to do right now**. Real cafe locations on a map from OpenStreetMap (Overpass), enhanced with multi-dimensional ratings, vibe tags, purpose-driven filtering, and live busyness check-ins.

Default location is **Pokhara, Nepal** (Lakeside).

---

## 🚀 Quick Start

```bash
npm install
npm start          # Runs the server (default: http://localhost:3000)
npm run dev        # Auto-restarts on server changes (Node 18+)
```

Open `http://localhost:3000` (or `http://localhost:3001` if port 3000 is occupied).

---

## ✨ Features

### 📱 1. Responsive, Mobile-First Layout
- **Mobile Experience:** Full-screen interactive map with a smooth, draggable bottom sheet for the cafe list featuring 3 snap heights: `peek` (~74px), `half` (52vh), and `expanded` (88vh).
- **Desktop Experience:** Seamless side-by-side layout with a left sidebar and interactive map.
- **Side Panel & Bottom Sheet:** Replaces old popups with an animated bottom sheet on mobile and a docked sliding side panel on desktop.
- **Touch-Friendly:** All interactive controls (buttons, selects, inputs, tags) have at least a 44px tap target. Zero horizontal scrolling at any viewport width from 320px up.

### 🎨 2. Cozy Coffee-Shop Design & Theme
- **Artisan Palette:** Warm cream background (`#FAF6F0`), deep espresso text (`#2B1E16`), and terracotta accent (`#C85A32`).
- **Typography:** Modern Google Font *Plus Jakarta Sans* with clean system font fallback.
- **Dark Mode:** Automatically follows the system theme (`prefers-color-scheme: dark`) with dark roast surfaces and high-contrast text.
- **Custom Map Markers:** Color-coded by live busyness level:
  - 🟢 **Green:** Quiet
  - 🟡 **Yellow / Amber:** Moderate
  - 🔴 **Red:** Packed
  - ⚪ **Grey:** Busyness unknown
- **Dimension Progress Bars:** Community scores displayed as horizontal percentage bars in the detail view.
- **Tappable Cup Ratings:** Range sliders replaced with 5 interactive, tappable coffee cup (`☕`) icon inputs.
- **Skeleton Loaders & Friendly Empty States:** Shimmering card placeholders during loading, intuitive empty states with a "Reset filters" button, and network error recovery.

### 🎯 3. Smart Discovery & Utility
- **📍 Near Me Geolocation:** One-tap location finder that centers the map and adds a pulsing user marker (gracefully falls back to Pokhara if permission is denied).
- **🔍 Instant Name Search & Radius Selector:** Filter cafes instantly as you type; switch search radius between 1 km, 2.5 km, 5 km, and 10 km.
- **🕒 Open Now Filter & Parser:** Robust parser for OpenStreetMap `opening_hours` formats (24/7, daily ranges, weekday/weekend splits) with live Open/Closed badges.
- **🎯 Purpose Chips:** One-tap filtering for **Study**, **Work**, **Date**, **Group**, or **Outdoor** that weights and ranks cafes by relevant dimensions (e.g., Study prioritizes Wi-Fi, quietness, and outlets).
- **🗺️ Directions & Share:** Direct link to Google Maps directions (`google.com/maps/dir/?api=1&destination=lat,lng`) and Web Share API integration (with clipboard fallback).
- **❤️ Favorites & Saved Filter:** Save favorite cafes to `localStorage`; filter to saved cafes anytime.
- **✨ Personalized Match %:** Customize importance weights (1–5) for Coffee, Wi-Fi, Outlets, Quiet, Seating, and Price in "⚙️ Preferences" to see a personalized Match % on every cafe card.
- **⏱️ Live Busyness Recency:** Shows exactly how fresh reports are (e.g. *"3 reports, last 12 min ago"*).

### 🛡️ 4. Quality, Safety & PWA
- **Input Sanitization:** Strips HTML tags, script injection, and control characters on all review submissions.
- **Anti-Spam Rate Limiting:** In-memory sliding window rate limiter protects POST routes against abuse (max 25 POST requests per 10 minutes per IP).
- **One Review Per Device Per Day:** Anonymous `deviceId` tracking prevents spam by limiting reviews to 1 submission per device per cafe every 24 hours.
- **In-Memory Overpass Cache:** Places lookup results cached in memory for 5 minutes by rounded coordinates (~100m grid) to respect public OSM servers.
- **Accessibility (a11y):** Semantic HTML5, accessible form labels, visible `:focus-visible` outlines, WCAG AAA color contrast, ARIA landmarks, and keyboard shortcuts (`Escape` to close sheets/modals).
- **Progressive Web App (PWA):** Web App Manifest (`manifest.json`) and Service Worker (`sw.js`) caching the app shell for offline reliability and home screen installation.

### 👤 5. User Accounts & Real Database (Phase 5)
- **Account Authentication:** Fast, secure email + password registration and login with native `crypto.scrypt` salted hashing and HMAC-SHA256 stateless session tokens.
  > *Why Email + Password over Google OAuth?* Email + password operates completely self-contained with zero external cloud console configuration, client secrets, or network callback dependencies, working flawlessly offline and across local development.
- **Dual Storage Engine (PostgreSQL + JSON Fallback):**
  - **PostgreSQL:** When `DATABASE_URL` is configured, connects using connection pooling (`pg`) and automatically initializes schemas (`users`, `reviews`, `checkins`) with unique constraints (`UNIQUE(cafe_id, user_id)`).
  - **Zero-Config JSON Fallback:** If `DATABASE_URL` is not set or PostgreSQL is offline, seamlessly falls back to `data/db.json`.
- **Database Migration Tool:** Run `npm run migrate` (`node server/scripts/migrate.js`) to safely import legacy users, reviews, and check-ins from `data/db.json` into PostgreSQL with idempotent `ON CONFLICT DO NOTHING`.
- **Reviews Tied to Accounts:** Registered users have exactly one review per cafe. Submitting a new review automatically updates their existing review.
- **👤 User Profile & Review Management:**
  - View all cafes you have reviewed.
  - **✏️ Edit Review:** Instantly opens the cafe detail panel with your previous star ratings, tags, and comments pre-filled.
  - **🗑️ Delete Review:** Allows removing your review with instant score recalculation.
- **Anonymous Reviews Preserved:** Non-logged-in users can still submit community reviews (enforced at 1 review per device per cafe per day) with a prompt to sign in to edit anytime.

### 📡 6. Trustworthy Live Data & Real-Time Sync (Phase 6)
- **📍 Verified Check-ins (GPS Proximity $\le$ 150m):**
  - Check-in reports are verified against canonical cafe coordinates and only accepted if the user is within ~150 meters.
  - Device cooldown enforces a 15-minute interval per cafe per device to prevent report flooding.
- **🛡️ Honest GPS Spoofing Assessment & Defense:**
  > *How we handle GPS spoofing limits honestly:* In web browsers, GPS coordinates are reported by the client's OS/browser (`navigator.geolocation`). Any web client with Developer Tools or mock-location software can theoretically spoof coordinates. Without hardware attestation or carrier-level cell tower triangulation (which are inaccessible in standard web applications), 100% cryptographic proof of physical presence is impossible on the open web.
  >
  > *Our multi-layered mitigation strategy:*
  > 1. Strict server-side Haversine distance verification ($\le 150\text{m}$) against verified OSM/Google cafe coordinates.
  > 2. Device-level cooldowns (15 minutes per cafe) preventing spam.
  > 3. Sliding-window IP rate limiting on POST routes.
  > 4. Fresh client timestamps to reject replay attacks.
- **📊 Usual Busyness by Hour Chart:**
  - Check-in history is stored permanently.
  - Generates an hourly busyness breakdown (6 AM – 10 PM) rendered as a lightweight, responsive CSS bar chart with a live **"Now"** indicator marking the current hour.
- **⚡ Real-Time Updates (Server-Sent Events):**
  - Native Server-Sent Events stream (`/api/events`) with automatic heartbeat keep-alive.
  - Live check-ins push instantaneous updates to connected clients:
    - Cafe cards in the list update with a gentle pulse animation.
    - Map markers update their color (Quiet 🟢, Moderate 🟡, Packed 🔴) without reloading.
    - Active detail sheets update badge and recency text in real time.
- **🌐 Google Places as Second Provider:**
  - Secondary enrichment provider in `server/services/places.js` supporting photos, opening hours, phone numbers, and ratings merged with OSM data.
  - **24-Hour Server Cache:** All Google Places queries are cached for 24 hours to optimize performance and reduce API latency.
  - **Server-Side API Key Security:** `GOOGLE_PLACES_API_KEY` is never exposed to the client; photos are streamed securely via the server-side photo proxy (`/api/places/photo?ref=...`).
  - **Attribution:** Displays required "Data and photos from Google Places" attribution. Fallback to OpenStreetMap is 100% automatic if no Google API key is provided.

---

## 📁 Architecture

```
cafe-finder/
├── server/
│   ├── index.js              # Express routes, SSE stream, rate limiting, port fallback
│   ├── auth.js               # crypto.scrypt password hashing & HMAC session tokens
│   ├── ratings.js            # Dimensions, scoring, Haversine 150m check-in validation, hourly stats
│   ├── storage.js            # Dual storage: PostgreSQL pool + data/db.json fallback
│   ├── scripts/
│   │   └── migrate.js        # Migration script importing data/db.json into PostgreSQL
│   └── services/
│       └── places.js         # OSM Overpass + Google Places provider (24h cache, photo proxy)
├── public/
│   ├── index.html            # Semantic HTML5 app shell & accessible modals
│   ├── style.css             # CSS variables, hourly busyness chart, photo gallery, dark mode
│   ├── app.js                # Leaflet map, SSE listener, GPS check-ins, hourly chart, PWA
│   ├── manifest.json         # PWA Web App Manifest
│   ├── icon.svg              # Vector PWA icon
│   └── sw.js                 # Service worker (stale-while-revalidate app shell)
├── data/
│   └── db.json               # JSON storage for reviews and live check-ins
├── .env.example              # Documented environment variables
└── instruction.md            # Upgrade specifications
```

---

## 🔌 API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/meta` | Rating dimensions, tags, and busyness levels |
| `GET` | `/api/cafes?lat=&lng=&radius=` | Cafes near coordinates merged with community scores, busyness, and Google Places data |
| `GET` | `/api/cafes/:id/reviews` | Reviews list for a specific cafe |
| `POST` | `/api/cafes/:id/reviews` | Submit/update a review (`{ ratings, tags, user, comment, cafeName, deviceId }`) — ties to user if logged in |
| `POST` | `/api/cafes/:id/checkin` | Verified busyness check-in (`{ level, userLat, userLng }`) — Verified $\le$ 150m GPS distance |
| `GET` | `/api/cafes/:id/busyness-history` | Hourly busyness breakdown (6 AM – 10 PM) computed from check-in history |
| `GET` | `/api/events` | Real-time Server-Sent Events (SSE) stream for live busyness updates |
| `GET` | `/api/places/photo?ref=&maxwidth=` | Server-side Google Places photo proxy (caches 24h, keeps key secret) |
| `POST` | `/api/auth/register` | Register new user account (`{ name, email, password }`) |
| `POST` | `/api/auth/login` | Sign in with email and password (`{ email, password }`) |
| `GET` | `/api/auth/me` | Fetch authenticated user profile |
| `GET` | `/api/users/me/reviews` | Fetch all reviews authored by the authenticated user |
| `PUT` | `/api/reviews/:id` | Update an existing user review |
| `DELETE` | `/api/reviews/:id` | Delete an existing user review |

---

## ⚙️ Environment Variables

Copy `.env.example` to `.env` to configure optional server variables:
```bash
# Port to listen on (auto-escalates if occupied)
PORT=3000

# PostgreSQL connection string (leave unset to use data/db.json)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/cafefinder

# Session secret for token signing
SESSION_SECRET=your-secret-key-change-in-production

# Places provider: "osm" (default) or "google"
PLACES_PROVIDER=osm

# Google Places API Key (optional, enables photos, phone numbers, and Google hours)
GOOGLE_PLACES_API_KEY=your_google_places_api_key_here
```

---

## 🧪 Testing

1. **Start the app:** `npm start`
2. **Open browser:** `http://localhost:3000`
3. **Mobile view:** Open Developer Tools, set responsive mode to 360px width. Test bottom sheet dragging and tapping.
4. **Desktop view:** Expand browser to 1280px. Confirm sidebar list and map side by side with sliding side panel.
5. **Rate Limiting & Reviews:** Submit a rating on a cafe; try submitting a second rating on the same cafe to verify the 1-review-per-day enforcement.
