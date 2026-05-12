import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeWhatsAppAddress,
  sendWhatsAppTemplate,
  resolveWhatsAppSender,
  sendText
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
    languageCode: "en_US",
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
  assert.equal(body.messages[0].content.language, "en_US");
  assert.deepEqual(body.messages[0].content.templateData.body.placeholders, ["a", "b", "c", "d", "e"]);
});

test("sendWhatsAppTemplate defaults language to en_US when omitted", async (t) => {
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
    placeholders: []
  });

  const body = JSON.parse(String(captured.opts.body || "{}"));
  assert.equal(body.messages[0].content.language, "en_US");
});

test("resolveWhatsAppSender uses INFOBIP_SENDER when business has no sender", (t) => {
  t.afterEach(() => {
    delete process.env.INFOBIP_SENDER;
  });
  process.env.INFOBIP_SENDER = "+15551234567";
  assert.equal(resolveWhatsAppSender(null), "15551234567");
});

test("resolveWhatsAppSender prefers per-business whatsappSenderNumber", (t) => {
  t.afterEach(() => {
    delete process.env.INFOBIP_SENDER;
  });
  process.env.INFOBIP_SENDER = "+19999999999";
  assert.equal(resolveWhatsAppSender({ whatsappSenderNumber: "+14441112222" }), "14441112222");
});

test("resolveWhatsAppSender strips + from env value", (t) => {
  t.afterEach(() => {
    delete process.env.INFOBIP_SENDER;
  });
  process.env.INFOBIP_SENDER = "+15550002222";
  assert.equal(resolveWhatsAppSender({ id: "biz_x" }), "15550002222");
});

test("resolveWhatsAppSender throws when neither source is set", (t) => {
  t.afterEach(() => {
    delete process.env.INFOBIP_SENDER;
  });
  delete process.env.INFOBIP_SENDER;
  assert.throws(() => resolveWhatsAppSender(null), /No WhatsApp sender configured/);
});

test("sendText resolves sender from INFOBIP_SENDER when from omitted", async (t) => {
  t.afterEach(() => {
    delete process.env.INFOBIP_API_KEY;
    delete process.env.INFOBIP_BASE_URL;
    delete process.env.INFOBIP_SENDER;
    globalThis.fetch = undefined;
  });

  process.env.INFOBIP_BASE_URL = "https://example.infobip.com";
  process.env.INFOBIP_API_KEY = "secret-key";
  process.env.INFOBIP_SENDER = "+15550001111";

  let captured = /** @type {{ url: string, opts: RequestInit }} */ ({ url: "", opts: {} });
  globalThis.fetch = async (url, opts) => {
    captured = { url: String(url), opts };
    return {
      ok: true,
      status: 200,
      text: async () => '{"messages":[{"messageId":"mid"}]}'
    };
  };

  await sendText({ to: "+19998887777", text: "Hello there" });

  const body = JSON.parse(String(captured.opts.body || "{}"));
  assert.equal(body.from, "15550001111");
  assert.equal(body.to, "19998887777");
  assert.equal(body.content.text, "Hello there");
  assert.ok(body.messageId && String(body.messageId).length > 0);
});

test("sendText uses explicit from and strips +", async (t) => {
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

  await sendText({ from: "+1 555 111 2222", to: "+19998887777", text: "x" });
  const body = JSON.parse(String(captured.opts.body || "{}"));
  assert.equal(body.from, "15551112222");
  assert.equal(body.content.text, "x");
});

test("sendText rejects when no sender can be resolved", async (t) => {
  t.afterEach(() => {
    delete process.env.INFOBIP_API_KEY;
    delete process.env.INFOBIP_BASE_URL;
    delete process.env.INFOBIP_SENDER;
  });

  process.env.INFOBIP_BASE_URL = "https://example.infobip.com";
  process.env.INFOBIP_API_KEY = "secret-key";
  delete process.env.INFOBIP_SENDER;

  await assert.rejects(() => sendText({ to: "+19998887777", text: "x" }), /No WhatsApp sender configured/);
});
