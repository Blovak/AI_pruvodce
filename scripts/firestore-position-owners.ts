import { ADMIN_EMAIL } from "../lib/admin";
import {
  FirestoreEnv,
  queryDocuments,
  setDocument,
} from "../lib/firestore-rest";

type GuideCacheRecord = Record<string, unknown> & {
  createdByEmail?: string;
};

function required(name: keyof FirestoreEnv) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Chybí proměnná ${name}.`);
  return value;
}

const env: FirestoreEnv = {
  FIREBASE_PROJECT_ID: required("FIREBASE_PROJECT_ID"),
  FIREBASE_CLIENT_EMAIL: required("FIREBASE_CLIENT_EMAIL"),
  FIREBASE_PRIVATE_KEY: required("FIREBASE_PRIVATE_KEY"),
};
const apply = process.argv.includes("--apply");
const records = await queryDocuments<GuideCacheRecord>(env, "guideCache");
const missing = records.filter(
  ({ data }) => !String(data.createdByEmail || "").trim(),
);
const byUser = new Map<string, number>();
for (const { data } of records) {
  const email = String(data.createdByEmail || "").trim() || "(bez uživatele)";
  byUser.set(email, (byUser.get(email) || 0) + 1);
}

console.log(`Pozic celkem: ${records.length}`);
console.log(`Pozic bez uživatele: ${missing.length}`);
for (const [email, count] of [...byUser.entries()].sort()) {
  console.log(`${email}: ${count}`);
}

if (!apply) {
  console.log("Kontrola bez zápisu. Pro doplnění spusťte s parametrem --apply.");
} else {
  const batchSize = 10;
  for (let offset = 0; offset < missing.length; offset += batchSize) {
    await Promise.all(
      missing.slice(offset, offset + batchSize).map(({ id, data }) =>
        setDocument(env, `guideCache/${id}`, {
          ...data,
          createdByEmail: ADMIN_EMAIL,
        }),
      ),
    );
  }
  const remaining = (
    await queryDocuments<GuideCacheRecord>(env, "guideCache")
  ).filter(({ data }) => !String(data.createdByEmail || "").trim()).length;
  if (remaining) throw new Error(`Po doplnění zůstává ${remaining} pozic bez uživatele.`);
  console.log(`${missing.length} pozic doplněno uživatelem ${ADMIN_EMAIL}.`);
}
