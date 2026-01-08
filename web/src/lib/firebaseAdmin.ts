import * as admin from "firebase-admin";
import path from "path";
import fs from "fs";

let _inited = false;

function initAdmin() {
  if (_inited) return;
  if (admin.apps.length) {
    _inited = true;
    return;
  }

  const relPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!relPath) throw new Error("Missing FIREBASE_SERVICE_ACCOUNT_PATH in web/.env.local");

  const fullPath = path.join(process.cwd(), relPath);
  if (!fs.existsSync(fullPath)) throw new Error(`Service account not found at: ${fullPath}`);

  const json = JSON.parse(fs.readFileSync(fullPath, "utf8"));

  admin.initializeApp({
    credential: admin.credential.cert(json),
  });

  _inited = true;
}

export function getAdminDb() {
  initAdmin();
  return admin.firestore();
}

export async function verifyFirebaseIdToken(idToken: string) {
  initAdmin();
  return admin.auth().verifyIdToken(idToken);
}
