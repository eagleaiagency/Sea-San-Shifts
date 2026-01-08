import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase";

export type UserProfile = {
  uid: string;
  email: string;
  name: string;
  area: "Front" | "Back";
  createdAt?: any;
  updatedAt?: any;
};


export async function getProfile(uid: string) {
  const ref = doc(db, "profiles", uid);
  const snap = await getDoc(ref);
  return snap.exists() ? (snap.data() as UserProfile) : null;
}

export async function saveProfile(profile: UserProfile) {
  const ref = doc(db, "profiles", profile.uid);
  await setDoc(
    ref,
    { ...profile, updatedAt: serverTimestamp(), createdAt: serverTimestamp() },
    { merge: true }
  );
}
