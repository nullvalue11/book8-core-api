// BOO-63A — GET /api/categories (moved from index.js)
import express from "express";
import { listCategories } from "../../services/categoryDefaults.js";

const router = express.Router();

router.get("/categories", (req, res) => {
  const categories = listCategories();
  res.json({ ok: true, categories });
});

export default router;
