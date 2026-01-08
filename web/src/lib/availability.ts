import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  query,
} from "firebase/firestore";
import { db } from "./firebase";

export type DayStatus = "OPEN" | "UNAVAILABLE";

export type DaysMap = {
  mon: { status: DayStatus };
  tue: { status: DayStatus };
  wed: { status: DayStatus };
  thu: { status: DayStatus };
  fri: { status: DayStatus };
  sat: { status: DayStatus };
  sun: { status: DayStatus };
};

export const DEFAULT_DAYS: DaysMap = {
  mon: { status: "OPEN" },
  tue: { status: "OPEN" },
  wed: { status: "OPEN" },
  thu: { status: "OPEN" },
  fri: { status: "OPEN" },
  sat: { status: "OPEN" },
  sun: { status: "OPEN" },
};

export const DAY_LABEL: Record<keyof DaysMap, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

export function summarizeDays(days: DaysMap) {
  const unavailable = (Object.keys(days) as (keyof DaysMap)[])
    .filter((k) => days[k].status === "UNAVAILABLE")
    .map((k) => DAY_LABEL[k]);

  if (unavailable.length === 0) return "All days OPEN";
  return `Unavailable: ${unavailable.join(", ")}`;
}

export async function getEffectiveAvailability(uid: string) {
  const ref = doc(db, "availability_effective", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

export async function setEffectiveAvailability(uid: string, days: DaysMap, managerEmail: string) {
  const ref = doc(db, "availability_effective", uid);
  await setDoc(
    ref,
    {
      uid,
      days,
      updatedAt: serverTimestamp(),
      updatedBy: managerEmail || "manager",
    },
    { merge: true }
  );
}

/**
 * Cria pedido do funcionário.
 * ✅ Inclui managerEmail para o Cloud Function saber para quem mandar email.
 */
export async function createAvailabilityRequest(params: {
  uid: string;
  employeeEmail: string;
  employeeName: string;
  proposedDays: DaysMap;
  managerEmail: string;
}) {
  const ref = collection(db, "availability_requests");
  const docRef = await addDoc(ref, {
    uid: params.uid,
    employeeEmail: params.employeeEmail,
    employeeName: params.employeeName,
    managerEmail: params.managerEmail,
    proposedDays: params.proposedDays,
    summary: summarizeDays(params.proposedDays),
    status: "PENDING",
    createdAt: serverTimestamp(),
  });
  return docRef.id;
}

/**
 * ✅ Sem index: apenas where(status=="PENDING")
 */
export async function listPendingAvailabilityRequests() {
  const q = query(collection(db, "availability_requests"), where("status", "==", "PENDING"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
}

export async function approveAvailabilityRequest(params: {
  requestId: string;
  uid: string;
  proposedDays: DaysMap;
  managerEmail: string;
}) {
  await setEffectiveAvailability(params.uid, params.proposedDays, params.managerEmail);

  const ref = doc(db, "availability_requests", params.requestId);
  await updateDoc(ref, {
    status: "APPROVED",
    decidedAt: serverTimestamp(),
    decidedBy: params.managerEmail || "manager",
  });
}

export async function rejectAvailabilityRequest(params: { requestId: string; managerEmail: string }) {
  const ref = doc(db, "availability_requests", params.requestId);
  await updateDoc(ref, {
    status: "REJECTED",
    decidedAt: serverTimestamp(),
    decidedBy: params.managerEmail || "manager",
  });
}
