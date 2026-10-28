# Nearby booking workflow

## Database setup

Back up the database, then apply the additive migration to an existing database:

```powershell
psql -v ON_ERROR_STOP=1 "$env:DATABASE_URL" -f .\sql\nearby_booking_workflow_migration.sql
```

For a new database, `npm run db:init` uses `sql/schema.sql`, which includes the same booking-request and OTP fields. The migration makes `bookings.provider_id` nullable so a booking can exist before a provider accepts it; existing plaintext OTP values are cleared. It creates `booking_provider_requests` with a unique booking/provider pair and expiry timestamps, plus the active provider-minute unique index used to prevent two simultaneous bookings for one provider.
Before applying the migration, resolve any existing duplicate active provider/minute bookings; the migration fails rather than deleting or changing those bookings.

Set these values in `.env` (the example values are not production secrets):

| Variable | Default | Purpose |
|---|---:|---|
| `PROVIDER_SEARCH_RADIUS_KM` | `10` | Nearby search radius |
| `PROVIDER_LOCATION_MAX_AGE_MINUTES` | `30` | Maximum age of a provider location |
| `PROVIDER_REQUEST_EXPIRY_MINUTES` | `30` | Time a provider request remains open |
| `OTP_EXPIRE_MINUTES` | `10` (`.env.example` sets `5`) | OTP lifetime |
| `OTP_RESEND_SECONDS` | `30` | Minimum time between customer OTP generations |
| `OTP_MAX_ATTEMPTS` | `5` | Attempts allowed per generated OTP |
| `OTP_HASH_SECRET` | falls back to `JWT_SECRET` | Secret key used to HMAC the stored OTP |

Use a unique, high-entropy `OTP_HASH_SECRET` in production and keep it stable while active OTPs exist. The app has no push-notification or WebSocket integration configured. Providers receive requests through authenticated polling; the client should poll the provider-request endpoint while online.

All endpoints below use the existing `{ "success": true, "message": "...", "data": ... }` envelope and require `Authorization: Bearer <token>`, except the existing unauthenticated `GET /api/providers` listing.

## Provider presence and discovery

### Find nearby providers

`GET /api/providers/nearby?service_id=2&lat=13.0827&lng=80.2707&radius_km=10`

Requires authentication. Only active, verified, available providers with a matching `service_id`, valid coordinates and a fresh `location_updated_at` are returned. Results include `distance_km` and are nearest-first. An empty result is a successful response with `data: []`. The current provider is not specially excluded.

### Go online/offline

`POST /api/providers/nearby_service`

```json
{ "availability": true, "latitude": 13.0827, "longitude": 80.2707 }
```

Going online requires a verified provider and fresh coordinates. To go offline, send `{ "availability": false }`; saved coordinates are retained. The authenticated account selects the provider row; supplied user/provider IDs are not used.

### Update current location

`PATCH /api/providers/location`

```json
{ "latitude": 13.0828, "longitude": 80.2708 }
```

Updates only the authenticated provider's `service_providers` row and refreshes `location_updated_at`.

## Customer booking

### Create an immediate booking

`POST /api/bookings/userBookingLive`

```json
{
  "service_id": 2,
  "address": "10 Example Street, Chennai",
  "latitude": 13.0827,
  "longitude": 80.2707,
  "description": "Water leakage in the kitchen"
}
```

The customer ID comes from the authenticated account, and the price is read from the active service record. The API creates a `REQUESTED` booking with a price snapshot and sends individual `SENT` requests to all matching providers within the configured radius. It returns `provider_count` and `request_status`. If no provider matches, the booking remains `REQUESTED` with no assigned provider; the response says that none were found, and the customer can cancel it or create a new request later.

Example response:

```json
{
  "success": true,
  "message": "Booking request sent to nearby providers",
  "data": {
    "booking_id": 42,
    "status": "REQUESTED",
    "provider_id": null,
    "estimated_amount": "300.00",
    "provider_count": 3,
    "request_status": "SENT"
  }
}
```

### Create a scheduled booking

`POST /api/bookings/userBookingDate`

```json
{
  "service_id": 2,
  "booking_date": "2027-01-15T10:00:00.000Z",
  "address": "10 Example Street, Chennai",
  "latitude": 13.0827,
  "longitude": 80.2707,
  "description": "Replace the kitchen tap"
}
```

Scheduled requests use the same provider request and acceptance workflow, but retain the supplied future `booking_date`. `POST /api/bookings` remains available for Google Places addresses and uses `service_id`, `booking_date`, `google_place_id`, and `sessionToken`.
Scheduled requests do not expire on the immediate-booking timer: their response window remains open until up to 30 minutes before the appointment (or until the appointment for bookings made with shorter notice).

## Provider polling and response

### Poll outstanding requests

`GET /api/bookings/provider/requests` (provider token)

Returns only requests for the authenticated provider. Expired requests are marked `EXPIRED`; bookings with requests but no remaining `SENT` requests are marked `REJECTED`.
Each request includes `customer_id`, `customer_name`, service and booking details, `booking_status`, `request_status`, and the selected service location (`service_address`, `service_latitude`, `service_longitude`, `service_city`, and `service_district`). The customer phone and OTP are not included. The selected location is the resolved Google Places address for `POST /api/bookings`, or the address and coordinates supplied for a live or scheduled booking.

After the provider accepts, the customer can request the OTP from `POST /api/bookings/{bookingId}/otp`. The provider can mark the booking en route with `PUT /api/bookings/{bookingId}/status` and `{ "status": "ON_THE_WAY" }`; the booking detail response continues to include the selected service location. The OTP is verified at the service location to transition the booking to `STARTED`.

### Provider active bookings and history

`GET /api/bookings/provider/active?status=ACCEPTED&page=1&limit=20` (provider token) returns assigned bookings in `ACCEPTED`, `ON_THE_WAY`, or `STARTED` status. `status` is optional and may be any one of those values. `page` defaults to `1`; `limit` defaults to `20` and is capped at `100`.

`GET /api/bookings/provider/history?status=COMPLETED&page=1&limit=20` (provider token) returns assigned `COMPLETED` and `CANCELLED` bookings using the same pagination contract. Both endpoints return `bookings` and `pagination` inside `data`; each booking contains customer name, service, destination address and coordinates, lifecycle timestamps, amount, and latest payment status. The database uses `STARTED` for the requested `IN_PROGRESS` phase; no schema status rename is needed.

### Accept or reject

`POST /api/bookings/42/accept` or `POST /api/bookings/42/reject` (provider token; empty body)

Acceptance verifies the provider's ownership, verification, availability and service eligibility. A conditional database update makes the first acceptance win, assigns `provider_id`, marks the request accepted, and expires the other sent requests. A competing acceptance receives HTTP `409`. Rejection leaves the booking open for other providers unless all requests have been rejected/expired.

## Booking details, OTP and completion

### Fetch booking

`GET /api/bookings/42`

Only the customer, the assigned provider, or an admin may read it. Providers who have only received a request must use `/api/bookings/provider/requests`; rejected or expired request recipients cannot read booking details. Once assigned, safe provider details (name, profile image, phone, experience and latest saved location) are included. OTP plaintext and hash are never part of this response. Latest payment ID, amount, method, status, and paid timestamp are included when available.

### Generate/reissue customer OTP

After acceptance, the customer calls `POST /api/bookings/42/otp` (customer token; empty body). The response contains the six-digit OTP and `expires_at`; only an HMAC is stored. This response-return approach is development-only, not a production delivery channel. Production must deliver the OTP to the verified customer's phone through an SMS/OTP provider, return only delivery metadata to the app, and keep the OTP out of request logs and general booking responses. The resend interval and attempt limit are configured above. Do not share or log this response.

### Mark provider en route (optional)

`PUT /api/bookings/42/status` (provider token)

```json
{ "status": "ON_THE_WAY" }
```

### Verify OTP at the job

`POST /api/bookings/42/verify-otp` (assigned provider token)

```json
{ "otp": "123456" }
```

The legacy `PUT /api/bookings/42/otp` verification route is retained. A valid, unexpired OTP atomically marks the booking `STARTED` and records `started_at`; invalid attempts are counted. The provider cannot fetch the customer's plaintext OTP.

### Complete work

`POST /api/bookings/42/complete` (assigned provider token; empty body)

Only an OTP-verified `STARTED` booking can be completed. This records `completed_at` and uses the booking's stored estimate as `final_amount`; callers cannot set the amount or mark payment successful. Customer cancellation remains available through `PUT /api/bookings/42/status` with `{ "status": "CANCELLED" }` while the booking is pending, accepted or en route.

`GET /api/bookings` returns the authenticated customer's full history, newest first. `GET /api/bookings/{bookingId}` returns full details only to the customer, assigned provider, or admin. Provider active/history endpoints return only jobs assigned to that provider.

## Payment lifecycle

`POST /api/payments` accepts `{ "booking_id": 42, "payment_method": "CASH" }` from the customer who owns a completed booking. The amount is derived from `final_amount` (falling back to `estimated_amount`); client-supplied amounts and transaction IDs are not used. A partial unique index prevents concurrent pending/successful payments for one booking. Existing databases must apply `sql/payment_active_unique_migration.sql` after resolving any duplicate pending/successful payments.

`GET /api/payments` lists only payments visible to the authenticated customer/provider (admins can see all), and `GET /api/payments/{paymentId}` enforces the same ownership rule. The assigned provider may mark a `CASH` payment `SUCCESS` after collection. `ONLINE`, `QR`, and `WALLET` payments cannot be marked successful through the status API until a trusted gateway confirmation/webhook flow exists. Admins may mark payments `FAILED` or refund a successful payment. Payment statuses remain separate from booking statuses.

## End-to-end test sequence (Postman)

1. Authenticate a customer; save its JWT as `customerToken`.
2. Authenticate at least two verified, active provider accounts; save their JWTs as `providerOneToken` and `providerTwoToken`.
3. Use `PATCH /api/providers/location` and `POST /api/providers/nearby_service` for each provider, placing them within the configured radius and setting availability true.
4. As the customer, call `GET /api/providers/nearby` with the service ID and matching customer coordinates. Confirm both providers are present and sorted by `distance_km`.
5. As the customer, call `POST /api/bookings/userBookingLive` using the JSON above. Save `data.booking_id` as `bookingId`; verify the returned price and provider count.
6. As each provider, call `GET /api/bookings/provider/requests`. Confirm the request appears; reject it as provider one and accept it as provider two using the booking ID.
7. As the customer, call `GET /api/bookings/{bookingId}` and verify assigned provider details and `ACCEPTED` status. Call `POST /api/bookings/{bookingId}/otp` and save `data.otp` for this test only.
8. As provider two, call `GET /api/bookings/provider/active`; verify the accepted booking and destination coordinates appear. Mark it `ON_THE_WAY` if appropriate.
9. As the customer, call `POST /api/bookings/{bookingId}/otp`. As provider two, submit a wrong OTP (expect `400`), then submit the correct OTP to `/verify-otp` (expect `STARTED`). Try again to confirm duplicate use is rejected.
10. As provider two, call `POST /api/bookings/{bookingId}/complete`; verify `COMPLETED`, timestamps and pending payment status. Confirm it appears in `/api/bookings/provider/history` and the customer's `GET /api/bookings` history.
11. As the customer, create a payment for the completed booking. For `CASH`, confirm it as the assigned provider; confirm non-cash success is rejected until a verified gateway flow exists. Verify payment visibility for customer/provider and rejection for unrelated users.
12. Repeat with two providers accepting the same booking concurrently; assert one success and one `409`. Also test stale/offline/unverified/wrong-service/out-of-radius providers, no matches, expiry, expired/wrong OTP, another customer's booking ID, a non-assigned provider's verify/complete attempts, duplicate accept/reject calls, and concurrent duplicate payment creation.

No live database integration run is implied by these instructions; use a test database and the migration above before running the sequence.
