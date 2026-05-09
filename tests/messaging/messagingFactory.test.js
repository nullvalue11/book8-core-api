import test from "node:test";
import assert from "node:assert/strict";

import {
  getMessagingProvider,
  TwilioProvider,
  InfobipProvider
} from "../../services/messaging/messagingFactory.js";

test("getMessagingProvider uses Twilio for United States", () => {
  const p = getMessagingProvider({
    businessProfile: { address: { country: "United States" } }
  });
  assert.ok(p instanceof TwilioProvider);
});

test("getMessagingProvider uses Infobip for UAE", () => {
  const p = getMessagingProvider({
    businessProfile: { address: { country: "United Arab Emirates" } }
  });
  assert.ok(p instanceof InfobipProvider);
});

test("getMessagingProvider respects preferredBSP override", () => {
  const tw = getMessagingProvider({
    businessProfile: { address: { country: "United Arab Emirates" } },
    preferredBSP: "twilio"
  });
  assert.ok(tw instanceof TwilioProvider);

  const ib = getMessagingProvider({
    businessProfile: { address: { country: "Canada" } },
    preferredBSP: "infobip"
  });
  assert.ok(ib instanceof InfobipProvider);
});

test("getMessagingProvider falls back to Twilio for unknown country", () => {
  const p = getMessagingProvider({
    businessProfile: { address: { country: "Atlantis" } }
  });
  assert.ok(p instanceof TwilioProvider);
});

test("ISO2 AE routes to Infobip", () => {
  const p = getMessagingProvider({ country: "AE" });
  assert.ok(p instanceof InfobipProvider);
});
