import { addDoc, collection, doc, getDocs, updateDoc } from "firebase/firestore";
import { db } from "./firebase";

export type RequestType = "TAKE" | "SWAP";
export type RequestStatus =
  | "PENDING_TARGET" // aguardando o outro funcionário
  | "REJECTED_BY_TARGET"
  | "APPROVED_BY_TARGET" // alvo aprovou
  | "PENDING_MANAGER" // indo para gerente
  | "REJECTED_BY_MANAGER"
  | "APPROVED_BY_MANAGER"
  | "CANCELLED";

export type ShiftRequest = {
  id?: string;

  type: RequestType;
  status: RequestStatus;

  weekStart: string;
  area: "Front" | "Back";

  // quem pediu
  requesterUid: string;
  requesterName: string;
  requesterEmail: string;

  // quem precisa aceitar primeiro (o dono do shift)
  targetUid: string;
  targetName: string;
  targetEmail: string;

  // shift do target (o que vai ser pego/trocado)
  targetShiftId: string;

  // se for SWAP: shift do requester (o que ele oferece em troca)
  requesterShiftId?: string;

  note?: string;

  createdAt: string;
  updatedAt: string;
};

// ✅ remove campos undefined (Firestore não aceita undefined)
function stripUndefined<T extends Record<string, any>>(obj: T) {
  const clean: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) clean[k] = v;
  }
  return clean as T;
}

export async function createShiftRequest(
  req: Omit<ShiftRequest, "id" | "createdAt" | "updatedAt" | "status">
) {
  const ref = collection(db, "shift_requests");
  const now = new Date().toISOString();

  // ✅ muito importante: não mandar requesterShiftId undefined, nem note undefined
  const payload = stripUndefined({
    ...req,
    status: "PENDING_TARGET" as const,
    createdAt: now,
    updatedAt: now,
  });

  const docRef = await addDoc(ref, payload);
  return docRef.id;
}

export async function listAllShiftRequests() {
  const snap = await getDocs(collection(db, "shift_requests"));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as ShiftRequest[];
}

export async function updateShiftRequest(id: string, patch: Partial<ShiftRequest>) {
  // ✅ também limpa undefined no patch
  const clean = stripUndefined({
    ...patch,
    updatedAt: new Date().toISOString(),
  });

  await updateDoc(doc(db, "shift_requests", id), clean as any);
}
