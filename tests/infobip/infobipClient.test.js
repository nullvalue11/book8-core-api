import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeWhatsAppAddress,
  sendWhatsAppTemplate
} from "../../services/infobip/infobipClient.js";

test("normalizeWhatsAppAddress strips non-digits", () => {
  assert.equal(normalizeWhatsAppAddress("+971 50 123 4567"), "971501234567");
});

test("sendWhatsAppTemplate sends Authorization App header and JSON body", async (t) => {
  t.afterEach(() => {
    delete process.env.INFOBIP_API_KEY;
    delete process.env.INFOBIP_BASE_URL;
    globalThis.fetch = undefined;
  });

  process.env.INFOBIP_BASE_URL = "https://example.infobip.com";
  process.env.INFOBIP_API_KEY = "secret-key";

  let captured = /** @type {{ url: string, opts: RequestInit }} */ ({ url: "", opts: {} });
  globalThis.fetch = async (url, opts) => {
    captured = { url: String(url), opts };
    return {
      ok: true,
      status: 200,
      text: async () => '{"messages":[{"messageId":"mid"}]}'
    };
  };

  await sendWhatsAppTemplate({
    from: "447860088970",
    to: "+442087712345",
    templateName: "booking_confirmation",
    languageCode: "en",
    placeholders: ["a", "b", "c", "d", "e"]
  });

  assert.match(captured.url, /\/whatsapp\/1\/message\/template$/);
  assert.equal(captured.opts.method, "POST");
  assert.ok(
    String(captured.opts.headers?.Authorization || captured.opts.headers?.authorization).includes(
      "App secret-key"
    )
  );
  const body = JSON.parse(String(captured.opts.body || "{}"));
  assert.equal(body.messages[0].content.templateName, "booking_confirmation");
  assert.deepEqual(body.messages[0].content.templateData.body.placeholders, ["a", "b", "c", "d", "e"]);
});

test("sendWhatsAppTemplate throws when Infobip env incomplete", async () => {
  delete process.env.INFOBIP_API_KEY;
  delete process.env.INFOBIP_BASE_URL;
  await assert.rejects(
    () =>
      sendWhatsAppTemplate({
        from: "1",
        to: "2",
        templateName: "x",
        languageCode: "en",
        placeholders: []
      }),
    /not configured/
  );
});
