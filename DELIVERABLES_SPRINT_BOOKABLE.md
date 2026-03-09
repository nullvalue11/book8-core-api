# Sprint: Make New Tenants Bookable by Default — Deliverables

## 1. Files added/changed

**New files**
- `models/Service.js` — Service model (businessId, serviceId, name, durationMinutes, active) + `generateServiceIdFromName(name)`
- `models/Schedule.js` — Schedule model (businessId unique, timezone, weeklyHours)
- `services/bookableBootstrap.js` — `ensureDefaultServicesForBusiness`, `ensureDefaultScheduleForBusiness`, `ensureBookableDefaultsForBusiness` (idempotent)
- `tests/servicesAndSchedule.test.js` — Tests for services/schedule endpoints and bootstrap idempotency

**Modified files**
- `models/Business.js` — Unchanged for this sprint (still has embedded services/weeklySchedule for backward compat; Schedule/Service collections are primary)
- `services/tenantEnsure.js` — After creating business, calls `ensureBookableDefaultsForBusiness`; returns `defaultsEnsured`
- `services/calendarAvailability.js` — Loads Service + Schedule; requires serviceId; generates slots from weeklyHours; excludes slots conflicting with Booking
- `services/bookingService.js` — Requires serviceId; loads Service; validates active; validates slot duration vs service.durationMinutes
- `src/routes/calendar.js` — Requires serviceId; 404 for Service not found / not active
- `src/routes/bookings.js` — Requires serviceId and slot.timezone; 404 for Service not found
- `src/routes/internalExecuteTool.js` — tenant.ensure result includes `defaultsEnsured`; calendar.availability requires serviceId; booking.create requires serviceId; added `ops.getResult` handler
- `index.js` — Imports Service, Schedule, ensureBookableDefaultsForBusiness; onboard + provision call bootstrap and return `defaultsEnsured`; added GET/POST `/api/businesses/:id/services`, GET/PUT `/api/businesses/:id/schedule`
- `tests/calendar.test.js` — Setup creates Service + Schedule; tests for serviceId required, service not found, inactive service
- `tests/bookings.test.js` — Setup creates Service; tests for serviceId, service not found
- `tests/executeTool.test.js` — Setup creates Service + Schedule; tenant.ensure test asserts `defaultsEnsured`; added `ops.getResult` test

---

## 2. Routes added

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/businesses/:id/services` | None | List services for business |
| POST | `/api/businesses/:id/services` | x-book8-api-key | Create service |
| GET | `/api/businesses/:id/schedule` | None | Get schedule (or fallback from business) |
| PUT | `/api/businesses/:id/schedule` | x-book8-api-key | Create/update schedule |

Existing routes unchanged: `POST /api/calendar/availability` (now requires serviceId), `POST /api/bookings` (now requires serviceId, slot.timezone), `POST /internal/execute-tool` (same tool names; ops.getResult added).

---

## 3. Models added

- **Service** — `businessId`, `serviceId` (unique per business), `name`, `durationMinutes`, `active` (default true), timestamps. Helper: `generateServiceIdFromName(name)`.
- **Schedule** — `businessId` (unique), `timezone`, `weeklyHours` (object: monday..sunday arrays of `{ start, end }`), timestamps.

---

## 4. Response shapes

**tenant.ensure (execute-tool)**
```json
{
  "ok": true,
  "status": "succeeded",
  "result": {
    "ok": true,
    "businessId": "diamond-gym",
    "existed": false,
    "created": true,
    "defaultsEnsured": true
  },
  "error": null
}
```

**GET /api/businesses/:id/services**
```json
{
  "ok": true,
  "businessId": "diamond-gym",
  "services": [
    {
      "businessId": "diamond-gym",
      "serviceId": "intro-session-60",
      "name": "Intro Session",
      "durationMinutes": 60,
      "active": true,
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

**POST /api/businesses/:id/services** (201)
```json
{
  "ok": true,
  "businessId": "diamond-gym",
  "service": { "businessId", "serviceId", "name", "durationMinutes", "active", "createdAt", "updatedAt" }
}
```

**GET /api/businesses/:id/schedule**
```json
{
  "ok": true,
  "businessId": "diamond-gym",
  "schedule": {
    "businessId": "diamond-gym",
    "timezone": "America/Toronto",
    "weeklyHours": { "monday": [...], "tuesday": [...], ... }
  }
}
```

**PUT /api/businesses/:id/schedule**
```json
{
  "ok": true,
  "businessId": "diamond-gym",
  "schedule": { "businessId", "timezone", "weeklyHours", "createdAt", "updatedAt" }
}
```

**POST /api/calendar/availability** — Unchanged shape; requires `serviceId`; duration comes from service (explicit durationMinutes in request is ignored).

**POST /api/bookings** — Unchanged shape; requires `serviceId` and `slot.timezone`.

---

## 5. TODOs left for real calendar-provider overlay

- In `services/calendarAvailability.js`: TODO remains for Google Calendar / Cal.com / etc. Schedule is the primary source of truth; when a provider is connected, overlay or replace slot generation with provider fetch and still exclude existing bookings.

---

## 6. Sample curl commands

**Create tenant and ensure defaults (via execute-tool)**
```bash
curl -s -X POST https://book8-core-api.onrender.com/internal/execute-tool \
  -H "Content-Type: application/json" \
  -H "x-book8-internal-secret: YOUR_INTERNAL_SECRET" \
  -d '{
    "tool": "tenant.ensure",
    "input": { "businessId": "diamond-gym", "name": "Diamond Gym" }
  }'
```

**Get services**
```bash
curl -s "https://book8-core-api.onrender.com/api/businesses/diamond-gym/services"
```

**Create service**
```bash
curl -s -X POST "https://book8-core-api.onrender.com/api/businesses/diamond-gym/services" \
  -H "Content-Type: application/json" \
  -H "x-book8-api-key: YOUR_API_KEY" \
  -d '{
    "serviceId": "personal-training-60",
    "name": "Personal Training",
    "durationMinutes": 60,
    "active": true
  }'
```

**Get schedule**
```bash
curl -s "https://book8-core-api.onrender.com/api/businesses/diamond-gym/schedule"
```

**Update schedule**
```bash
curl -s -X PUT "https://book8-core-api.onrender.com/api/businesses/diamond-gym/schedule" \
  -H "Content-Type: application/json" \
  -H "x-book8-api-key: YOUR_API_KEY" \
  -d '{
    "timezone": "America/Toronto",
    "weeklyHours": {
      "monday": [{ "start": "09:00", "end": "17:00" }],
      "tuesday": [{ "start": "09:00", "end": "17:00" }],
      "wednesday": [{ "start": "09:00", "end": "17:00" }],
      "thursday": [{ "start": "09:00", "end": "17:00" }],
      "friday": [{ "start": "09:00", "end": "17:00" }],
      "saturday": [],
      "sunday": []
    }
  }'
```

**Availability lookup**
```bash
curl -s -X POST "https://book8-core-api.onrender.com/api/calendar/availability" \
  -H "Content-Type: application/json" \
  -d '{
    "businessId": "diamond-gym",
    "serviceId": "intro-session-60",
    "from": "2026-03-08T00:00:00-05:00",
    "to": "2026-03-09T00:00:00-05:00",
    "timezone": "America/Toronto"
  }'
```

**Booking create**
```bash
curl -s -X POST "https://book8-core-api.onrender.com/api/bookings" \
  -H "Content-Type: application/json" \
  -d '{
    "businessId": "diamond-gym",
    "serviceId": "intro-session-60",
    "customer": { "name": "John Doe", "phone": "+16475551234", "email": "john@example.com" },
    "slot": {
      "start": "2026-03-08T14:00:00-05:00",
      "end": "2026-03-08T15:00:00-05:00",
      "timezone": "America/Toronto"
    },
    "notes": "First session",
    "source": "voice-agent"
  }'
```

---

## 7. n8n changes

- No new webhooks. Same `book8_execute_tool` → Execute Tool (Real Run) → `POST /internal/execute-tool`.
- **calendar.availability** — Ensure `input` includes `serviceId` (e.g. `intro-session-60` for default). Required: `businessId`, `serviceId`, `from`, `to`; `timezone` optional.
- **booking.create** — Ensure `input` includes `serviceId` and `slot.timezone`. Required: `businessId`, `serviceId`, `customer`, `slot` (with start, end, timezone).
- **tenant.ensure** — Response may include `result.defaultsEnsured: true` when a new tenant was created and defaults were bootstrapped.
- **ops.getResult** — Supported; pass-through of `input.result` in the response.

---

## 8. ElevenLabs prompt/tool updates

- **calendar.availability** — Tool input must include `serviceId`. Use default service `intro-session-60` for new tenants if you don’t have another. Duration is taken from the service, not from the request.
- **booking.create** — Tool input must include `serviceId` and `slot.timezone`. Slot duration must match the service (e.g. 60 minutes for intro-session-60).
- **tenant.ensure** — No change; optional: mention that new tenants get a default “Intro Session” and Mon–Fri 9–5 schedule so they are bookable immediately.

---

## Tests

Run: `npm test` (requires MongoDB and, for some tests, `INTERNAL_API_SECRET` and `BOOK8_CORE_API_KEY`).

- **calendar.test.js** — serviceId required, business/service not found, inactive service, happy path.
- **bookings.test.js** — serviceId required, business/service not found, slot.timezone, conflict (409).
- **executeTool.test.js** — tenant.ensure (defaultsEnsured), calendar.availability, booking.create, ops.getResult, validation failures.
- **servicesAndSchedule.test.js** — GET/POST services, GET/PUT schedule, bootstrap idempotency (calling ensure twice does not duplicate).
