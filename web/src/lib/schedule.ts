import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  updateDoc,
} from "firebase/firestore";
import { db } from "./firebase";

export type ShiftStatus = "DRAFT" | "PUBLISHED";

export type Shift = {
  id?: string;
  weekStart: string;   // YYYY-MM-DD (domingo da semana)  <-- (seu app usa segunda, mas pode manter)
  date: string;        // YYYY-MM-DD
  start: string;       // HH:MM
  end: string;         // HH:MM
  area: "Front" | "Back";
  role: string;        // texto livre

  employeeUid: string;
  employeeName: string;
  employeeEmail: string;

  // ✅ NOVO: observação do shift (opcional)
  note?: string;       // ex: "intervalo de 1 hora"

  status: ShiftStatus; // DRAFT / PUBLISHED
  createdAt?: any;
};

export async function createShift(shift: Omit<Shift, "id" | "createdAt">) {
  const ref = collection(db, "shifts");
  const docRef = await addDoc(ref, {
    ...shift,
    createdAt: new Date().toISOString(),
  });
  return docRef.id;
}

export async function deleteShift(shiftId: string) {
  await deleteDoc(doc(db, "shifts", shiftId));
}

export async function updateShift(shiftId: string, patch: Partial<Shift>) {
  await updateDoc(doc(db, "shifts", shiftId), patch as any);
}

export async function listAllShifts() {
  const snap = await getDocs(collection(db, "shifts"));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Shift[];
}
