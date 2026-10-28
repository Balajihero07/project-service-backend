# Project Service - Backend

Node.js 24 + Express + Neon serverless PostgreSQL REST API for the Project Service platform.

## 1. Prerequisites
- Node.js 24 (`node -v`)
- PostgreSQL 14+ (`psql --version`)
- Cloudinary account (free tier is fine) for image uploads
- Postman for testing

## 2. Setup
```bash
cd project-service-backend
npm install
cp .env.example .env        # then edit .env with your values
```

Create the database and tables:
```bash
psql -U postgres -c "CREATE DATABASE project_service;"
npm run db:init             # runs sql/schema.sql and inserts 6 starter services
npm run seed:admin          # creates the admin user from ADMIN_* in .env
```

Run:
```bash
npm run dev                 # nodemon, auto-restart
# or
npm start
```
Check: http://localhost:5000/api/health

## 3. Folder structure
```
sql/schema.sql              tables, constraints, indexes, triggers, starter data
src/
  server.js                 entry point (env check, DB check, listen)
  app.js                    middleware + route mounting
  config/                   db.js (Neon tagged-template SQL), cloudinary.js
  middleware/               auth (JWT + roles), validate, upload, errorHandler
  routes/                   auth, booking, location, user, provider, payment, ...
  controllers/              auth, booking, location, user, provider, payment, ...
  services/                 auth, booking, OTP, location
  scripts/                  initDb.js, seedAdmin.js
```

## 4. Booking flow and who does what
| Step | Endpoint | Role |
|---|---|---|
| Create a booking request | POST /api/bookings/userBookingLive or /api/bookings/userBookingDate | Customer |
| Poll pending requests | GET /api/bookings/provider/requests | Provider |
| Accept or reject request | POST /api/bookings/:id/accept or /api/bookings/:id/reject | Provider |
| Generate customer OTP | POST /api/bookings/:id/otp | Customer |
| Verify OTP and start | POST /api/bookings/:id/verify-otp | Assigned provider |
| Complete work | POST /api/bookings/:id/complete | Assigned provider |
| Pay / review | POST /api/payments / POST /api/reviews | Customer |

Customers select a service, not a provider. The backend creates provider-specific requests
for all eligible nearby providers; the first valid acceptance assigns the booking. OTP plaintext
is returned only by the customer-authorized OTP endpoint. The app does not currently have push
or WebSocket delivery, so providers poll the authenticated request endpoint.

See [BOOKING_WORKFLOW.md](./BOOKING_WORKFLOW.md) for request/response examples, environment
settings, migration steps, and the complete Postman test sequence.

## 4b. All endpoints
```
POST /api/auth/login | register | logout
POST /api/auth/send-otp | /api/auth/verify-otp
GET  /api/location/autocomplete?input=&sessionToken=   GET /api/location/details?placeId=&sessionToken=
GET  /api/users/profile      PUT /api/users/profile (multipart: profile_image)   DELETE /api/users/:id
GET  /api/services?q=&category=   GET /api/services/:id   POST/PUT/DELETE (admin)
GET  /api/providers?service_id=&lat=&lng=&radius=km   GET /api/providers/nearby?service_id=&lat=&lng=&radius_km=
GET  /api/providers/getservice_provider (legacy authenticated list)
POST /api/providers/nearby_service (provider JWT; updates availability and live coordinates)
PATCH /api/providers/location (provider JWT; updates own saved location)
GET  /api/providers/me   GET /api/providers/:id
POST /api/providers/register (provider JWT; multipart worker details and images)
POST /api/worker_registration/reg (existing user JWT; multipart worker details and images)
GET /api/worker_registration/me (authenticated user's account and worker profile)
PUT  /api/providers/:id (multipart: id_proof, live_photo)   PUT /api/providers/:id/verify (admin)
GET  /api/providers/:id/reviews
POST /api/bookings/userBookingLive   POST /api/bookings/userBookingDate   POST /api/bookings (Google Places)
GET /api/bookings   GET /api/bookings/:id   GET /api/bookings/provider/requests
POST /api/bookings/:id/accept | /reject   POST /api/bookings/:id/otp
POST /api/bookings/:id/verify-otp | /complete   PUT /api/bookings/:id/status
POST /api/payments   GET /api/payments   GET /api/payments/:id   PUT /api/payments/:id/status
POST /api/reviews
GET  /api/admin/stats | users | providers   PUT /api/admin/users/:id/block
```
Protected routes need the header `Authorization: Bearer <token>`.

Phone-and-password login request: `POST /api/auth/login` with
`{ "phone":"+15555550123", "password":"your-password" }`.
Include the country code in the phone number. A successful response contains the user and JWT.

## 5. Postman test order
Apply `sql/nearby_booking_workflow_migration.sql` to an existing database, create verified
providers and a customer, then follow the full test sequence and sample payloads in
[BOOKING_WORKFLOW.md](./BOOKING_WORKFLOW.md).

### Worker registration

An existing signed-in user can register as a worker with
`POST /api/worker_registration/reg`. Send a multipart form containing `service_id`,
`skill`,
`experience`, `state`, `district`, `area`, `address`, six-digit `pincode`,
`id_proof_name`, and image files named `id_proof`, `profile_photo`, and `live_photo`.
The endpoint uses the bearer token to identify the account, loads its existing
`name`, `email`, and `phone`, and does not accept a client-supplied user ID or identity.
On success, the account is promoted to `PROVIDER` and the response includes a refreshed
provider JWT. Images are stored in Cloudinary using the backend-only
`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` settings.
Images must be JPG, PNG, or WEBP and at most 5 MB. The provider profile is marked
`PENDING` for verification after each submission. Use
`GET /api/worker_registration/me` with the bearer token to fetch the user's account
and worker profile.

Apply [`sql/worker_registration_migration.sql`](./sql/worker_registration_migration.sql)
to an existing database before deploying this endpoint. Fresh databases created with
`npm run db:init` get these columns from `sql/schema.sql`.

## Location search (Google Places API New)

Add `GOOGLE_PLACES_API_KEY` to the backend `.env` only. Never put it in Expo app configuration or return it to clients. Enable Places API (New) for the Google Cloud project and restrict the key to the Places API and your server environment.

Apply [`sql/location_migration.sql`](./sql/location_migration.sql) to the Neon database before deploying the application changes. It adds the canonical user location fields and booking location snapshot columns; existing booking addresses are copied into `service_address` before it is made required.
It also adds `service_providers.location_updated_at`, defaults providers to offline,
turns off existing unverified providers or providers without coordinates, and backfills
`service_id` from the first saved skill when that skill exactly matches an active service.

The nearby booking workflow migration below also creates the active provider-minute booking index. Before applying it (or [`sql/booking_conflict_migration.sql`](./sql/booking_conflict_migration.sql)) to a database with existing bookings, resolve any active duplicates for the same provider and minute; otherwise PostgreSQL will reject index creation. New provider rows default to offline, and providers without saved coordinates are taken offline by the location migration.

Apply [`sql/nearby_booking_workflow_migration.sql`](./sql/nearby_booking_workflow_migration.sql) to an existing database before deploying the nearby request, acceptance, and OTP workflow.

Provider tracking uses foreground location permission and stops when the app is closed or the provider goes offline. Background updates are intentionally not enabled. To support background tracking later, configure Expo Location background mode/permissions for iOS and Android, request background permission in the app, and use Expo Location's background task API; rebuild the native app after changing those permissions.

All location routes require `Authorization: Bearer <JWT>`.

```http
GET /api/location/autocomplete?input=Chennai&sessionToken=550e8400-e29b-41d4-a716-446655440000
GET /api/location/details?placeId=ChIJYx...&sessionToken=550e8400-e29b-41d4-a716-446655440000
```

Autocomplete returns `{ "success": true, "message": "Location suggestions fetched.", "data": { "suggestions": [{ "placeId": "...", "description": "...", "mainText": "...", "secondaryText": "..." }] } }`. Details returns the validated place, its address components and canonical coordinates in `data`.

### Postman location test

1. Log in and set the collection's `Authorization` type to Bearer Token with the JWT.
2. Generate a UUID session token and use it for autocomplete. Try a Tamil Nadu locality such as `Chennai`.
3. Copy a returned `placeId` and request details with the same token. Confirm country is India, state is Tamil Nadu, and coordinates are returned.
4. Try a place outside Tamil Nadu. Details, registration, profile location updates, and booking creation should return HTTP 400 with `Please select a location within Tamil Nadu.`
5. Try a missing/short autocomplete input (400), an invalid place ID (400), and a disabled/misconfigured Places API (502). If the key is absent, the server reports a configuration error (500). Confirm errors use `{ "success": false, "message": "..." }`.
6. Register or create a booking using `google_place_id` and `sessionToken`. Supplying forged `latitude`, `longitude`, `city`, `district`, `state`, or address values does not change the stored location.

The existing provider discovery endpoint accepts `lat`, `lng`, and `radius` in kilometers, calculates Haversine distance, filters providers to that radius, and sorts nearest first. For example, set `radius=5` or `radius=10`.

### Troubleshooting and production security

- A missing backend key returns a configuration error; a rejected, disabled, or unreachable Places API returns `Unable to search locations.` or `Unable to get selected location.`. Check Places API (New) enablement, billing, key restrictions, and server network egress.
- If a selected place is rejected, confirm Google Details reports country `India`, state `Tamil Nadu`, and coordinates inside the coarse bounds `8.0–13.6° N`, `76.2–80.4° E`.
- Keep the Places key in the server `.env`/secret manager, restrict it to Places API (New), rotate it if exposed, and never include it in the Expo bundle or client responses.
- Keep location routes behind JWT authentication and retain the location request rate limit; use HTTPS and restrict CORS to deployed clients.

## 6. Response format
Success: `{ "success": true, "message": "...", "data": {} }`
Error:   `{ "success": false, "message": "..." }` (validation errors also include `errors[]`)

## 7. Before production
- Strong random `JWT_SECRET`, `NODE_ENV=production`, HTTPS, DB_SSL=true for hosted Postgres
- Payments here are recorded and confirmed manually; plug in a real gateway (webhook-verified) for live money
- OTP is returned in the API; to send by SMS add a provider such as Twilio/MSG91 in `bookingController.create`
- Add OTP attempt limits and a token refresh/blacklist flow if you need real logout
- Schedule `pg_dump` backups
