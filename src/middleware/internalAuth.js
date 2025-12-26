// src/middleware/internalAuth.js
export const requireInternalAuth = (req, res, next) => {
  const authHeader = req.headers["x-book8-internal-secret"];
  const expectedSecret = process.env.INTERNAL_API_SECRET;

  if (!expectedSecret) {
    console.error("[INTERNAL_AUTH] INTERNAL_API_SECRET environment variable is not set");
    console.error("[INTERNAL_AUTH] Request path:", req.path);
    console.error("[INTERNAL_AUTH] Request method:", req.method);
    return res.status(500).json({
      ok: false,
      error: "Server configuration error: INTERNAL_API_SECRET not configured"
    });
  }

  if (!authHeader) {
    console.warn("[INTERNAL_AUTH] Missing x-book8-internal-secret header");
    return res.status(401).json({
      ok: false,
      error: "Unauthorized: Missing internal auth secret header"
    });
  }

  if (authHeader !== expectedSecret) {
    console.warn("[INTERNAL_AUTH] Invalid internal auth secret (header length:", authHeader.length, ")");
    return res.status(401).json({
      ok: false,
      error: "Unauthorized: Invalid internal auth secret"
    });
  }

  next();
};

