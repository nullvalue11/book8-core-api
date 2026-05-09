# Infobip WhatsApp setup (BOO-INFOBIP-INTEGRATE-1A)

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `INFOBIP_API_KEY` | For Infobip routes | API key (`Authorization: App …`). |
| `INFOBIP_BASE_URL` | With API key | e.g. `https://YOURSUBDOMAIN.api.infobip.com` (no trailing slash). |
| `INFOBIP_TEST_SENDER` | Staging / trial | Infobip trial WhatsApp sender (digits). Used when `business.whatsappSenderNumber` is unset. |

If **either** `INFOBIP_API_KEY` **or** `INFOBIP_BASE_URL` is set without the other, the API **exits at startup** (misconfiguration guard).

## Developer smoke test

```bash
node scripts/testInfobipIntegration.mjs --to=+YOUR_MOBILE_E164
```

Verify sender list and (if `--to` provided) send a template message using `INFOBIP_TEST_SENDER`.

Optional:

- `INFOBIP_TEST_TEMPLATE` — defaults to `booking_confirmation`
- `INFOBIP_TEST_LANG` — defaults to `en`
- `INFOBIP_TEST_PLACEHOLDERS` — comma-separated list for template body placeholders

## Onboarding a MENA customer

1. Customer provides their WhatsApp Business number.
2. Complete sender registration in the Infobip portal (and Meta verification / OTP as required).
3. Set `business.whatsappSenderNumber` in MongoDB when approved.
4. Set `business.businessProfile.address.country` (or `business.country` / `preferredBSP`) so routing selects Infobip.
5. Ensure Meta-approved templates exist: `booking_confirmation`, `booking_reminder`, `booking_cancelled` (per language variants as needed).

## Cost monitoring

- Utility templates (UAE example from evaluation): ~\$0.022 / message; session messages lower.
- Periodically check balance: `GET /account/1/balance` with `Authorization: App <key>`.
- Consider alerts when balance drops below your threshold (e.g. \$20).

## Scope note (Phase 1)

Outbound WhatsApp only. Inbound WhatsApp replies and AI over WhatsApp are **Phase 2** (`BOO-INFOBIP-INBOUND-AI-1A`).
