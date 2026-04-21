// BOO-63A — root + basic health (moved from index.js)
import express from "express";

/** Deploy verification: set RENDER_GIT_COMMIT on Render (e.g. to the deploy commit SHA). */
function rootHealthPayload() {
  return {
    ok: true,
    service: "book8-core-api",
    renderGitCommit: process.env.RENDER_GIT_COMMIT || null
  };
}

const router = express.Router();

router.get("/", (req, res) => {
  res.json(rootHealthPayload());
});

router.get("/health", (req, res) => {
  res.json(rootHealthPayload());
});

export default router;
