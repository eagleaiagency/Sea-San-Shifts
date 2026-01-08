import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "./firebase";

export type StaffArea = "Front" | "Back";

export type StaffMember = {
  id: string;
  name: string;
  area: StaffArea;
  email?: string;
  claimedByUid?: string;
  createdAt?: any;
  updatedAt?: any;
};

function mapDoc(d: any): StaffMember {
  const data = d.data() || {};
  return {
    id: d.id,
    name: data.name || "",
    area: (data.area as StaffArea) || "Front",
    email: data.email || "",
    claimedByUid: data.claimedByUid || "",
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

/** ========== Pending Staff (SSR safe) ========== */
const PENDING_KEY = "pendingStaffId";
export const setPendingStaffId = (id: string) => {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(PENDING_KEY, id);
  } catch {}
};

export const getPendingStaffId = () => {
  try {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(PENDING_KEY) || "";
  } catch {
    return "";
  }
};

export const clearPendingStaffId = () => {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(PENDING_KEY);
  } catch {}
};

/** ========== Queries ========== */

export const findStaffByEmail = async (email: string): Promise<StaffMember | null> => {
  const e = (email || "").trim().toLowerCase();
  if (!e) return null;

  const q = query(collection(db, "staff"), where("email", "==", e), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return mapDoc(snap.docs[0]);
};

export const listUnclaimedStaff = async (area: StaffArea): Promise<StaffMember[]> => {
  // “não claimed” = claimedByUid vazio
  const q = query(
    collection(db, "staff"),
    where("area", "==", area),
    where("claimedByUid", "==", ""),
    limit(200)
  );
  const snap = await getDocs(q);
  return snap.docs.map(mapDoc);
};

export const listStaffByArea = async (area: StaffArea): Promise<StaffMember[]> => {
  const q = query(collection(db, "staff"), where("area", "==", area), limit(300));
  const snap = await getDocs(q);
  return snap.docs.map(mapDoc);
};

export const getStaff = async (id: string): Promise<StaffMember | null> => {
  const ref = doc(db, "staff", id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return mapDoc({ id: snap.id, data: () => snap.data() });
};

/** ========== Mutations ========== */

export const createStaff = async (name: string, area: StaffArea): Promise<string> => {
  const ref = await addDoc(collection(db, "staff"), {
    name: (name || "").trim(),
    area,
    email: "",
    claimedByUid: "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
};

export const setStaffEmail = async (staffId: string, email: string) => {
  const clean = (email || "").trim().toLowerCase();
  await updateDoc(doc(db, "staff", staffId), {
    email: clean,
    updatedAt: serverTimestamp(),
  });
};

export const claimStaff = async (staffId: string, authUid: string) => {
  await updateDoc(doc(db, "staff", staffId), {
    claimedByUid: authUid,
    updatedAt: serverTimestamp(),
  });
};

export const removeStaff = async (staffId: string) => {
  await deleteDoc(doc(db, "staff", staffId));
};


