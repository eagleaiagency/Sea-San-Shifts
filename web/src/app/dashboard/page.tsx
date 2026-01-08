"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  updateDoc,
  where,
  setDoc,
} from "firebase/firestore";

import { auth, db } from "../../lib/firebase";
import { getProfile, saveProfile, UserProfile } from "../../lib/profile";
import { getDevSession, clearDevSession } from "../../lib/devSession";
import { MANAGER_EMAIL, TIMEOFF_MIN_DAYS, DEFAULT_ROLES } from "../../lib/config";

import {
  DaysMap,
  DEFAULT_DAYS,
  DAY_LABEL,
  summarizeDays,
  getEffectiveAvailability,
  createAvailabilityRequest,
} from "../../lib/availability";
import { createShift, deleteShift, listAllShifts, updateShift, Shift } from "../../lib/schedule";
import {
  createTimeOffRequest,
  listAllTimeOffRequests,
  listApprovedTimeOff,
  approveTimeOff,
  rejectTimeOff,
  TimeOffRequest,
  TimeOffType,
} from "../../lib/timeoff";
import {
  createShiftRequest,
  listAllShiftRequests,
  updateShiftRequest,
  ShiftRequest,
} from "../../lib/shiftRequests";

import {
  StaffArea,
  StaffMember,
  claimStaff,
  clearPendingStaffId,
  createStaff,
  findStaffByEmail,
  getPendingStaffId,
  listStaffByArea,
  removeStaff,
  setStaffEmail,
} from "../../lib/staff";

/* ============================================================
   BACKFILL — RESGATA SHIFTS ANTIGOS PELO NOME (FIX DEFINITIVO)
   ============================================================ */
async function backfillMyShiftsFromName(opts: {
  staffName: string;
  area: StaffArea;
  email: string;
  uid: string;
}) {
  const name = (opts.staffName || "").trim();
  const email = (opts.email || "").toLowerCase().trim();
  const uid = opts.uid;
  if (!name || !email || !uid) return;

  const q = query(
    collection(db, "shifts"),
    where("area", "==", opts.area),
    where("employeeName", "==", name),
    limit(300)
  );

  const snap = await getDocs(q);
  const updates: Promise<any>[] = [];

  snap.docs.forEach((d) => {
    const s = d.data() as any;
    const needsEmail = !s.employeeEmail || String(s.employeeEmail).trim() === "";
    const needsUid = !s.employeeUid || String(s.employeeUid).trim() === "";

    if (needsEmail || needsUid) {
      updates.push(
        updateDoc(doc(db, "shifts", d.id), {
          employeeEmail: email,
          employeeUid: uid,
          updatedAt: serverTimestamp(),
        })
      );
    }
  });

  await Promise.allSettled(updates);
}

const navy = "#071A2B";
const blue = "#3FA9F5";
const text = "#EAF2FF";

/* ================= SESSION ================= */

type Tab = "home" | "week" | "swaps" | "availability" | "timeoff";

type Session = {
  authUid: string;
  email: string;
  name: string;
  area: StaffArea;
  isManager: boolean;
};

/* ================= DASHBOARD ================= */

export default function DashboardPage() {
  const [tab, setTab] = useState<Tab>("home");
  const [fbUser, setFbUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => setFbUser(u));
    return () => unsub();
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        if (fbUser) {
          const email = (fbUser.email || "").toLowerCase();
          const isManager = email === MANAGER_EMAIL.toLowerCase();

          let p = await getProfile(fbUser.uid);

          if (!p) {
            const staff = email ? await findStaffByEmail(email) : null;
            const name = staff?.name || email.split("@")[0];
            const area = (staff?.area as StaffArea) || "Front";

            const newP: UserProfile = {
              uid: fbUser.uid,
              email,
              name,
              area,
            };

            await saveProfile(newP);
            p = newP;

            if (staff?.id && !staff.claimedByUid) {
              await claimStaff(staff.id, fbUser.uid);
            }
          }

          const pendingStaffId = getPendingStaffId();
          if (pendingStaffId) {
            const staffSnap = await getDoc(doc(db, "staff", pendingStaffId));
            if (staffSnap.exists()) {
              const staff = { id: staffSnap.id, ...(staffSnap.data() as any) } as StaffMember;
              const staffEmail = (staff.email || "").toLowerCase();

              if (!staff.claimedByUid && (!staffEmail || staffEmail === email)) {
                await setStaffEmail(staff.id, email);
                await claimStaff(staff.id, fbUser.uid);

                const merged: UserProfile = {
                  uid: fbUser.uid,
                  email,
                  name: staff.name,
                  area: staff.area,
                };
                await saveProfile(merged);
                p = merged;
              }
            }
            clearPendingStaffId();
          }

          const s: Session = {
            authUid: fbUser.uid,
            email,
            name: p!.name,
            area: p!.area as StaffArea,
            isManager,
          };

          setSession(s);
          return;
        }

        const dev = getDevSession();
        if (dev) {
          setSession(dev as any);
          return;
        }

        setSession(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [fbUser]);

  /* 🔥 BACKFILL AQUI */
  useEffect(() => {
    if (!session) return;
    if (session.isManager) return;

    backfillMyShiftsFromName({
      staffName: session.name,
      area: session.area,
      email: session.email,
      uid: session.authUid,
    }).catch(() => {});
  }, [session?.authUid]);

  if (loading) {
    return <div style={{ padding: 40, color: text }}>Carregando…</div>;
  }

  if (!session) {
    return <div style={{ padding: 40, color: text }}>Sem sessão</div>;
  }

  return (
    <div style={{ minHeight: "100vh", background: navy, color: text, padding: 20 }}>
      <h1>Sea San Shifts — Dashboard</h1>
      <p>
        {session.name} • {session.email} • {session.area} {session.isManager ? "(Gerente)" : ""}
      </p>

      <button
        onClick={async () => {
          clearDevSession();
          if (fbUser) await signOut(auth);
          location.href = "/";
        }}
      >
        Sair
      </button>
    </div>
  );
}


