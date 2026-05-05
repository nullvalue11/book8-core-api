import test from "node:test";
import assert from "node:assert/strict";

import { getVerticalPromptAddendum } from "../src/utils/verticalPromptAddendum.js";

test("vertical prompt addendum routing", () => {
  assert.ok(getVerticalPromptAddendum("barber").includes("barbershop"));
  assert.ok(getVerticalPromptAddendum("barbershop").includes("barbershop"));

  assert.ok(getVerticalPromptAddendum("dental").includes("dental clinic"));
  assert.ok(getVerticalPromptAddendum("orthodontist").includes("dental clinic"));

  assert.ok(getVerticalPromptAddendum("spa").includes("beauty salon or spa"));
  assert.ok(getVerticalPromptAddendum("hair_salon").includes("beauty salon or spa"));

  assert.ok(getVerticalPromptAddendum("fitness").includes("fitness studio"));
  assert.ok(getVerticalPromptAddendum("gym").includes("fitness studio"));

  assert.ok(getVerticalPromptAddendum("physio").includes("physiotherapy"));
  assert.ok(getVerticalPromptAddendum("chiropractic").includes("physiotherapy"));

  assert.equal(getVerticalPromptAddendum(undefined), "");
  assert.equal(getVerticalPromptAddendum(""), "");
  assert.equal(getVerticalPromptAddendum("car_wash"), "");
});

