// src/lib/staff.ts
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
  const data = d.data() as any;
  return {
    id: d.id,
    name: data.name || "",
    area: (data.area as StaffArea) || "Front",
    email: (data.email || "").toLowerCase(),
    claimedByUid: data.claimedByUid || "",
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

export const listStaffByArea = async (area: StaffArea): Promise<StaffMember[]> => {
  const q = query(collection(db, "staff"), where("area", "==", area), limit(200));
  const snap = await getDocs(q);
  return snap.docs.map(mapDoc);
};

export const listAllStaff = async (): Promise<StaffMember[]> => {
  const snap = await getDocs(query(collection(db, "staff"), limit(500)));
  return snap.docs.map(mapDoc);
};

export const findStaffByEmail = async (email: string): Promise<StaffMember | null> => {
  const em = (email || "").trim().toLowerCase();
  if (!em) return null;
  const q = query(collection(db, "staff"), where("email", "==", em), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return mapDoc(snap.docs[0]);
};

export const getStaff = async (id: string): Promise<StaffMember | null> => {
  const ref = doc(db, "staff", id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return mapDoc({ id: snap.id, data: () => snap.data() });
};

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

export const setStaffEmail = async (staffId: string, email: string): Promise<void> => {
  const clean = (email || "").trim().toLowerCase();
  await updateDoc(doc(db, "staff", staffId), {
    email: clean,
    updatedAt: serverTimestamp(),
  });
};

export const claimStaff = async (staffId: string, authUid: string): Promise<void> => {
  await updateDoc(doc(db, "staff", staffId), {
    claimedByUid: authUid,
    updatedAt: serverTimestamp(),
  });
};

export const removeStaff = async (staffId: string): Promise<void> => {
  await deleteDoc(doc(db, "staff", staffId));
};

// helper opcional: salva qual staff o usuário escolheu antes de mandar magic link
export const setPendingStaffId = (staffId: string): void => {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("pendingStaffId", staffId);
  } catch {}
};

export const getPendingStaffId = (): string | null => {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem("pendingStaffId");
  } catch {
    return null;
  }
};

export const clearPendingStaffId = (): void => {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem("pendingStaffId");
  } catch {}
};

