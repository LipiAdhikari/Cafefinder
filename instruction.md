Continue upgrading my Cafe Finder project. Read README.md, server/ and public/ first. Follow the same rules as before: plain JS unless I approve otherwise, keep the architecture (thin routes, storage only via server/storage.js, data only via server/services/places.js, scoring in server/ratings.js), ask before adding any dependency, never expose secrets in public/, escape all user text. Do ONE phase at a time, run and verify it, summarize in 5 lines or fewer, then wait for me to say "next".

## Phase 5: Accounts and real database

- Add sign-in (Google OAuth or email + password with hashed passwords; recommend one and explain why).
- Move storage to PostgreSQL (or MongoDB if you recommend it, explain why). Keep the same storage function names. Write a migration script that imports the old data/db.json.
- Tie reviews to user accounts: one review per user per cafe (editable), with a profile page showing their reviews.
- Add a .env.example listing every required variable.

## Phase 6: Trustworthy live data

- Verified check-ins: only accept busyness reports when the user's GPS is within ~150 m of the cafe. Explain how you handle GPS spoofing limits honestly.
- Store check-in history and show a "usual busyness by hour" chart per cafe.
- Real-time updates with Server-Sent Events so the busyness chip updates without a refresh.
- Add Google Places as a second provider in places.js (photos, hours, phone), merged with OSM, cached for 24h, key kept server-side. Show Google attribution as required.

## Phase 7: Smart features

- Natural language search: user types a sentence, the server uses the Claude API to turn it into filters (tags, minimum scores, open now, radius), and the existing search runs with them. Validate the AI output strictly before using it.
- AI review summary per cafe, cached and regenerated only when new reviews arrive.
- Build an MCP server (separate file, e.g. mcp/index.js) exposing search_cafes, get_cafe_details and add_review, reusing the same services.
- Personal "Cafe match %" that learns from the user's past ratings.

## Phase 8: Community and growth

- User photo uploads with size/type limits and a report button.
- Shareable lists ("Best rooftop cafes") with public links.
- Cafe owner claim flow and a simple dashboard (edit hours, reply to reviews).
- Badges for reviewers.

## Phase 9: Production quality

- Automated tests (API, ratings logic, validation) and a GitHub Actions workflow.
- Marker clustering, image optimization, lazy loading.
- English + Nepali language switcher.
- Error tracking, basic analytics, and deployment instructions for Render or Railway with a custom domain.

Definition of done for each phase: npm start works with no console errors, works on a 360px phone and 1280px desktop, old features still work, and the README is updated. Start with Phase 5.
