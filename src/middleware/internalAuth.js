// src/middleware/internalAuth.js
export const requireInternalAuth = (req, res, next) => {
  const authHeader = req.headers["x-book8-internal-secret"];
  const expectedSecret = process.env.INTERNAL_API_SECRET;

  if (!expectedSecret) {
    console.error("INTERNAL_API_SECRET environment variable is not set");
    return res.status(500).json({
      ok: false,
      error: "Server configuration error"
    });
  }

  if (!authHeader || authHeader !== expectedSecret) {
    return res.status(401).json({
      ok: false,
      error: "Unauthorized: Invalid or missing internal auth secret"
    });
  }

  next();
};

