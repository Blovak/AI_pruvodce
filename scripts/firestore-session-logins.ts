import {
  FirestoreEnv,
  queryDocuments,
  setDocument,
} from "../lib/firestore-rest";

type AuthSessionRecord = Record<string, unknown> & {
  createdAt?: string;
  lastUsedAt?: string;
  lastLoginAt?: string;
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
const sessions = await queryDocuments<AuthSessionRecord>(env, "authSessions");
const missing = sessions.filter(
  ({ data }) => !String(data.lastLoginAt || "").trim(),
);

console.log(`Relací celkem: ${sessions.length}`);
console.log(`Relací bez lastLoginAt: ${missing.length}`);

if (!apply) {
  console.log("Kontrola bez zápisu. Pro doplnění spusťte s parametrem --apply.");
} else {
  const batchSize = 10;
  for (let offset = 0; offset < missing.length; offset += batchSize) {
    await Promise.all(
      missing.slice(offset, offset + batchSize).map(({ id, data }) =>
        setDocument(env, `authSessions/${id}`, {
          ...data,
          lastLoginAt: String(data.lastUsedAt || data.createdAt || ""),
        }),
      ),
    );
  }
  const remaining = (
    await queryDocuments<AuthSessionRecord>(env, "authSessions")
  ).filter(({ data }) => !String(data.lastLoginAt || "").trim()).length;
  if (remaining) {
    throw new Error(`Po doplnění zůstává ${remaining} relací bez lastLoginAt.`);
  }
  console.log(`${missing.length} relací doplněno polem lastLoginAt.`);
}
