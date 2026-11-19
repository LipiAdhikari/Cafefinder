// Place data provider: Supports OpenStreetMap (Overpass) and Google Places API.
// Keeps external keys strictly server-side and provides 24-hour response caching.

const PROVIDER = process.env.PLACES_PROVIDER || "osm";
const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY || "";

// In-memory cache for Overpass results (5-minute TTL to respect public Overpass API)
const CACHE_TTL_MS = 5 * 60 * 1000;
const placesCache = new Map();

// In-memory cache for Google Places data (24-hour TTL as required)
const GOOGLE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const googlePlacesCache = new Map();

// Map tracking all loaded cafes by ID for fast canonical coordinate lookup
const cafesById = new Map();

const SAMPLE = [
  {
    id: "sample:1",
    name: "Sample Lakeside Cafe",
    lat: 28.2096,
    lng: 83.9586,
    address: "Lakeside, Pokhara",
    openingHours: "07:00-21:00",
    source: "sample",
  },
  {
    id: "sample:2",
    name: "Sample Hill View Coffee",
    lat: 28.215,
    lng: 83.97,
    address: "Pokhara",
    openingHours: "08:00-20:00",
    source: "sample",
  },
];

// Initialize sample cafes in cache
SAMPLE.forEach((c) => cafesById.set(c.id, c));

function getCacheKey(lat, lng, radius) {
  // Round coordinates to 3 decimals (~100m grid) for better cache hit rates
  return `${Number(lat).toFixed(3)},${Number(lng).toFixed(3)},${Math.round(radius)}`;
}

function cleanExpiredCache() {
  const now = Date.now();
  for (const [key, entry] of placesCache.entries()) {
    if (now - entry.timestamp > CACHE_TTL_MS * 2) {
      placesCache.delete(key);
    }
  }
  for (const [key, entry] of googlePlacesCache.entries()) {
    if (now - entry.timestamp > GOOGLE_CACHE_TTL_MS * 2) {
      googlePlacesCache.delete(key);
    }
  }
}

// Search OpenStreetMap via Overpass API
async function searchOSM(lat, lng, radius) {
  const query = `[out:json][timeout:20];
    (node["amenity"="cafe"](around:${radius},${lat},${lng});
     way["amenity"="cafe"](around:${radius},${lat},${lng}););
    out center tags;`;
  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    body: "data=" + encodeURIComponent(query),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  if (!res.ok) throw new Error("Overpass error " + res.status);
  const json = await res.json();
  return json.elements
    .map((el) => {
      const t = el.tags || {};
      const clat = el.lat ?? el.center?.lat;
      const clng = el.lon ?? el.center?.lon;
      if (clat == null || clng == null) return null;
      return {
        id: `osm:${el.type}${el.id}`,
        name: t.name || "Unnamed cafe",
        lat: clat,
        lng: clng,
        address: [t["addr:street"], t["addr:city"]].filter(Boolean).join(", "),
        openingHours: t.opening_hours || "",
        source: "osm",
      };
    })
    .filter(Boolean);
}

// Fetch Google Places metadata for an OSM cafe (photos, hours, phone, rating)
// Cached for 24 hours per specification.
async function fetchGoogleDetailsForCafe(cafe) {
  if (!GOOGLE_PLACES_API_KEY) return null;

  const cacheKey = `gplace:${cafe.id}`;
  const now = Date.now();
  const cached = googlePlacesCache.get(cacheKey);
  if (cached && now - cached.timestamp < GOOGLE_CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(cafe.name)}&inputtype=textquery&locationbias=point:${cafe.lat},${cafe.lng}&fields=place_id,name,formatted_phone_number,opening_hours,photos,rating,user_ratings_total&key=${GOOGLE_PLACES_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Google Places error " + res.status);
    const json = await res.json();

    if (json.status !== "OK" || !json.candidates || !json.candidates.length) {
      googlePlacesCache.set(cacheKey, { timestamp: now, data: null });
      return null;
    }

    const cand = json.candidates[0];
    const photos = (cand.photos || []).slice(0, 5).map((p) => ({
      photoReference: p.photo_reference,
      url: `/api/places/photo?ref=${encodeURIComponent(p.photo_reference)}&maxwidth=800`,
      width: p.width,
      height: p.height,
      attribution: (p.html_attributions && p.html_attributions[0]) || null,
    }));

    const data = {
      placeId: cand.place_id,
      phone: cand.formatted_phone_number || null,
      rating: cand.rating || null,
      userRatingsTotal: cand.user_ratings_total || null,
      openingHours: cand.opening_hours?.weekday_text || null,
      isOpen: cand.opening_hours?.open_now ?? null,
      photos,
      attribution: "Data from Google Places",
    };

    googlePlacesCache.set(cacheKey, { timestamp: now, data });
    return data;
  } catch (err) {
    console.warn("Google Places lookup warning for " + cafe.name + ":", err.message);
    return null;
  }
}

// Google Places Nearby Search provider
async function searchGoogle(lat, lng, radius) {
  if (!GOOGLE_PLACES_API_KEY) {
    console.warn("GOOGLE_PLACES_API_KEY not configured, falling back to OpenStreetMap.");
    return searchOSM(lat, lng, radius);
  }

  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}&type=cafe&key=${GOOGLE_PLACES_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Google Places nearbysearch error " + res.status);
  const json = await res.json();
  if (json.status !== "OK" && json.status !== "ZERO_RESULTS") {
    throw new Error("Google Places error: " + (json.error_message || json.status));
  }

  return (json.results || []).map((p) => {
    const photos = (p.photos || []).slice(0, 5).map((ph) => ({
      photoReference: ph.photo_reference,
      url: `/api/places/photo?ref=${encodeURIComponent(ph.photo_reference)}&maxwidth=800`,
      width: ph.width,
      height: ph.height,
    }));

    return {
      id: `google:${p.place_id}`,
      name: p.name || "Unnamed Cafe",
      lat: p.geometry?.location?.lat,
      lng: p.geometry?.location?.lng,
      address: p.vicinity || "",
      openingHours: p.opening_hours?.open_now != null ? (p.opening_hours.open_now ? "Open now" : "Closed") : "",
      source: "google",
      google: {
        placeId: p.place_id,
        rating: p.rating,
        userRatingsTotal: p.user_ratings_total,
        photos,
        attribution: "Data from Google Places",
      },
    };
  });
}

// Server-side photo proxy: fetches photo from Google without exposing API key to client
async function fetchGooglePhoto(photoRef, maxWidth = 800) {
  if (!GOOGLE_PLACES_API_KEY) {
    throw new Error("Google Places API key is not configured.");
  }
  const url = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${maxWidth}&photoreference=${encodeURIComponent(photoRef)}&key=${GOOGLE_PLACES_API_KEY}`;
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error("Google Photo fetch failed with status " + res.status);
  const contentType = res.headers.get("content-type") || "image/jpeg";
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, contentType };
}

// Search nearby cafes merged with community and Google Places data
async function searchNearby(lat, lng, radius = 2000) {
  const cacheKey = getCacheKey(lat, lng, radius);
  const now = Date.now();

  const cached = placesCache.get(cacheKey);
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    cached.data.forEach((c) => cafesById.set(c.id, c));
    return cached.data;
  }

  try {
    let results;
    if (PROVIDER === "google") {
      results = await searchGoogle(lat, lng, radius);
    } else {
      results = await searchOSM(lat, lng, radius);
    }

    // If GOOGLE_PLACES_API_KEY is present and provider is OSM, merge Google Places details
    if (GOOGLE_PLACES_API_KEY && PROVIDER !== "google" && results.length) {
      results = await Promise.all(
        results.map(async (c) => {
          const gData = await fetchGoogleDetailsForCafe(c);
          if (gData) {
            return {
              ...c,
              google: gData,
              phone: gData.phone,
              address: c.address || "",
              openingHours: c.openingHours || (gData.openingHours ? gData.openingHours.join("; ") : ""),
            };
          }
          return c;
        })
      );
    }

    // Register all returned cafes in ID lookup cache
    results.forEach((c) => cafesById.set(c.id, c));

    placesCache.set(cacheKey, { timestamp: now, data: results });
    cleanExpiredCache();
    return results;
  } catch (err) {
    console.warn("Places lookup failed, using sample data:", err.message);
    if (cached && cached.data) {
      cached.data.forEach((c) => cafesById.set(c.id, c));
      return cached.data;
    }
    SAMPLE.forEach((c) => cafesById.set(c.id, c));
    return SAMPLE;
  }
}

// Canonical coordinate & metadata lookup for verified check-ins
async function getCafeById(id) {
  if (!id) return null;
  if (cafesById.has(id)) {
    return cafesById.get(id);
  }

  const sample = SAMPLE.find((s) => s.id === id);
  if (sample) return sample;

  if (id.startsWith("osm:")) {
    const raw = id.slice(4);
    const match = raw.match(/^(node|way|relation)(\d+)$/);
    if (match) {
      try {
        const type = match[1];
        const osmId = match[2];
        const query = `[out:json][timeout:10]; ${type}(${osmId}); out center tags;`;
        const res = await fetch("https://overpass-api.de/api/interpreter", {
          method: "POST",
          body: "data=" + encodeURIComponent(query),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });
        if (res.ok) {
          const json = await res.json();
          const el = json.elements?.[0];
          if (el) {
            const clat = el.lat ?? el.center?.lat;
            const clng = el.lon ?? el.center?.lon;
            const t = el.tags || {};
            const cafe = {
              id,
              name: t.name || "Unnamed cafe",
              lat: clat,
              lng: clng,
              address: [t["addr:street"], t["addr:city"]].filter(Boolean).join(", "),
              openingHours: t.opening_hours || "",
              source: "osm",
            };
            cafesById.set(id, cafe);
            return cafe;
          }
        }
      } catch (err) {
        console.warn("Single OSM place lookup failed:", err.message);
      }
    }
  }

  return null;
}

module.exports = {
  searchNearby,
  getCafeById,
  fetchGooglePhoto,
  fetchGoogleDetailsForCafe,
};
