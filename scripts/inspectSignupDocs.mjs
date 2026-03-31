import mongoose from "mongoose";

const email = process.argv[2] || "wallogill237@gmail.com";
const uri = process.env.MONGODB_URI;
if (!uri) process.exit(1);

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function main() {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const re = new RegExp(`^${escapeRegex(email)}$`, "i");
  const users = await db.collection("users").find({ email: re }).toArray();
  const biz = await db.collection("businesses").find({ ownerEmail: re }).toArray();
  const pick = (docs) =>
    docs.map((d) => {
      const o = { ...d };
      if (o._id) o._id = String(o._id);
      delete o.password;
      delete o.passwordHash;
      delete o.hash;
      return o;
    });
  console.log(JSON.stringify({ users: pick(users), businesses: pick(biz) }, null, 2));
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
