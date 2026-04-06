/**
 * BOO-76A — Franchise service sync: sibling copy + POST service propagation.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import request from "supertest";
import { app } from "../index.js";
import { Business } from "../models/Business.js";
import { Service } from "../models/Service.js";
import { copyFranchiseServicesToNewBusiness } from "../services/franchiseServiceSync.js";

const API_KEY = process.env.BOOK8_CORE_API_KEY || "test-api-key";

function apiKeyHeader(req) {
  req.set("x-book8-api-key", API_KEY);
  return req;
}

describe("Franchise service sync (BOO-76A)", () => {
  const stamp = Date.now();
  const idA = `test-franchise-a-${stamp}`;
  const idB = `test-franchise-b-${stamp}`;
  const idC = `test-franchise-c-${stamp}`;
  const ownerEmail = `franchise-owner-${stamp}@example.com`;
  const category = "car_wash";

  before(async () => {
    if (!process.env.BOOK8_CORE_API_KEY) process.env.BOOK8_CORE_API_KEY = API_KEY;
    await Business.create({
      id: idA,
      name: "Diamond Wash A",
      category,
      email: ownerEmail,
      timezone: "America/Toronto",
      plan: "starter"
    });
    await Business.create({
      id: idB,
      name: "Diamond Wash B",
      category,
      email: ownerEmail,
      timezone: "America/Toronto",
      plan: "starter"
    });
    await Service.create({
      businessId: idA,
      serviceId: "full-detail",
      name: "Full Detail",
      durationMinutes: 90,
      price: 120,
      active: true
    });
  });

  after(async () => {
    await Service.deleteMany({ businessId: { $in: [idA, idB, idC] } });
    await Business.deleteMany({ id: { $in: [idA, idB, idC] } });
  });

  it("copyFranchiseServicesToNewBusiness copies from earliest sibling", async () => {
    await Business.create({
      id: idC,
      name: "Diamond Wash C",
      category,
      email: ownerEmail,
      timezone: "America/Toronto",
      plan: "none"
    });
    const copied = await copyFranchiseServicesToNewBusiness(idC);
    assert.strictEqual(copied, true);
    const onC = await Service.findOne({ businessId: idC, serviceId: "full-detail" }).lean();
    assert.ok(onC);
    assert.strictEqual(onC.name, "Full Detail");
    assert.strictEqual(onC.durationMinutes, 90);
    assert.strictEqual(onC.price, 120);
  });

  it("POST /api/businesses/:id/services syncs to franchise siblings", async () => {
    const res = await apiKeyHeader(
      request(app).post(`/api/businesses/${idA}/services`).send({
        serviceId: `wax-extra-${stamp}`,
        name: "Premium Wax",
        durationMinutes: 45,
        price: 80,
        active: true
      })
    );
    assert.strictEqual(res.status, 201, res.text);
    const onB = await Service.findOne({ businessId: idB, serviceId: `wax-extra-${stamp}` }).lean();
    assert.ok(onB);
    assert.strictEqual(onB.name, "Premium Wax");
    assert.strictEqual(onB.price, 80);
  });
});
