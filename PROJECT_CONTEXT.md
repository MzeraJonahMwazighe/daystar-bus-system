---

# Daystar Bus Booking System — Project Context

Read this file FIRST, in full, before proposing or writing any code. It exists so a new
AI assistant session doesn't have to guess at architecture or repeat past mistakes.

## What this project is

A web-based bus booking system for Daystar University's shuttle route (Valley Road Campus
<-> Main Campus, via Syokimau). Students browse buses, pick a specific seat and boarding/
alighting stop, pay via M-Pesa (Safaricom Daraja API), and get a digital ticket. Built by
Jonah Mzera as a diploma project, deployed live on Render + MongoDB Atlas.

## Live deployment

- Live site: https://daystar-bus-system-dvd9.onrender.com
- Database: MongoDB Atlas (free tier)
- Hosting: Render (free tier)
- GitHub: MzeraJonahMwazighe/daystar-bus-system

## Architecture

Three tiers: static HTML/JS frontend (root-level .html files) -> Node/Express backend
(backend/) -> MongoDB via Mongoose (backend/models/).

### Data model (backend/models/)
- Bus: physical bus (plate, capacity, type)
- Route: a direction (from_location, to_location) with an embedded ordered `stops` array
  (name, order, zone: "valley_road_side" | "athi_river_side"). Each direction (nairobi->athi
  and athi->nairobi) is its OWN Route document with its OWN stop ordering reversed to match
  physical travel direction - order is direction-specific, not absolute.
- Trip: one scheduled run of a Bus on a Route, with a live `seats` array (seat_number,
  status: available/reserved/booked, booking_id, reserved_by, expires_at)
- Booking: one reservation (booking_id, bus, trip, seats as comma-string, boardingStop,
  alightingStop, destination [derived from alightingStop], total_amount, passenger_name,
  phone_number, status: reserved/booked/expired, checkout_request_id, mpesa_receipt_number)
- Ticket: created only after confirmed payment (ticket_id, booking_id, qr_data, status)

### Fare calculation (backend/lib/bookingHelpers.js)
`calculateZoneFare(boardingStop, alightingStop, route)` - ZONE-based, not distance-based.
Same zone = SAME_ZONE_FARE, different zone = CROSS_ZONE_FARE (currently set to test values
1/2 KES - MUST be restored to 150/200 before real/production use - check the constants and
their comment before assuming real pricing). Validates alighting stop's `order` comes AFTER
boarding stop's `order` on that specific Route document, rejecting reversed-direction
bookings. Throws on unknown stop names - callers must catch and return a clean 400.

### Established concurrency patterns - FOLLOW THESE, don't invent new ones
- Seat locking: atomic `Trip.findOneAndUpdate` with `$not: { $elemMatch: {...} }` filter -
  never a separate read-then-write for anything touching seat state.
- Payment claiming (backend/routes/mpesa.js): atomic `findOneAndUpdate` claims a booking
  with a 'PENDING' sentinel before calling Daraja, preventing double STK-push. Rolls back
  on failure.
- Payment confirmation (backend/lib/paymentHelpers.js confirmBookingPayment): idempotent -
  safe to call twice for the same booking (Daraja can send duplicate callbacks). Uses the
  atomic guarded-update-first pattern, not a read-then-decide pattern.
- Uniqueness constraints: MongoDB unique/partial-unique indexes + E11000 error handling in
  the route (see booking_id and phone_number handling in backend/routes/bookings.js) -
  this is the preferred pattern over application-level locking or transactions for this
  project, since it requires no new infrastructure and matches existing code.
- One active booking per phone number: enforced via a partial unique index on
  Booking.phone_number (only counts status IN ['reserved','booked']) - this was hard-won,
  verified with live concurrent testing on Render. Don't weaken or bypass it.

### Background jobs (backend/server.js)
Runs every 60s: releases expired ('reserved' + expires_at < now) seats back to available,
marks their Booking as 'expired' - both via atomic guarded updates, race-safe against
concurrent payment confirmation.

### API routes (backend/routes/)
- buses.js: GET /api/buses, GET /api/buses/:plate - includes routeId + sorted stops
- routes.js: GET /api/routes/:routeId/fare?boardingStop=X&alightingStop=Y - fare preview,
  no booking created
- bookings.js: full CRUD, the atomic seat-lock lives here
- mpesa.js: POST /api/mpesa/stk-push, POST /api/mpesa/callback - real Daraja sandbox
  integration, tested end-to-end
- admin.js, payments.js, ticket.js

### Known constraints / accepted limitations
- Free-tier hosting (Render + Atlas): under heavy concurrent load (~40 simultaneous
  requests), average response time degrades to ~6-8s. This was load-tested extensively. A
  custom request queue was tried and made things WORSE (12-30% success rate vs 100%) and
  was reverted - don't re-attempt a queue without discussing first.
- No student accounts/login yet (Phase 3, in progress/planned) - bookings are currently
  anonymous, identified only by phone number.

## Ground rules for AI assistants working on this project

1. Show real code/diffs/command output - never just a summary.
2. Plan and get explicit approval before writing non-trivial code, especially anything
   touching money, seats, authentication, or data integrity.
3. Stay scoped to explicitly named files.
4. NEVER commit or push without showing the diff first and getting explicit confirmation -
   this has been violated before and caused a real scare. Always wait for "go ahead."
5. Never run destructive DB operations without a narrowly scoped filter - never empty {}
   on Trip/Booking/Payment/Ticket.
6. Test claims with real evidence (real output, real DB state) - not "should work."
7. For concurrency or security-sensitive code, explicitly explain how it handles
   simultaneous operations / attack scenarios before implementation.
8. No hardcoded URLs/secrets - use environment variables.
9. If investigation leads somewhere unexpected, STOP and report rather than spawning many
   scratch files chasing a theory. Clean up or relocate to backend/scripts/ before finishing.

## Current phase / what's being worked on

Phase 3: student accounts via @daystar.ac.ke email + OTP verification, to support bus pass
holders (pre-paid, no per-trip M-Pesa payment needed) alongside the existing anonymous
M-Pesa flow, which stays fully functional for non-pass-holders. Security-sensitive - OTP
and session handling need real scrutiny, not shortcuts.

---
