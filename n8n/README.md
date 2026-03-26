# Book8 Ops — Provisioning Health Check (n8n)

Implements the **N8N_WORKFLOW_SPEC_PROVISIONING_HEALTH_CHECK** spec (provisioning check + retry via execute-tool + alerts).

## Import

1. n8n → **Workflows** → menu → **Import from File**.
2. Choose `book8-ops-provisioning-health-check.json` from this folder.
3. Set **environment variables** on your n8n instance (or host env):

| Variable | Purpose |
|----------|---------|
| `CORE_API_INTERNAL_SECRET` | Header `x-internal-secret` for `book8-core-api` `/api/health/*` |
| `N8N_OPS_SECRET` | Same secret your `ops-execute-tool` webhook expects (`x-ops-secret`) |
| `RESEND_API_KEY` | Resend API key for alert emails |

4. Open **Send Alert Resend** and set `from` / `to` (use a Resend-verified domain for `from`).
5. Adjust **Health Check** / **Recheck** URLs if your API is not `https://book8-core-api.onrender.com`.
6. Adjust **Retry Execute Tool** URL if your execute-tool webhook is not `https://n8n.book8.io/webhook/ops-execute-tool`.
7. Activate the workflow. Webhook path: **`POST /webhook/provisioning-check`** (production URL depends on your n8n base).

## Triggers

- **Webhook:** `POST` body `{ "businessId": "biz_..." }` (e.g. dashboard “Retry”).
- **Schedule:** Daily **08:00** `America/Toronto`.
- **Manual** execute (checks **all** businesses, same as schedule).

## core-api

- **`GET /api/health/business/:id`** and **`GET /api/health/all`** remain on core-api.
- **`POST /api/provisioning/retry`** was removed; orchestration lives here in n8n.

## book8-ai (dashboard)

Add on Vercel (or your host):

```bash
N8N_PROVISIONING_CHECK_URL=https://n8n.book8.io/webhook/provisioning-check
N8N_OPS_SECRET=your-ops-secret-here
```

Point your admin **provisioning retry** route at `N8N_PROVISIONING_CHECK_URL` with `POST` JSON `{ businessId }` and header `x-ops-secret: N8N_OPS_SECRET` (match how your other ops webhooks authenticate).

Example handler shape:

```javascript
const N8N_WEBHOOK_URL =
  process.env.N8N_PROVISIONING_CHECK_URL ||
  "https://n8n.book8.io/webhook/provisioning-check";
const N8N_OPS_SECRET = process.env.N8N_OPS_SECRET;

const retryRes = await fetch(N8N_WEBHOOK_URL, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-ops-secret": N8N_OPS_SECRET
  },
  body: JSON.stringify({ businessId }),
  signal: AbortSignal.timeout(45000)
});
```

## Testing

```bash
curl -sS -X POST "https://n8n.book8.io/webhook/provisioning-check" \
  -H "Content-Type: application/json" \
  -H "x-ops-secret: YOUR_SECRET" \
  -d '{"businessId":"biz_yourId"}'
```

Use the same **`x-ops-secret`** as your execute-tool webhook if you protect this webhook the same way.
