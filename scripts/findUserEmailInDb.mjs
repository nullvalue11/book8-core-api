import mongoose from "mongoose";

const email = process.argv[2];
const uri = process.env.MONGODB_URI;
if (!email || !uri) {
  console.error("Usage: MONGODB_URI=... node scripts/findUserEmailInDb.mjs <email>");
  process.exit(1);
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function main() {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const dbName = mongoose.connection.name;
  const re = new RegExp(`^${escapeRegex(email)}$`, "i");

  const names = (await db.listCollections().toArray())
    .map((c) => c.name)
    .filter((n) => !n.startsWith("system."));

  const commonFields = [
    "email",
    "userEmail",
    "ownerEmail",
    "contactEmail",
    "normalizedEmail",
    "primaryEmail"
  ];

  const results = { db: dbName, hits: [] };

  for (const cn of names) {
    const c = db.collection(cn);
    const or = [
      ...commonFields.map((f) => ({ [f]: re })),
      { "emails.address": re },
      { "profile.email": re }
    ];
    try {
      const docs = await c.find({ $or: or }).limit(10).toArray();
      if (docs.length) {
        results.hits.push({
          collection: cn,
          countCapped: docs.length,
          docs: docs.map((d) => ({
            _id: d._id,
            keys: Object.keys(d).filter((k) => commonFields.includes(k))
          }))
        });
      }
    } catch {
      // collection may not allow query
    }
  }

  console.log(JSON.stringify(results, null, 2));
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});
