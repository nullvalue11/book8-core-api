/**
 * BOO-57A: public booking page — URLs + captions only (no Cloudinary publicId).
 */
export function toPublicPortfolio(portfolio) {
  if (!Array.isArray(portfolio) || portfolio.length === 0) {
    return undefined;
  }
  const sorted = [...portfolio].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  return sorted.map((p) => {
    const row = {
      id: p.id,
      url: p.url,
      sortOrder: typeof p.sortOrder === "number" ? p.sortOrder : 0
    };
    if (p.caption && String(p.caption).trim()) {
      row.caption = String(p.caption).trim();
    }
    if (p.category && String(p.category).trim()) {
      row.category = String(p.category).trim();
    }
    return row;
  });
}
