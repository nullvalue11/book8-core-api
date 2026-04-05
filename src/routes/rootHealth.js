// BOO-63A — root + basic health (moved from index.js)
import express from "express";

const router = express.Router();

router.get("/", (req, res) => {
  res.json({ ok: true, service: "book8-core-api" });
});

router.get("/health", (req, res) => {
  res.json({ ok: true, service: "book8-core-api" });
});

export default router;
