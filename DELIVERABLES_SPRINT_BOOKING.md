# Sprint: Book8 Voice Agent / Booking Workflow — Deliverables

## 1. Files changed / added

**New files**
- `services/slotDisplay.js` — Human-friendly slot display helper
- `services/calendarAvailability.js` — Calendar availability (stub + layer for future provider)
- `services/bookingService.js` — Booking creation and slot conflict check
- `models/Booking.js` — Booking schema
- `src/routes/calendar.js` — POST /api/calendar/availability handler
- `src/routes/bookings.js` — POST /api/bookings handler
- `src/routes/internalExecuteTool.js` — Internal execute-tool dispatch (calendar.availability, booking.create)
- `tests/calendar.test.js` — Route tests for calendar availability
- `tests/bookings.test.js` — Route tests for bookings
- `tests/executeTool.test.js` — Execution-layer tests for execute-tool

**Modified files**
- `index.js` — Mount calendar, bookings, and internal execute-tool routes; export `app` when `NODE_ENV=test`
- `package.json` — Added `"test": "node --test tests/"` and devDependency `supertest`

---

## 2. Routes added

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/calendar/availability` | None | Get available slots for a business/service in a date range |
| POST | `/api/bookings` | None | Create a booking for a selected slot |
| POST | `/internal/execute-tool` | `x-book8-internal-secret` | Execute tool by name (calendar.availability, booking.create); same pattern as tenant.ensure |

---

## 3. Environment variables

No new env vars are required for the new features. Existing ones used:

- `MONGODB_URI` — Already used; Booking collection lives in same DB.
- `INTERNAL_API_SECRET` — Already used; required for `/internal/execute-tool` (and other internal routes).

Optional (unchanged):

- `BOOK8_CORE_API_KEY` — For write APIs like `/api/onboard`, `/api/provision`, etc. (not required for `/api/calendar/availability` or `/api/bookings`).

---

## 4. TODOs / stubs for calendar provider

- **`services/calendarAvailability.js`**  
  - **TODO:** When calendar integration exists, replace the stub with a real provider.  
  - Stub: `getStubSlots()` generates sample slots (e.g. 2 PM and 4 PM per day) so the voice/booking flow runs end-to-end.  
  - Place to plug in: inside `getAvailability()`, after loading the business, add a branch such as:  
    `if (business.calendarProvider === 'google') { return await googleCalendar.getSlots(...); }`  
  - Business model does not yet have `calendarProvider` or `calendarCredentials`; add those when you integrate a provider.

---

## 5. Sample curl commands

**Calendar availability**

```bash
curl -s -X POST http://localhost:5050/api/calendar/availability \
  -H "Content-Type: application/json" \
  -d '{
    "businessId": "diamond-gym",
    "serviceId": "personal-training-60",
    "from": "2026-03-08T00:00:00-05:00",
    "to": "2026-03-09T00:00:00-05:00",
    "timezone": "America/Toronto",
    "durationMinutes": 60
  }'
```

**Create booking**

```bash
curl -s -X POST http://localhost:5050/api/bookings \
  -H "Content-Type: application/json" \
  -d '{
    "businessId": "diamond-gym",
    "serviceId": "personal-training-60",
    "customer": {
      "name": "John Doe",
      "phone": "+16475551234",
      "email": "john@example.com"
    },
    "slot": {
      "start": "2026-03-08T14:00:00-05:00",
      "end": "2026-03-08T15:00:00-05:00",
      "timezone": "America/Toronto"
    },
    "notes": "First-time intro session",
    "source": "voice-agent"
  }'
```

**Internal execute-tool (e.g. from n8n)**

```bash
curl -s -X POST http://localhost:5050/internal/execute-tool \
  -H "Content-Type: application/json" \
  -H "x-book8-internal-secret: YOUR_INTERNAL_API_SECRET" \
  -d '{
    "tool": "calendar.availability",
    "input": {
      "businessId": "diamond-gym",
      "serviceId": "personal-training-60",
      "from": "2026-03-08T00:00:00-05:00",
      "to": "2026-03-09T00:00:00-05:00",
      "timezone": "America/Toronto",
      "durationMinutes": 60
    },
    "requestId": "req-123",
    "executionKey": "exec-456"
  }'
```

```bash
curl -s -X POST http://localhost:5050/internal/execute-tool \
  -H "Content-Type: application/json" \
  -H "x-book8-internal-secret: YOUR_INTERNAL_API_SECRET" \
  -d '{
    "tool": "booking.create",
    "input": {
      "businessId": "diamond-gym",
      "serviceId": "personal-training-60",
      "customer": { "name": "John Doe", "phone": "+16475551234", "email": "john@example.com" },
      "slot": {
        "start": "2026-03-08T14:00:00-05:00",
        "end": "2026-03-08T15:00:00-05:00",
        "timezone": "America/Toronto"
      },
      "notes": "First-time intro session",
      "source": "voice-agent"
    }
  }'
```

---

## 6. n8n changes after backend is deployed

- **Do not add a new webhook.** Keep using the same **book8_execute_tool** webhook and the same **Execute Tool (Real Run)** workflow.
- **Single backend URL:** Point the workflow to the same internal endpoint, but the backend now supports two more tool names:
  - **`calendar.availability`** — Call `POST /internal/execute-tool` with `tool: "calendar.availability"` and `input` as in the curl above. Backend returns the same normalized shape (`ok`, `status`, `tool`, `tenantId`, `requestId`, `executionKey`, `result`, `error`).
  - **`booking.create`** — Call `POST /internal/execute-tool` with `tool: "booking.create"` and `input` as in the curl above.
- **Workflow logic:** In the node that currently calls the core-api for `tenant.ensure`, extend the branch so that:
  - If `tool === "tenant.ensure"` → keep existing call (e.g. to provision/onboard as you do today).
  - If `tool === "calendar.availability"` or `tool === "booking.create"` → **POST to `BASE_URL/internal/execute-tool`** with body `{ tool, input, requestId?, executionKey? }` and header `x-book8-internal-secret: INTERNAL_API_SECRET`.
- **Response shape:** The backend already returns the ElevenLabs-friendly shape. Pass the response through to the webhook response so ElevenLabs receives:
  - `ok`, `status`, `tool`, `tenantId`, `requestId`, `executionKey`, `result`, `error`
- No new environment variables are required in n8n beyond the existing core-api base URL and internal secret.

---

## Tests

- Run: `npm test` (requires MongoDB running; use same `MONGODB_URI` or set it to a test DB).
- Coverage: route-level tests for `/api/calendar/availability` and `/api/bookings`; execution-layer tests for `calendar.availability` and `booking.create` (happy path, validation failure, slot conflict, unknown tool).
