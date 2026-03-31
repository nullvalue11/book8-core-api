import mongoose from "mongoose";

const uri = process.env.MONGODB_URI;
if (!uri) process.exit(1);

async function main() {
  await mongoose.connect(uri);
  const names = (await mongoose.connection.db.listCollections().toArray())
    .map((c) => c.name)
    .sort();
  console.log(JSON.stringify({ db: mongoose.connection.name, collections: names }, null, 2));
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
