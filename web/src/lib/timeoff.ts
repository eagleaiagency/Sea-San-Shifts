import { addDoc, collection, doc, getDocs, updateDoc } from "firebase/firestore";
import { db } from "./firebase";

export type TimeOffType = "FULL" | "HALF_AM" | "HALF_PM";
export type TimeOffStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED";


export type TimeOffRequest = {
  id?: string;
  uid: string;
  employeeName: string;
  employeeEmail: string;
  date: string; // YYYY-MM-DD
  type: TimeOffType;
  note?: string;
  status: TimeOffStatus;
  createdAt?: any;
  decidedAt?: any;
  decidedBy?: string;
};

export async function createTimeOffRequest(req: Omit<TimeOffRequest, "id" | "status" | "createdAt" | "decidedAt" | "decidedBy">) {
  const ref = collection(db, "timeoff_requests");
  const docRef = await addDoc(ref, {
    ...req,
    status: "PENDING",
    createdAt: new Date().toISOString(),
  });
  return docRef.id;
}

export async function listAllTimeOffRequests() {
  const snap = await getDocs(collection(db, "timeoff_requests"));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as TimeOffRequest[];
}

export async function listPendingTimeOffRequests() {
  const all = await listAllTimeOffRequests();
  return all.filter((r) => r.status === "PENDING");
}

export async function listApprovedTimeOff() {
  const all = await listAllTimeOffRequests();
  return all.filter((r) => r.status === "APPROVED");
}

export async function approveTimeOff(requestId: string, managerEmail: string) {
  await updateDoc(doc(db, "timeoff_requests", requestId), {
    status: "APPROVED",
    decidedAt: new Date().toISOString(),
    decidedBy: managerEmail || "manager",
  });
}

export async function rejectTimeOff(requestId: string, managerEmail: string) {
  await updateDoc(doc(db, "timeoff_requests", requestId), {
    status: "REJECTED",
    decidedAt: new Date().toISOString(),
    decidedBy: managerEmail || "manager",
  });
}
