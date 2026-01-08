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
  claimedByUid?: string; // auth uid
  createdAt?: any;
  updatedAt?: any;
};

function mapDoc(d: any): StaffMember {
  return { id: d.id, ...(d.data() as any) } as StaffMember;
}

export async function listStaffByArea(area: StaffArea): Promise<StaffMember[]> {
  const q = query(collection(db, "staff"), where("area", "==", area));
  const snap = await getDocs(q);
  return snap.docs.map(mapDoc).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

export async function listUnclaimedStaff(area: StaffArea): Promise<StaffMember[]> {
  // "unclaimed" = claimedByUid vazio
  // e "não tem email ainda" OU tem email mas ainda não claimado (serve pra quando user colocou email mas não logou ainda)
  const q = query(collection(db, "staff"), where("area", "==", area));
  const snap = await getDocs(q);
  return snap.docs
    .map(mapDoc)
    .filter((s) => !s.claimedByUid)
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

export async function findStaffByEmail(email: string): Promise<StaffMember | null> {
  const q = query(collection(db, "staff"), where("email", "==", email.toLowerCase()), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return mapDoc(snap.docs[0]);
}

export async function getStaff(id: string): Promise<StaffMember | null> {
  const ref = doc(db, "staff", id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return mapDoc({ id: snap.id, data: () => snap.data() });
}

export async function createStaff(name: string, area: StaffArea): Promise<string> {
  const ref = await addDoc(collection(db, "staff"), {
    name: name.trim(),
    area,
    email: "",
    claimedByUid: "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function setStaffEmail(staffId: string, email: string) {
  await updateDoc(doc(db, "staff", staffId), {
    email: email.toLowerCase(),
    updatedAt: serverTimestamp(),
  });
}

export async function claimStaff(staffId: string, authUid: string) {
  await updateDoc(doc(db, "staff", staffId), {
    claimedByUid: authUid,
    updatedAt: serverTimestamp(),
  });
}

export async function removeStaff(staffId: string) {
  await deleteDoc(doc(db, "staff", staffId));
}

// helper opcional: salva qual staff o usuário escolheu antes de mandar magic link
export function setPendingStaffId(staffId: string) {
  try {
    localStorage.setItem("pendingStaffId", staffId);
  } catch {}
}
export function getPendingStaffId(): string | null {
  try {
    return localStorage.getItem("pendingStaffId");
  } catch {
    return null;
  }
}
export function clearPendingStaffId() {
  try {
    localStorage.removeItem("pendingStaffId");
  } catch {}
}
