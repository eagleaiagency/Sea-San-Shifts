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

const navy = "#071A2B";
const blue = "#3FA9F5";
const text = "#EAF2FF";

// --- EMAIL helper (usa /api/email; não altera layout) ---
async function sendAppEmail(action: string, payload: any) {
  try {
    const u = auth.currentUser;
    if (!u) return; // sem login firebase (ex: dev session)
    const token = await u.getIdToken();

    await fetch("/api/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ action, payload }),
    });
  } catch {
    // não quebra o app se email falhar
  }
}

type Tab = "home" | "week" | "swaps" | "availability" | "timeoff";

type Session = {
  authUid: string;
  email: string;
  name: string;
  area: StaffArea;
  isManager: boolean;
};

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

          // 1) garante profile em /profiles/{authUid}
          let p = await getProfile(fbUser.uid);

          if (!p) {
            // tenta achar staff pelo email
            const staff = email ? await findStaffByEmail(email) : null;

            const name = staff?.name || (email ? email.split("@")[0] : "User");
            const area = (staff?.area as StaffArea) || "Front";

            const newP: UserProfile = {
              uid: fbUser.uid,
              email,
              name,
              area,
            };

            await saveProfile(newP);
            p = newP;

            // se achou staff e ainda não claimado -> claim
            if (staff?.id && !staff.claimedByUid) {
              await claimStaff(staff.id, fbUser.uid);
            }
          }

          // 2) se user escolheu um nome antes do magic link, tenta claimar
          const pendingStaffId = getPendingStaffId();
          if (pendingStaffId) {
            const staffSnap = await getDoc(doc(db, "staff", pendingStaffId));
            if (staffSnap.exists()) {
              const staff = { id: staffSnap.id, ...(staffSnap.data() as any) } as StaffMember;

              // só claim se email bate OU staff não tem email ainda
              const staffEmail = (staff.email || "").toLowerCase();
              if (!staff.claimedByUid && (!staffEmail || staffEmail === email)) {
                if (email) {
                  await setStaffEmail(staff.id, email);
                }
                await claimStaff(staff.id, fbUser.uid);

                // atualiza profile com nome/area do staff
                const merged: UserProfile = {
                  uid: fbUser.uid,
                  email,
                  name: staff.name || p.name,
                  area: (staff.area as StaffArea) || (p.area as StaffArea) || "Front",
                };
                await saveProfile(merged);
                p = merged;
              }
            }
            clearPendingStaffId();
          }

          // 3) monta sessão
          setSession({
            authUid: fbUser.uid,
            email: email || (p?.email || ""),
            name: p?.name || email.split("@")[0] || "User",
            area: ((p?.area as StaffArea) || "Front") as StaffArea,
            isManager,
          });
          return;
        }

        const dev = getDevSession();
        if (dev) {
          setSession({
            authUid: dev.uid,
            email: dev.email,
            name: dev.name,
            area: dev.area,
            isManager: dev.isManager,
          });
          return;
        }

        setSession(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [fbUser]);

  if (loading) {
    return (
      <Shell>
        <Card>
          <p>Carregando...</p>
        </Card>
      </Shell>
    );
  }

  if (!session) {
    return (
      <Shell>
        <Card>
          <h2 style={{ marginTop: 0 }}>Sem sessão</h2>
          <p style={{ opacity: 0.85 }}>Volte para a Home e use o login.</p>
          <a href="/" style={{ color: blue, fontWeight: 900 }}>
            Ir para /
          </a>
        </Card>
      </Shell>
    );
  }

  const tabs: { key: Tab; label: string; show: boolean }[] = [
    { key: "home", label: "Home", show: true },
    { key: "week", label: "Escala", show: true },
    { key: "swaps", label: "Trocas", show: true },
    // ✅ agora gerente também tem “Disponibilidade”
    { key: "availability", label: "Disponibilidade", show: true },
    { key: "timeoff", label: "Folgas", show: true },
  ];

  return (
    <Shell wide>
      <div style={{ width: "100%", maxWidth: 1150 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 34 }}>
              Sea San Shifts <span style={{ fontSize: 18, opacity: 0.8 }}>— Dashboard</span>
            </h1>
            <div style={{ marginTop: 6, opacity: 0.85, fontWeight: 700 }}>
              {session.name} • {session.email} • Área: {session.area} {session.isManager ? "• (Gerente)" : ""}
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
              {tabs
                .filter((t) => t.show)
                .map((t) => (
                  <TabButton key={t.key} active={tab === t.key} onClick={() => setTab(t.key)}>
                    {t.label}
                  </TabButton>
                ))}
            </div>
          </div>

          <button
            onClick={async () => {
              clearDevSession();
              if (fbUser) await signOut(auth);
              window.location.href = "/";
            }}
            style={headerButton}
          >
            Sair
          </button>
        </div>

        <div style={{ marginTop: 18 }}>
          {tab === "home" && <HomeTab session={session} goWeek={() => setTab("week")} />}
          {tab === "week" && <WeekScheduleTab session={session} />}
          {tab === "swaps" && <SwapsTab session={session} />}
          {tab === "availability" &&
            (session.isManager ? <AvailabilityTabManager session={session} /> : <AvailabilityTabEmployee session={session} />)}
          {tab === "timeoff" && <TimeOffTab session={session} />}
        </div>
      </div>
    </Shell>
  );
}

/* -------------------- HOME -------------------- */
function HomeTab({ session, goWeek }: { session: Session; goWeek: () => void }) {
  const [loading, setLoading] = useState(true);
  const [nextShift, setNextShift] = useState<Shift | null>(null);
  const [nextShiftIsToday, setNextShiftIsToday] = useState(false);

  // parse local Date+Time (evita UTC/toISOString)
  function parseLocalDateTime(dateISO: string, timeHHMM: string) {
    const [y, m, d] = dateISO.split("-").map(Number);
    const [hh, mm] = timeHHMM.split(":").map(Number);
    return new Date(y, m - 1, d, hh, mm, 0, 0);
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        if (session.isManager) {
          setNextShift(null);
          setNextShiftIsToday(false);
          return;
        }

        const all = await listAllShifts();
        const now = new Date();
        const today = toISODateLocal(now);

        const mine = all
          .filter(
            (s) =>
              s.area === session.area &&
              s.status === "PUBLISHED" &&
              (s.employeeUid === session.authUid ||
                (s.employeeEmail || "").toLowerCase() === session.email.toLowerCase())
          )
          // só considera shifts que ainda não terminaram
          .filter((s) => {
            const endDT = parseLocalDateTime(s.date, s.end);
            return endDT.getTime() >= now.getTime();
          })
          // ordena por data+hora de início
          .sort((a, b) => {
            const aDT = parseLocalDateTime(a.date, a.start).getTime();
            const bDT = parseLocalDateTime(b.date, b.start).getTime();
            return aDT - bDT;
          });

        const first = mine[0] || null;
        setNextShift(first);
        setNextShiftIsToday(!!first && first.date === today);
      } finally {
        setLoading(false);
      }
    })();
  }, [session.area, session.isManager, session.authUid, session.email]);

  return (
    <Card>
      {session.isManager ? (
        <>
          <h2 style={{ marginTop: 0 }}>Bem-vindo ao painel de gerente 👑</h2>
          <p style={{ opacity: 0.9 }}>
            Aqui você pode <b>criar a escala da semana</b>, <b>publicar</b> quando estiver pronto, e{" "}
            <b>aprovar folgas/disponibilidade</b>.
          </p>
          <button style={buttonPrimaryAuto} onClick={goWeek}>
            Ir para criação da escala →
          </button>
        </>
      ) : (
        <>
          <h2 style={{ marginTop: 0 }}>Olá, {session.name} 👋</h2>

          {loading ? (
            <p>Carregando...</p>
          ) : (
            <div
              style={{
                marginTop: 10,
                display: "flex",
                gap: 14,
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div>
                {nextShift ? (
                  <>
                    <div style={{ fontSize: 16, fontWeight: 900 }}>
                      {nextShiftIsToday ? (
                        <>
                          Você tem um shift <b>hoje</b> às <span style={{ color: blue }}>{nextShift.start}</span>
                        </>
                      ) : (
                        <>
                          Seu próximo shift é <b>{shortDowPT(nextShift.date)}</b> ({nextShift.date}) às{" "}
                          <span style={{ color: blue }}>{nextShift.start}</span>
                        </>
                      )}
                    </div>

                    <div style={{ marginTop: 6, opacity: 0.9 }}>
                      Função: <b>{nextShift.role}</b> • {nextShift.start}–{nextShift.end}
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 16, fontWeight: 900 }}>
                    Você não tem mais shifts programados (ou a escala ainda não foi publicada).
                  </div>
                )}
              </div>

              <button style={buttonPrimaryAuto} onClick={goWeek}>
                Ver escala completa da semana →
              </button>
            </div>
          )}

          <div style={{ marginTop: 14, opacity: 0.8, fontSize: 13 }}>
            Você só vê a escala da sua área (Front/Back) e somente após o gerente publicar.
          </div>
        </>
      )}
    </Card>
  );
}

/* -------------------- WEEK SCHEDULE -------------------- */

function WeekScheduleTab({ session }: { session: Session }) {
  const [weekStart, setWeekStart] = useState<string>(startOfWeekISO(new Date())); // ✅ seg→dom (local safe)
  const [loading, setLoading] = useState(true);
  const [allShifts, setAllShifts] = useState<Shift[]>([]);
  const [approvedTimeoff, setApprovedTimeoff] = useState<TimeOffRequest[]>([]);

  const [mode, setMode] = useState<"MY" | "AREA">("MY");

  // manager
  const [managerArea, setManagerArea] = useState<StaffArea>(session.area);
  const [managerView, setManagerView] = useState<"DRAFT" | "PUBLISHED">("DRAFT");

  // staff list
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [employeeStaffId, setEmployeeStaffId] = useState<string>("");

  // ✅ IMPORTANT: quando o gerente muda de semana, a data padrão do “Criar shift”
  // precisa cair dentro daquela semana (senão cria fora e “some” do grid)
  const [addDate, setAddDate] = useState<string>(weekStart);
  const [start, setStart] = useState("10:00");
  const [end, setEnd] = useState("16:00");
  const [role, setRole] = useState<string>(DEFAULT_ROLES[0]);

  // manager: add staff
  const [newEmpName, setNewEmpName] = useState("");
  const [newEmpArea, setNewEmpArea] = useState<StaffArea>("Front");

  // modal request
  const [openRequestModal, setOpenRequestModal] = useState(false);
  const [targetShift, setTargetShift] = useState<Shift | null>(null);
  const [requestType, setRequestType] = useState<"TAKE" | "SWAP" | null>(null);
  const [swapMyShiftId, setSwapMyShiftId] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [sending, setSending] = useState(false);

  const activeArea = session.isManager ? managerArea : session.area;

  const weekDays = useMemo(() => getWeekDays(weekStart), [weekStart]);

// ✅ Mobile layout: em telas pequenas, a grade vira carrossel horizontal (sem cortar informação)
const [isMobile, setIsMobile] = useState(false);

useEffect(() => {
  if (typeof window === "undefined") return;
  const mq = window.matchMedia("(max-width: 820px)");
  const apply = () => setIsMobile(mq.matches);
  apply();

  // Safari antigo não tem addEventListener
  // @ts-ignore
  if (mq.addEventListener) mq.addEventListener("change", apply);
  // @ts-ignore
  else mq.addListener(apply);

  return () => {
    // @ts-ignore
    if (mq.removeEventListener) mq.removeEventListener("change", apply);
    // @ts-ignore
    else mq.removeListener(apply);
  };
}, []);

  // ✅ sempre que mudar de semana, mantém addDate dentro da lista
  useEffect(() => {
    setAddDate((prev) => {
      if (weekDays.includes(prev)) return prev;
      return weekStart;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart]);

  async function refresh() {
    setLoading(true);
    try {
      const [s, t, st] = await Promise.all([
        listAllShifts(),
        listApprovedTimeOff(),
        session.isManager ? listStaffByArea(activeArea) : Promise.resolve([]),
      ]);
      setAllShifts(s);
      setApprovedTimeoff(t);

      if (session.isManager) {
        setStaff(st);
        if (!employeeStaffId && st[0]?.id) setEmployeeStaffId(st[0].id);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.isManager, managerArea]);

  const visibleShifts = useMemo(() => {
    const startW = weekStart;
    const endW = addDaysISO(weekStart, 6);

    const base = allShifts.filter(
      (s) => s.weekStart === startW && s.area === activeArea && s.date >= startW && s.date <= endW
    );

    if (session.isManager) {
      return base.filter((s) => s.status === managerView);
    }

    const pub = base.filter((s) => s.status === "PUBLISHED");
    if (mode === "MY") {
      return pub.filter(
        (s) =>
          s.employeeUid === session.authUid ||
          (s.employeeEmail || "").toLowerCase() === session.email.toLowerCase()
      );
    }
    return pub;
  }, [allShifts, activeArea, managerView, mode, session.isManager, session.authUid, session.email, weekStart]);

  const shiftsByDay = useMemo(() => {
    const map: Record<string, Shift[]> = {};
    for (const d of weekDays) map[d] = [];
    for (const s of visibleShifts) {
      if (!map[s.date]) map[s.date] = [];
      map[s.date].push(s);
    }
    for (const d of Object.keys(map)) {
      map[d].sort((a, b) => (a.start + a.employeeName).localeCompare(b.start + b.employeeName));
    }
    return map;
  }, [visibleShifts, weekDays]);

  function isDayOffApproved(uid: string, d: string) {
    return approvedTimeoff.some((r) => r.uid === uid && r.date === d && r.status === "APPROVED");
  }

  const myPublishedShiftsThisWeek = useMemo(() => {
    return allShifts
      .filter(
        (s) =>
          s.weekStart === weekStart &&
          s.area === activeArea &&
          s.status === "PUBLISHED" &&
          (s.employeeUid === session.authUid ||
            (s.employeeEmail || "").toLowerCase() === session.email.toLowerCase())
      )
      .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  }, [allShifts, activeArea, session.authUid, session.email, weekStart]);

  // ✅ publicar agora SUBSTITUI: apaga PUBLISHED antigo e publica o novo DRAFT
  async function publishWeek() {
    const drafts = allShifts.filter(
      (s) => s.weekStart === weekStart && s.area === activeArea && s.status === "DRAFT" && s.id
    );

    if (drafts.length === 0) {
      alert("Não tem shifts em rascunho (DRAFT) para publicar nessa semana/área.");
      return;
    }

    const published = allShifts.filter(
      (s) => s.weekStart === weekStart && s.area === activeArea && s.status === "PUBLISHED" && s.id
    );

    if (published.length > 0) {
      const ok = confirm(
        `⚠️ Já existe uma escala PUBLICADA para essa semana/área.\n\nAo publicar o novo rascunho, a escala publicada antiga será APAGADA e substituída.\n\nContinuar?\n\nPUBLISHED atual: ${published.length} shifts\nDRAFT novo: ${drafts.length} shifts`
      );
      if (!ok) return;

      // apaga os publicados antigos (substituição total)
      for (const s of published) {
        await deleteShift(s.id!);
      }
    }

    for (const s of drafts) {
      await updateShift(s.id!, { status: "PUBLISHED" });
    }

    // 📧 notifica equipe da área (email para quem tem shift publicado na semana)
    await sendAppEmail("schedule_published_week", { weekStart, area: activeArea });

    alert(`✅ Publicado! (substituiu ${published.length} publicados • publicou ${drafts.length} shifts)`);
    await refresh();
    setManagerView("PUBLISHED");
  }

  async function duplicateLastWeekDraft() {
    const prevWeekStart = addDaysISO(weekStart, -7);
    const prevEnd = addDaysISO(prevWeekStart, 6);

    const alreadyDraftThisWeek = allShifts.filter(
      (s) => s.weekStart === weekStart && s.area === activeArea && s.status === "DRAFT"
    );

    if (alreadyDraftThisWeek.length > 0) {
      const ok = confirm(
        `Já existem ${alreadyDraftThisWeek.length} shifts em rascunho nessa semana/área.\n\nQuer duplicar mesmo assim? (Pode criar duplicados)`
      );
      if (!ok) return;
    }

    const prevPublished = allShifts.filter(
      (s) =>
        s.weekStart === prevWeekStart &&
        s.area === activeArea &&
        s.status === "PUBLISHED" &&
        s.date >= prevWeekStart &&
        s.date <= prevEnd
    );
    const prevDraft = allShifts.filter(
      (s) =>
        s.weekStart === prevWeekStart &&
        s.area === activeArea &&
        s.status === "DRAFT" &&
        s.date >= prevWeekStart &&
        s.date <= prevEnd
    );

    const source = prevPublished.length > 0 ? prevPublished : prevDraft;

    if (source.length === 0) {
      alert("Não achei shifts na semana passada para duplicar (nem PUBLISHED nem DRAFT).");
      return;
    }

    for (const s of source) {
      const newDate = addDaysISO(s.date, 7);
      await createShift({
        weekStart,
        date: newDate,
        start: s.start,
        end: s.end,
        area: activeArea,
        role: s.role,
        employeeUid: s.employeeUid || "",
        employeeName: s.employeeName,
        employeeEmail: s.employeeEmail || "",
        status: "DRAFT",
      });
    }

    alert(`✅ Duplicado! (${source.length} shifts)`);
    await refresh();
  }

  function openModalForShift(s: Shift) {
    setTargetShift(s);
    setRequestType(null);
    setSwapMyShiftId("");
    setNote("");
    setOpenRequestModal(true);
  }

  async function submitRequest() {
    if (!targetShift?.id) return;
    if (!requestType) return;

    if (!targetShift.employeeEmail) {
      alert("Esse funcionário ainda não tem email cadastrado no sistema. (Ainda sem conta)");
      return;
    }

    const same =
      targetShift.employeeUid === session.authUid ||
      (targetShift.employeeEmail || "").toLowerCase() === session.email.toLowerCase();
    if (same) {
      alert("Você já é dono desse shift.");
      return;
    }

    if (requestType === "SWAP" && !swapMyShiftId) {
      alert("Selecione qual shift seu você quer oferecer na troca.");
      return;
    }

    setSending(true);
    try {
      await createShiftRequest({
        type: requestType,
        weekStart,
        area: activeArea,

        requesterUid: session.authUid,
        requesterName: session.name,
        requesterEmail: session.email,

        targetUid: targetShift.employeeUid || "",
        targetName: targetShift.employeeName,
        targetEmail: targetShift.employeeEmail,

        targetShiftId: targetShift.id!,
        requesterShiftId: requestType === "SWAP" ? swapMyShiftId : undefined,
        note: note.trim(),
      });

      // 📧 notifica o alvo do pedido (troca/pegar)
      await sendAppEmail("swap_requested", {
        targetEmail: (targetShift.employeeEmail || "").toLowerCase(),
        targetName: targetShift.employeeName,
        requesterName: session.name,
        requesterEmail: session.email,
        type: requestType,
        note: note.trim(),
      });

      alert("✅ Pedido enviado! (Veja na aba Trocas)");
      setOpenRequestModal(false);
    } catch (e: any) {
      alert("❌ Erro ao enviar pedido: " + (e?.message || "unknown"));
    } finally {
      setSending(false);
    }
  }

  async function addStaff() {
    const name = newEmpName.trim();
    if (!name) return alert("Nome é obrigatório.");

    await createStaff(name, newEmpArea);
    setNewEmpName("");
    setNewEmpArea("Front");
    const st = await listStaffByArea(activeArea);
    setStaff(st);
    alert("✅ Funcionário adicionado em staff.");
  }

  async function removeStaffMember(id: string) {
    const ok = confirm("Remover esse funcionário do sistema (staff)?");
    if (!ok) return;
    await removeStaff(id);
    const st = await listStaffByArea(activeArea);
    setStaff(st);
  }

  async function getStaffAvailabilityStatusForDate(st: StaffMember, isoDate: string) {
    const uid = st.claimedByUid || "";
    if (!uid) return null; // sem conta, não dá pra validar
    const eff = await getEffectiveAvailability(uid);
    const days = ((eff as any)?.days as DaysMap) || null;
    if (!days) return null;

    // isoDate -> dia da semana
    const [y, m, d] = isoDate.split("-").map(Number);
    const dt = new Date(y, m - 1, d, 12, 0, 0);
    const dayIdx = dt.getDay(); // 0=Dom
    const key = (["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const)[dayIdx];
    return (days as any)[key]?.status || null; // "OPEN" | "UNAVAILABLE"
  }

  return (
    <Card>
      <div
        style={{
          display: "flex",
          gap: 12,
          justifyContent: "space-between",
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <div>
          <h2 style={{ marginTop: 0, marginBottom: 6 }}>Escala da Semana</h2>
          <div style={{ opacity: 0.85, fontWeight: 800 }}>
            {formatMonthLabel(weekStart)} • Área: <span style={{ color: blue }}>{activeArea}</span>
            {session.isManager ? (
              <span>
                {" "}
                • Visualizando: <b>{managerView}</b>
              </span>
            ) : null}
          </div>
          <div style={{ marginTop: 6, fontSize: 13, opacity: 0.8 }}>
            Semana: <b>Segunda</b> → <b>Domingo</b>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button style={buttonSmallGhost} onClick={() => setWeekStart(addDaysISO(weekStart, -7))}>
            ← Semana
          </button>
          <button style={buttonSmallGhost} onClick={() => setWeekStart(startOfWeekISO(new Date()))}>
            Hoje
          </button>
          <button style={buttonSmallGhost} onClick={() => setWeekStart(addDaysISO(weekStart, 7))}>
            Semana →
          </button>
        </div>
      </div>

      {!session.isManager && (
        <div style={{ marginTop: 14 }}>
          <Segmented left="Meus shifts" right="Escala (colegas)" value={mode} onChange={setMode} />
          <div style={{ marginTop: 8, opacity: 0.8, fontSize: 13 }}>
            “Escala (colegas)” mostra você + colegas <b>somente</b> da sua área, e somente quando publicado.
          </div>
        </div>
      )}

      {session.isManager && (
        <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <TabButton active={managerArea === "Front"} onClick={() => setManagerArea("Front")}>
            Front (salão)
          </TabButton>
          <TabButton active={managerArea === "Back"} onClick={() => setManagerArea("Back")}>
            Back (cozinha)
          </TabButton>

          <TabButton active={managerView === "DRAFT"} onClick={() => setManagerView("DRAFT")}>
            Rascunho
          </TabButton>
          <TabButton active={managerView === "PUBLISHED"} onClick={() => setManagerView("PUBLISHED")}>
            Publicado
          </TabButton>

          <button style={buttonSmallGhost} onClick={refresh}>
            Atualizar
          </button>

          {managerView === "DRAFT" ? (
            <>
              <button style={buttonSmallGhost} onClick={duplicateLastWeekDraft}>
                Duplicar semana passada (rascunho)
              </button>
              <button style={buttonSmallPrimary} onClick={publishWeek}>
                Publicar semana (área {activeArea})
              </button>
            </>
          ) : (
            <div style={{ fontSize: 13, opacity: 0.85 }}>
              Para mudar a escala publicada: vá em <b>Rascunho</b>, crie/edite e publique — o publicado antigo será
              substituído.
            </div>
          )}
        </div>
      )}

      <div
        style={
          isMobile
            ? {
                marginTop: 16,
                display: "flex",
                gap: 10,
                overflowX: "auto",
                paddingBottom: 8,
                scrollSnapType: "x mandatory",
                WebkitOverflowScrolling: "touch" as any,
              }
            : {
                marginTop: 16,
                display: "grid",
                gridTemplateColumns: "repeat(7, 1fr)",
                gap: 10,
              }
        }
      >
        {weekDays.map((d) => {
          const isToday = d === todayISO();
          return (
            <div
              key={d}
              style={{
                padding: 10,
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.10)",
                background: isToday ? "rgba(63,169,245,0.18)" : "rgba(255,255,255,0.04)",
                minHeight: 170,
                ...(isMobile
                  ? {
                      minWidth: 260,
                      flex: "0 0 260px",
                      scrollSnapAlign: "start",
                    }
                  : {}),
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <div style={{ fontWeight: 900 }}>{shortDowPT(d)}</div>
                <div style={{ opacity: 0.8 }}>{d.slice(8, 10)}</div>
              </div>

              <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                {(shiftsByDay[d] || []).slice(0, 6).map((s) => {
                  const isMine =
                    s.employeeUid === session.authUid ||
                    (s.employeeEmail || "").toLowerCase() === session.email.toLowerCase();

                  const canRequest = !session.isManager && mode === "AREA" && !isMine && !!s.employeeEmail;

                  return (
                    <div
                      key={s.id}
                      style={{
                        padding: 8,
                        borderRadius: 10,
                        border: "1px solid rgba(255,255,255,0.10)",
                        background: "rgba(0,0,0,0.18)",
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 900 }}>
                        {s.start}–{s.end}
                      </div>

                      <div style={{ fontSize: 12, opacity: 0.9, marginTop: 2, wordBreak: "break-word" }}>
                        {s.role}
                        {session.isManager || mode === "AREA" ? <span style={{ opacity: 0.85 }}> • {s.employeeName}</span> : null}
                      </div>

                      {session.isManager && s.id && managerView === "DRAFT" && (
                        <button
                          style={{ ...buttonTiny, marginTop: 6 }}
                          onClick={async () => {
                            await deleteShift(s.id!);
                            await refresh();
                          }}
                        >
                          Apagar
                        </button>
                      )}

                      {canRequest && s.id && (
                        <button style={{ ...buttonTiny, marginTop: 6 }} onClick={() => openModalForShift(s)}>
                          Pedir troca / pegar
                        </button>
                      )}

                      {!session.isManager && mode === "AREA" && !isMine && !s.employeeEmail ? (
                        <div style={{ marginTop: 6, fontSize: 11, opacity: 0.75 }}>(Funcionário ainda sem conta)</div>
                      ) : null}
                    </div>
                  );
                })}

                {(shiftsByDay[d] || []).length > 6 ? (
                  <div style={{ fontSize: 12, opacity: 0.7 }}>+{(shiftsByDay[d] || []).length - 6} mais…</div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {session.isManager && managerView === "DRAFT" && (
        <div
          style={{
            marginTop: 16,
            padding: 12,
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.10)",
            background: "rgba(255,255,255,0.04)",
          }}
        >
          <div style={{ fontWeight: 900, marginBottom: 10 }}>Criar shift (rascunho)</div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
            <div>
              <label style={labelStyle}>Data</label>
              <select style={selectStyle} value={addDate} onChange={(e) => setAddDate(e.target.value)}>
                {weekDays.map((dd) => (
                  <option key={dd} value={dd}>
                    {dd}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Início</label>
              <input style={inputStyle} type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>

            <div>
              <label style={labelStyle}>Fim</label>
              <input style={inputStyle} type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>

            <div>
              <label style={labelStyle}>Posição</label>
              <input style={inputStyle} value={role} onChange={(e) => setRole(e.target.value)} />
            </div>
          </div>

          <div style={{ marginTop: 10 }}>
            <label style={labelStyle}>Funcionário (staff — {activeArea})</label>
            <select style={selectStyle} value={employeeStaffId} onChange={(e) => setEmployeeStaffId(e.target.value)}>
              <option value="" disabled>
                Selecione...
              </option>
              {staff.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.email ? ` • ${p.email}` : " • (sem email)"}
                  {p.claimedByUid ? "" : " • (não claimed)"}
                </option>
              ))}
            </select>
          </div>

          <button
            style={{ ...buttonPrimary, marginTop: 14 }}
            onClick={async () => {
              if (!employeeStaffId) return alert("Selecione um funcionário.");
              const st = staff.find((x) => x.id === employeeStaffId);
              if (!st) return alert("Staff não encontrado.");

              if (st.claimedByUid && isDayOffApproved(st.claimedByUid, addDate)) {
                return alert("Esse funcionário tem folga APROVADA nesse dia. Não dá pra agendar.");
              }

              // ✅ alerta de exceção (disponibilidade UNAVAILABLE)
              const avStatus = await getStaffAvailabilityStatusForDate(st, addDate);
              if (avStatus === "UNAVAILABLE") {
                const ok = confirm(
                  `⚠️ EXCEÇÃO: ${st.name} está marcado como UNAVAILABLE nesse dia.\n\nQuer criar o shift mesmo assim?`
                );
                if (!ok) return;
              }

              await createShift({
                weekStart,
                date: addDate,
                start,
                end,
                area: activeArea,
                role,
                employeeUid: st.claimedByUid || "",
                employeeName: st.name,
                employeeEmail: (st.email || "").toLowerCase(),
                status: "DRAFT",
              });

              await refresh();
              alert("✅ Shift criado em rascunho!");
            }}
          >
            Criar shift (rascunho)
          </button>

          <div style={{ marginTop: 10, opacity: 0.8, fontSize: 13 }}>
            Dica: você pode criar rascunho em qualquer semana futura. (A data do shift precisa estar dentro da semana
            selecionada)
          </div>
        </div>
      )}

      {/* MANAGER: STAFF */}
      {session.isManager && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontWeight: 900, marginBottom: 10 }}>Funcionários (staff)</div>

          <div style={rowCard}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Adicionar funcionário</div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 180px", gap: 10 }}>
              <div>
                <label style={labelStyle}>Nome</label>
                <input style={inputStyle} value={newEmpName} onChange={(e) => setNewEmpName(e.target.value)} />
              </div>
              <div>
                <label style={labelStyle}>Área</label>
                <select style={selectStyle} value={newEmpArea} onChange={(e) => setNewEmpArea(e.target.value as any)}>
                  <option value="Front">Front</option>
                  <option value="Back">Back</option>
                </select>
              </div>
            </div>

            <button style={{ ...buttonSmallPrimary, marginTop: 12 }} onClick={addStaff}>
              Adicionar
            </button>

            <div style={{ marginTop: 8, opacity: 0.8, fontSize: 13 }}>
              O gerente cria só <b>nome + área</b>. O funcionário claim depois pelo email.
            </div>
          </div>

          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            {staff.length === 0 ? (
              <div style={{ opacity: 0.85 }}>Nenhum funcionário cadastrado nessa área.</div>
            ) : (
              staff.map((p) => (
                <div key={p.id} style={rowCard}>
                  <div style={{ fontWeight: 900 }}>
                    {p.name} • Área: <span style={{ color: blue }}>{p.area}</span> • {p.email ? p.email : "(sem email)"}{" "}
                    {p.claimedByUid ? "• (claimed)" : "• (não claimed)"}
                  </div>
                  <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button style={buttonSmallGhost} onClick={() => removeStaffMember(p.id)}>
                      Remover
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* MODAL troca/pegar */}
      {openRequestModal && targetShift && (
        <Modal onClose={() => setOpenRequestModal(false)}>
          <h2 style={{ marginTop: 0, marginBottom: 8 }}>Pedido de shift</h2>

          <div style={{ opacity: 0.9, marginBottom: 10 }}>
            <b>{shortDowPT(targetShift.date)}</b> • {targetShift.date} • {targetShift.start}–{targetShift.end} •{" "}
            <b>{targetShift.role}</b> • {targetShift.employeeName}
          </div>

          {!requestType ? (
            <div style={{ display: "grid", gap: 10 }}>
              <button style={buttonSmallPrimary} onClick={() => setRequestType("TAKE")}>
                ✅ Quero pegar esse shift
              </button>

              <button style={buttonSmallGhost} onClick={() => setRequestType("SWAP")}>
                🔁 Quero trocar com um shift meu
              </button>

              <button style={buttonSmallGhost} onClick={() => setOpenRequestModal(false)}>
                Cancelar
              </button>
            </div>
          ) : (
            <>
              {requestType === "SWAP" ? (
                <div style={{ marginTop: 10 }}>
                  <label style={labelStyle}>Selecione qual shift seu você quer oferecer:</label>
                  <select style={selectStyle} value={swapMyShiftId} onChange={(e) => setSwapMyShiftId(e.target.value)}>
                    <option value="">Selecione...</option>
                    {myPublishedShiftsThisWeek.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.date} • {shortDowPT(s.date)} • {s.start}-{s.end} • {s.role}
                      </option>
                    ))}
                  </select>

                  {myPublishedShiftsThisWeek.length === 0 ? (
                    <div style={{ marginTop: 8, opacity: 0.85, fontSize: 13 }}>
                      Você não tem shifts publicados nessa semana para oferecer em troca.
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div style={{ marginTop: 10 }}>
                <label style={labelStyle}>Nota (opcional)</label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  style={{ ...inputStyle, minHeight: 90, resize: "vertical" as any }}
                  placeholder="Ex: posso cobrir esse turno, preciso folgar no outro..."
                />
              </div>

              <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
                <button
                  style={buttonSmallPrimary}
                  onClick={submitRequest}
                  disabled={sending || (requestType === "SWAP" && myPublishedShiftsThisWeek.length === 0)}
                >
                  {sending ? "Enviando..." : "Enviar pedido"}
                </button>

                <button
                  style={buttonSmallGhost}
                  onClick={() => {
                    setRequestType(null);
                    setSwapMyShiftId("");
                    setNote("");
                  }}
                  disabled={sending}
                >
                  Voltar
                </button>

                <button style={buttonSmallGhost} onClick={() => setOpenRequestModal(false)} disabled={sending}>
                  Cancelar
                </button>
              </div>

              <div style={{ marginTop: 10, opacity: 0.8, fontSize: 13 }}>
                Fluxo: você pede → colega aprova → gerente aprova → escala atualiza.
              </div>
            </>
          )}
        </Modal>
      )}
    </Card>
  );
}

/* -------------------- TROCAS -------------------- */

function SwapsTab({ session }: { session: Session }) {
  const [loading, setLoading] = useState(true);
  const [all, setAll] = useState<ShiftRequest[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);

  async function refresh() {
    setLoading(true);
    try {
      const [r, s] = await Promise.all([listAllShiftRequests(), listAllShifts()]);
      setAll(r);
      setShifts(s);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const incoming = useMemo(() => {
    if (session.isManager) return [];
    return all.filter(
      (r) => r.targetEmail?.toLowerCase() === session.email.toLowerCase() && r.status === "PENDING_TARGET"
    );
  }, [all, session.isManager, session.email]);

  // ✅ aqui: CANCELLED não aparece
  const outgoing = useMemo(() => {
    if (session.isManager) return [];
    return all
      .filter((r) => r.requesterEmail?.toLowerCase() === session.email.toLowerCase())
      .filter((r) => r.status !== "CANCELLED")
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  }, [all, session.isManager, session.email]);

  const managerQueue = useMemo(() => {
    if (!session.isManager) return [];
    return all.filter((r) => r.status === "PENDING_MANAGER");
  }, [all, session.isManager]);

  function getShiftById(id: string) {
    return shifts.find((s) => s.id === id) || null;
  }

  async function approveByTarget(req: ShiftRequest) {
    await updateShiftRequest(req.id!, { status: "PENDING_MANAGER" });

    // 📧 notifica gerente
    await sendAppEmail("swap_needs_manager", {
      requesterName: req.requesterName,
      requesterEmail: req.requesterEmail,
      targetName: req.targetName,
      targetEmail: req.targetEmail,
      managerEmail: MANAGER_EMAIL,
    });

    alert("✅ Você aprovou. Agora vai para o gerente aprovar.");
    await refresh();
  }

  async function rejectByTarget(req: ShiftRequest) {
    await updateShiftRequest(req.id!, { status: "REJECTED_BY_TARGET" });
    alert("❌ Você rejeitou.");
    await refresh();
  }

  async function cancelByRequester(req: ShiftRequest) {
    const ok = confirm("Cancelar esse pedido?");
    if (!ok) return;
    await updateShiftRequest(req.id!, { status: "CANCELLED" });
    await refresh();
    alert("✅ Pedido cancelado.");
  }

  async function approveByManager(req: ShiftRequest) {
    const targetShift = getShiftById(req.targetShiftId);
    if (!targetShift || !targetShift.id) return alert("Shift alvo não encontrado.");

    if (targetShift.status !== "PUBLISHED") {
      return alert("Esse shift não está publicado. Publique a escala antes de finalizar trocas.");
    }

    if (req.type === "TAKE") {
      await updateShift(targetShift.id!, {
        employeeUid: req.requesterUid,
        employeeName: req.requesterName,
        employeeEmail: req.requesterEmail,
      });
      await updateShiftRequest(req.id!, { status: "APPROVED_BY_MANAGER" });

      // 📧 notifica as duas partes
      await sendAppEmail("swap_manager_decision", {
        requesterName: req.requesterName,
        requesterEmail: req.requesterEmail,
        targetName: req.targetName,
        targetEmail: req.targetEmail,
        status: "APPROVED_BY_MANAGER",
      });

      alert("✅ Aprovado! Shift transferido.");
      await refresh();
      return;
    }

    const requesterShift = req.requesterShiftId ? getShiftById(req.requesterShiftId) : null;
    if (!requesterShift || !requesterShift.id) return alert("Shift do requester (troca) não encontrado.");
    if (requesterShift.status !== "PUBLISHED") return alert("O shift do requester não está publicado.");

    const a = {
      employeeUid: targetShift.employeeUid,
      employeeName: targetShift.employeeName,
      employeeEmail: targetShift.employeeEmail,
    };
    const b = {
      employeeUid: requesterShift.employeeUid,
      employeeName: requesterShift.employeeName,
      employeeEmail: requesterShift.employeeEmail,
    };

    await updateShift(targetShift.id!, b);
    await updateShift(requesterShift.id!, a);

    await updateShiftRequest(req.id!, { status: "APPROVED_BY_MANAGER" });

    // 📧 notifica as duas partes
    await sendAppEmail("swap_manager_decision", {
      requesterName: req.requesterName,
      requesterEmail: req.requesterEmail,
      targetName: req.targetName,
      targetEmail: req.targetEmail,
      status: "APPROVED_BY_MANAGER",
    });

    alert("✅ Aprovado! Troca aplicada.");
    await refresh();
  }

  async function rejectByManager(req: ShiftRequest) {
    await updateShiftRequest(req.id!, { status: "REJECTED_BY_MANAGER" });

    // 📧 notifica requester/target
    await sendAppEmail("swap_manager_decision", {
      requesterName: req.requesterName,
      requesterEmail: req.requesterEmail,
      targetName: req.targetName,
      targetEmail: req.targetEmail,
      status: "REJECTED_BY_MANAGER",
    });

    alert("❌ Rejeitado pelo gerente.");
    await refresh();
  }

  return (
    <Card>
      <h2 style={{ marginTop: 0 }}>Trocas & Pedidos</h2>
      <p style={{ opacity: 0.85, marginTop: 6 }}>
        Fluxo: funcionário pede → outro funcionário aprova → gerente aprova → escala atualiza.
      </p>

      <button style={buttonSmallGhost} onClick={refresh}>
        Atualizar
      </button>

      {loading ? (
        <p style={{ marginTop: 10 }}>Carregando...</p>
      ) : session.isManager ? (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>Fila do gerente</div>
          {managerQueue.length === 0 ? (
            <p style={{ opacity: 0.85 }}>Nenhum pedido aguardando gerente.</p>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {managerQueue.map((r) => {
                const targetShift = getShiftById(r.targetShiftId);
                const reqShift = r.requesterShiftId ? getShiftById(r.requesterShiftId) : null;

                return (
                  <div key={r.id} style={rowCard}>
                    <div style={{ fontWeight: 900 }}>{r.type === "TAKE" ? "PEDIDO: PEGAR SHIFT" : "PEDIDO: TROCA"}</div>

                    <div style={{ marginTop: 8, opacity: 0.9 }}>
                      <b>Requester:</b> {r.requesterName} • {r.requesterEmail}
                    </div>
                    <div style={{ marginTop: 6, opacity: 0.9 }}>
                      <b>Target:</b> {r.targetName} • {r.targetEmail}
                    </div>

                    <div style={{ marginTop: 10, opacity: 0.9 }}>
                      <b>Shift alvo:</b>{" "}
                      {targetShift
                        ? `${targetShift.date} ${targetShift.start}-${targetShift.end} (${targetShift.role}) • ${targetShift.area}`
                        : "não encontrado"}
                    </div>

                    {r.type === "SWAP" && (
                      <div style={{ marginTop: 6, opacity: 0.9 }}>
                        <b>Shift do requester:</b>{" "}
                        {reqShift ? `${reqShift.date} ${reqShift.start}-${reqShift.end} (${reqShift.role}) • ${reqShift.area}` : "não encontrado"}
                      </div>
                    )}

                    {r.note ? (
                      <div style={{ marginTop: 8, opacity: 0.85 }}>
                        <b>Nota:</b> {r.note}
                      </div>
                    ) : null}

                    <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
                      <button style={buttonSmallPrimary} onClick={() => approveByManager(r)}>
                        Aprovar
                      </button>
                      <button style={buttonSmallGhost} onClick={() => rejectByManager(r)}>
                        Rejeitar
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <>
          <div style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 900, marginBottom: 8 }}>Pedidos para você aprovar</div>
            {incoming.length === 0 ? (
              <p style={{ opacity: 0.85 }}>Nenhum pedido pendente.</p>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {incoming.map((r) => {
                  const targetShift = getShiftById(r.targetShiftId);
                  const reqShift = r.requesterShiftId ? getShiftById(r.requesterShiftId) : null;

                  return (
                    <div key={r.id} style={rowCard}>
                      <div style={{ fontWeight: 900 }}>{r.type === "TAKE" ? "PEDIDO: PEGAR SEU SHIFT" : "PEDIDO: TROCAR SHIFT"}</div>

                      <div style={{ marginTop: 8, opacity: 0.9 }}>
                        <b>Quem pediu:</b> {r.requesterName} • {r.requesterEmail}
                      </div>

                      <div style={{ marginTop: 10, opacity: 0.9 }}>
                        <b>Seu shift:</b>{" "}
                        {targetShift ? `${targetShift.date} ${targetShift.start}-${targetShift.end} (${targetShift.role})` : "não encontrado"}
                      </div>

                      {r.type === "SWAP" && (
                        <div style={{ marginTop: 6, opacity: 0.9 }}>
                          <b>Shift oferecido:</b>{" "}
                          {reqShift ? `${reqShift.date} ${reqShift.start}-${reqShift.end} (${reqShift.role})` : "não encontrado"}
                        </div>
                      )}

                      {r.note ? (
                        <div style={{ marginTop: 8, opacity: 0.85 }}>
                          <b>Nota:</b> {r.note}
                        </div>
                      ) : null}

                      <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
                        <button style={buttonSmallPrimary} onClick={() => approveByTarget(r)}>
                          Aceitar
                        </button>
                        <button style={buttonSmallGhost} onClick={() => rejectByTarget(r)}>
                          Rejeitar
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ marginTop: 18 }}>
            <div style={{ fontWeight: 900, marginBottom: 8 }}>Pedidos que você enviou</div>
            {outgoing.length === 0 ? (
              <p style={{ opacity: 0.85 }}>Você ainda não enviou pedidos (ou os cancelados não aparecem).</p>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {outgoing.map((r) => (
                  <div key={r.id} style={rowCard}>
                    <div style={{ fontWeight: 900 }}>
                      {r.type === "TAKE" ? "Pegar shift" : "Troca"} • Status: <span style={{ opacity: 0.9 }}>{statusPT(r.status)}</span>
                    </div>
                    <div style={{ marginTop: 6, opacity: 0.85 }}>
                      Com: {r.targetName} • {r.targetEmail}
                    </div>
                    {r.note ? (
                      <div style={{ marginTop: 8, opacity: 0.85 }}>
                        <b>Nota:</b> {r.note}
                      </div>
                    ) : null}

                    {["PENDING_TARGET", "PENDING_MANAGER"].includes(r.status) ? (
                      <div style={{ marginTop: 10 }}>
                        <button style={buttonSmallGhost} onClick={() => cancelByRequester(r)}>
                          Cancelar pedido
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

/* -------------------- AVAILABILITY (employee) -------------------- */

function AvailabilityTabEmployee({ session }: { session: Session }) {
  const [effective, setEffective] = useState<DaysMap | null>(null);
  const [draft, setDraft] = useState<DaysMap>(DEFAULT_DAYS);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  const [myRequests, setMyRequests] = useState<any[]>([]);

  async function loadEffective() {
    setLoading(true);
    try {
      const data = await getEffectiveAvailability(session.authUid);
      const days = ((data as any)?.days as DaysMap) || null;

      setEffective(days);
      setDraft(days || DEFAULT_DAYS);

      const reqs = await listAvailabilityRequestsByUid(session.authUid);
      setMyRequests(reqs.filter((r: any) => r.status !== "CANCELLED"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadEffective();
  }, [session.authUid]);

  async function cancelAvailability(reqId: string) {
    const ok = confirm("Cancelar esse pedido de disponibilidade?");
    if (!ok) return;
    await updateAvailabilityRequest(reqId, { status: "CANCELLED" });
    await loadEffective();
    alert("✅ Pedido cancelado (não aparece mais).");
  }

  return (
    <Card>
      <h2 style={{ marginTop: 0 }}>Disponibilidade</h2>

      <p style={{ opacity: 0.85, marginTop: 8 }}>
        Padrão: tudo <b>Open</b>. Se você alterar, vira um <b>pedido</b> e precisa aprovação do gerente.
      </p>

      {loading ? (
        <p>Carregando...</p>
      ) : (
        <>
          <div style={{ marginTop: 10, opacity: 0.9 }}>
            <div style={{ fontWeight: 900, marginBottom: 6 }}>Disponibilidade oficial (effective)</div>
            <div style={{ fontSize: 13, opacity: 0.85 }}>
              {effective ? summarizeDays(effective) : "Ainda não definida (assumindo Open em todos os dias)"}
            </div>
          </div>

          <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
            {(Object.keys(DEFAULT_DAYS) as (keyof DaysMap)[]).map((k) => (
              <div
                key={k}
                style={{
                  display: "grid",
                  gridTemplateColumns: "70px 1fr 220px",
                  gap: 10,
                  alignItems: "center",
                }}
              >
                <div style={{ fontWeight: 900 }}>{DAY_LABEL[k]}</div>

                <select
                  value={draft[k].status}
                  onChange={(e) => setDraft((prev) => ({ ...prev, [k]: { status: e.target.value as any } }))}
                  style={selectStyle}
                >
                  <option value="OPEN">Open</option>
                  <option value="UNAVAILABLE">Unavailable</option>
                </select>

                <div style={{ fontSize: 13, opacity: 0.85, textAlign: "right" }}>
                  Atual: <b>{(effective || DEFAULT_DAYS)[k].status === "OPEN" ? "Open" : "Unavailable"}</b>
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 10, fontSize: 13, opacity: 0.9 }}>
            <b>Resumo do pedido:</b> {summarizeDays(draft)}
          </div>

          <button
            onClick={async () => {
              setMsg("");
              try {
                await createAvailabilityRequest({
                  uid: session.authUid,
                  employeeEmail: session.email,
                  employeeName: session.name,
                  proposedDays: draft,
                  managerEmail: MANAGER_EMAIL,
                });

                // 📧 notifica gerente
                await sendAppEmail("availability_pending", {
                  employeeName: session.name,
                  employeeEmail: session.email,
                  managerEmail: MANAGER_EMAIL,
                  summary: summarizeDays(draft),
                });
                setMsg("✅ Pedido enviado para aprovação do gerente.");
                await loadEffective();
              } catch (e: any) {
                setMsg("❌ Erro ao enviar pedido: " + (e?.message || "unknown"));
              }
            }}
            style={buttonPrimary}
          >
            Enviar alteração (vai para aprovação)
          </button>

          {msg && <p style={{ marginTop: 10, opacity: 0.9 }}>{msg}</p>}

          <div style={{ marginTop: 18 }}>
            <div style={{ fontWeight: 900, marginBottom: 8 }}>Meus pedidos</div>
            {myRequests.length === 0 ? (
              <p style={{ opacity: 0.85 }}>Nenhum pedido ainda.</p>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {myRequests.map((r) => (
                  <div key={r.id} style={rowCard}>
                    <div style={{ fontWeight: 900 }}>
                      Status: <span style={{ opacity: 0.9 }}>{statusPT(r.status)}</span>
                    </div>
                    <div style={{ marginTop: 6, opacity: 0.85, fontSize: 13 }}>
                      {r.proposedDays ? summarizeDays(r.proposedDays as DaysMap) : "(sem detalhes)"}
                    </div>

                    {r.status === "PENDING" ? (
                      <div style={{ marginTop: 10 }}>
                        <button style={buttonSmallGhost} onClick={() => cancelAvailability(r.id)}>
                          Cancelar pedido
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

/* -------------------- AVAILABILITY (manager) -------------------- */

function AvailabilityTabManager({ session }: { session: Session }) {
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<any[]>([]);
  const [recent, setRecent] = useState<any[]>([]);

  async function refresh() {
    setLoading(true);
    try {
      const all = await listAvailabilityRequestsForManager(session.email);
      const pend = all
        .filter((r: any) => r.status === "PENDING")
        .sort((a: any, b: any) => (b.createdAt || "").localeCompare(a.createdAt || ""));
      setPending(pend);
      setRecent(
        all
          .filter((r: any) => r.status !== "PENDING" && r.status !== "CANCELLED")
          .sort((a: any, b: any) => (b.updatedAt || b.createdAt || "").localeCompare(a.updatedAt || a.createdAt || ""))
          .slice(0, 12)
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [session.email]);

  async function approve(req: any) {
    const ok = confirm(
      `Aprovar disponibilidade de ${req.employeeName}?\n\n${req.proposedDays ? summarizeDays(req.proposedDays as DaysMap) : "(sem detalhes)"}\n\nIsso vai SUBSTITUIR a disponibilidade antiga.`
    );
    if (!ok) return;

    // grava a disponibilidade "effective" (substitui a antiga)
    await setDoc(
      doc(db, "availability", req.uid),
      {
        uid: req.uid,
        employeeEmail: req.employeeEmail,
        employeeName: req.employeeName,
        days: req.proposedDays || DEFAULT_DAYS,
        managerEmail: session.email,
        updatedAt: serverTimestamp(),
        fromRequestId: req.id,
      },
      { merge: true }
    );

    await updateAvailabilityRequest(req.id, {
      status: "APPROVED",
      decidedBy: session.email,
      decidedAt: serverTimestamp(),
    });

    // 📧 notifica funcionário
    await sendAppEmail("availability_decision", {
      employeeName: req.employeeName,
      employeeEmail: req.employeeEmail,
      status: "APPROVED",
      summary: req.proposedDays ? summarizeDays(req.proposedDays as DaysMap) : summarizeDays(DEFAULT_DAYS),
    });

    alert("✅ Aprovado e aplicado (disponibilidade substituída).");
    await refresh();
  }

  async function reject(req: any) {
    const ok = confirm(`Rejeitar pedido de ${req.employeeName}?`);
    if (!ok) return;

    await updateAvailabilityRequest(req.id, {
      status: "REJECTED",
      decidedBy: session.email,
      decidedAt: serverTimestamp(),
    });

    // 📧 notifica funcionário
    await sendAppEmail("availability_decision", {
      employeeName: req.employeeName,
      employeeEmail: req.employeeEmail,
      status: "REJECTED",
      summary: req.proposedDays ? summarizeDays(req.proposedDays as DaysMap) : summarizeDays(DEFAULT_DAYS),
    });

    alert("❌ Rejeitado.");
    await refresh();
  }

  return (
    <Card>
      <h2 style={{ marginTop: 0 }}>Disponibilidade (Gerente)</h2>
      <p style={{ opacity: 0.85, marginTop: 6 }}>
        Aqui você aprova/rejeita pedidos. Ao aprovar, a nova disponibilidade vira a oficial e <b>substitui</b> a antiga.
      </p>

      <button style={buttonSmallGhost} onClick={refresh}>
        Atualizar
      </button>

      {loading ? (
        <p style={{ marginTop: 10 }}>Carregando...</p>
      ) : (
        <>
          <div style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 900, marginBottom: 8 }}>Pendentes</div>
            {pending.length === 0 ? (
              <p style={{ opacity: 0.85 }}>Nenhum pedido pendente.</p>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {pending.map((r: any) => (
                  <div key={r.id} style={rowCard}>
                    <div style={{ fontWeight: 900 }}>
                      {r.employeeName} • {r.employeeEmail}
                    </div>

                    <div style={{ marginTop: 8, opacity: 0.9, fontSize: 13 }}>
                      <b>Pedido:</b> {r.proposedDays ? summarizeDays(r.proposedDays as DaysMap) : "(sem detalhes)"}
                    </div>

                    <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
                      <button style={buttonSmallPrimary} onClick={() => approve(r)}>
                        Aprovar (substituir)
                      </button>
                      <button style={buttonSmallGhost} onClick={() => reject(r)}>
                        Rejeitar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ marginTop: 18 }}>
            <div style={{ fontWeight: 900, marginBottom: 8 }}>Recentes (aprovados/rejeitados)</div>
            {recent.length === 0 ? (
              <p style={{ opacity: 0.85 }}>Nada recente.</p>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {recent.map((r: any) => (
                  <div key={r.id} style={rowCard}>
                    <div style={{ fontWeight: 900 }}>
                      {r.employeeName} • {r.employeeEmail} •{" "}
                      <span style={{ opacity: 0.9 }}>{statusPT(r.status)}</span>
                    </div>
                    <div style={{ marginTop: 6, opacity: 0.85, fontSize: 13 }}>
                      {r.proposedDays ? summarizeDays(r.proposedDays as DaysMap) : "(sem detalhes)"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

/* -------------------- TIME OFF -------------------- */

function TimeOffTab({ session }: { session: Session }) {
  const isManager = session.isManager;

  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<TimeOffRequest[]>([]);
  const [mine, setMine] = useState<TimeOffRequest[]>([]);
  const [msg, setMsg] = useState("");

  const [date, setDate] = useState(addDaysFromTodayISO(TIMEOFF_MIN_DAYS));
  const [type, setType] = useState<TimeOffType>("FULL");
  const [note, setNote] = useState("");

  async function refresh() {
    setLoading(true);
    try {
      const all = await listAllTimeOffRequests();

      if (isManager) {
        setPending(all.filter((r) => r.status === "PENDING").sort((a, b) => a.date.localeCompare(b.date)));
        setMine([]);
      } else {
        setMine(
          all
            .filter((r) => r.uid === session.authUid)
            .filter((r) => r.status !== "CANCELLED")
            .sort((a, b) => b.date.localeCompare(a.date))
        );
        setPending([]);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [session.authUid, isManager]);

  const minDate = addDaysFromTodayISO(TIMEOFF_MIN_DAYS);

  async function cancelTimeOff(req: TimeOffRequest) {
    const ok = confirm("Cancelar esse pedido de folga?");
    if (!ok) return;
    await updateDoc(doc(db, "timeoff_requests", req.id!), { status: "CANCELLED", updatedAt: serverTimestamp() });
    await refresh();
    alert("✅ Pedido cancelado (não aparece mais).");
  }

  return (
    <Card>
      <h2 style={{ marginTop: 0 }}>Folgas</h2>
      <p style={{ opacity: 0.85, marginTop: 6 }}>
        Regra: pedir folga com <b>{TIMEOFF_MIN_DAYS} dias</b> de antecedência. Precisa aprovação do gerente.
      </p>

      {!isManager && (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.10)",
            background: "rgba(255,255,255,0.04)",
          }}
        >
          <div style={{ fontWeight: 900, marginBottom: 10 }}>Pedir folga</div>

          <label style={labelStyle}>Data (mínimo {minDate})</label>
          <input style={inputStyle} type="date" value={date} min={minDate} onChange={(e) => setDate(e.target.value)} />

          <label style={labelStyle}>Tipo</label>
          <select style={selectStyle} value={type} onChange={(e) => setType(e.target.value as any)}>
            <option value="FULL">Dia inteiro</option>
            <option value="HALF_AM">Meio período (manhã)</option>
            <option value="HALF_PM">Meio período (tarde)</option>
          </select>

          <label style={labelStyle}>Nota (opcional)</label>
          <input style={inputStyle} value={note} onChange={(e) => setNote(e.target.value)} placeholder="ex: médico, viagem..." />

          <button
            style={buttonPrimary}
            onClick={async () => {
              setMsg("");
              if (!date) return setMsg("❌ Escolha uma data.");
              if (date < minDate) return setMsg(`❌ Precisa pedir com no mínimo ${TIMEOFF_MIN_DAYS} dias.`);

              try {
                await createTimeOffRequest({
                  uid: session.authUid,
                  employeeName: session.name,
                  employeeEmail: session.email,
                  date,
                  type,
                  note: note.trim(),
                });

                // 📧 notifica gerente
                await sendAppEmail("timeoff_pending", {
                  employeeName: session.name,
                  employeeEmail: session.email,
                  date,
                  type,
                  note: note.trim(),
                  managerEmail: MANAGER_EMAIL,
                });

                setMsg("✅ Pedido enviado!");
                setNote("");
                await refresh();
              } catch (e: any) {
                setMsg("❌ Erro: " + (e?.message || "unknown"));
              }
            }}
          >
            Enviar pedido
          </button>

          {msg && <p style={{ marginTop: 10, opacity: 0.9 }}>{msg}</p>}
        </div>
      )}

      {!isManager && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>Meus pedidos</div>
          {loading ? (
            <p>Carregando...</p>
          ) : mine.length === 0 ? (
            <p style={{ opacity: 0.85 }}>Nenhum pedido ainda.</p>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {mine.map((r) => (
                <div key={r.id} style={rowCard}>
                  <div style={{ fontWeight: 900 }}>
                    {r.date} • {labelTimeoffTypePT(r.type)} • <span style={{ opacity: 0.9 }}>{statusPT(r.status)}</span>
                  </div>
                  {r.note ? <div style={{ opacity: 0.85, marginTop: 6 }}>Nota: {r.note}</div> : null}

                  {r.status === "PENDING" ? (
                    <div style={{ marginTop: 10 }}>
                      <button style={buttonSmallGhost} onClick={() => cancelTimeOff(r)}>
                        Cancelar pedido
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {isManager && (
        <div style={{ marginTop: 12 }}>
          <h3 style={{ margin: 0 }}>Pedidos pendentes (Gerente)</h3>

          <button style={buttonSmallGhost} onClick={refresh}>
            Atualizar
          </button>

          {pending.length === 0 ? (
            <p style={{ marginTop: 10, opacity: 0.85 }}>Nenhum pedido pendente.</p>
          ) : (
            <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
              {pending.map((r) => (
                <div key={r.id} style={rowCard}>
                  <div style={{ fontWeight: 900 }}>
                    {r.employeeName} • {r.employeeEmail}
                  </div>
                  <div style={{ marginTop: 6, opacity: 0.9 }}>
                    <b>Pedido:</b> {r.date} • {labelTimeoffTypePT(r.type)}
                  </div>
                  {r.note ? <div style={{ opacity: 0.85, marginTop: 6 }}>Nota: {r.note}</div> : null}

                  <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
                    <button
                      style={buttonSmallPrimary}
                      onClick={async () => {
                        await approveTimeOff(r.id!, session.email);

                        // 📧 notifica funcionário
                        await sendAppEmail("timeoff_decision", {
                          employeeEmail: r.employeeEmail,
                          employeeName: r.employeeName,
                          status: "APPROVED",
                          date: r.date,
                          type: r.type,
                          note: r.note || "",
                        });

                        await refresh();
                        alert("✅ Aprovado!");
                      }}
                    >
                      Aprovar
                    </button>
                    <button
                      style={buttonSmallGhost}
                      onClick={async () => {
                        await rejectTimeOff(r.id!, session.email);

                        // 📧 notifica funcionário
                        await sendAppEmail("timeoff_decision", {
                          employeeEmail: r.employeeEmail,
                          employeeName: r.employeeName,
                          status: "REJECTED",
                          date: r.date,
                          type: r.type,
                          note: r.note || "",
                        });

                        await refresh();
                        alert("❌ Rejeitado!");
                      }}
                    >
                      Rejeitar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/* -------------------- Modal UI -------------------- */

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      onMouseDown={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: 16,
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 560,
          borderRadius: 14,
          border: "1px solid rgba(255,255,255,0.14)",
          background: "rgba(7,26,43,0.96)",
          padding: 16,
          color: text,
        }}
      >
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button style={buttonTiny} onClick={onClose}>
            X
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* -------------------- availability requests list/cancel -------------------- */

async function listAvailabilityRequestsByUid(uid: string): Promise<any[]> {
  const q = query(collection(db, "availability_requests"), where("uid", "==", uid), limit(50));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
}

async function listAvailabilityRequestsForManager(managerEmail: string): Promise<any[]> {
  const q = query(
    collection(db, "availability_requests"),
    where("managerEmail", "==", (managerEmail || "").toLowerCase()),
    limit(200)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
}

async function updateAvailabilityRequest(id: string, patch: any) {
  await updateDoc(doc(db, "availability_requests", id), { ...patch, updatedAt: serverTimestamp() });
}

/* -------------------- labels/helpers -------------------- */

function statusPT(s: string) {
  const map: Record<string, string> = {
    PENDING: "Pendente",
    APPROVED: "Aprovado",
    REJECTED: "Rejeitado",
    CANCELLED: "Cancelado",

    PENDING_TARGET: "Aguardando colega",
    REJECTED_BY_TARGET: "Rejeitado pelo colega",
    PENDING_MANAGER: "Aguardando gerente",
    REJECTED_BY_MANAGER: "Rejeitado pelo gerente",
    APPROVED_BY_MANAGER: "Aprovado pelo gerente",
  };
  return map[s] || s;
}

function labelTimeoffTypePT(t: TimeOffType) {
  if (t === "FULL") return "Dia inteiro";
  if (t === "HALF_AM") return "Meio período (manhã)";
  return "Meio período (tarde)";
}

// ====== DATE HELPERS (LOCAL SAFE) ======
// ✅ Nunca use toISOString() para datas de calendário (sem horário).
// Isso evita semana começando no dia errado por causa de UTC.

function toISODateLocal(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayISO() {
  return toISODateLocal(new Date());
}

function addDaysFromTodayISO(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toISODateLocal(d);
}

function addDaysISO(baseISO: string, days: number) {
  // usa meio-dia pra evitar bugs de DST
  const [y, m, da] = baseISO.split("-").map(Number);
  const d = new Date(y, m - 1, da, 12, 0, 0);
  d.setDate(d.getDate() + days);
  return toISODateLocal(d);
}

// ✅ semana começa segunda
function startOfWeekISO(date: Date) {
  // usa meio-dia pra evitar bugs de DST
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);
  const day = d.getDay(); // 0=Dom,1=Seg...
  const diff = day === 0 ? -6 : 1 - day; // se domingo, volta 6 dias
  d.setDate(d.getDate() + diff);
  return toISODateLocal(d);
}

function getWeekDays(weekStartISO: string) {
  return Array.from({ length: 7 }, (_, i) => addDaysISO(weekStartISO, i));
}

function shortDowPT(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d, 12, 0, 0);
  const names = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  return names[dt.getDay()];
}

function formatMonthLabel(weekStartISO: string) {
  const [y, m, d] = weekStartISO.split("-").map(Number);
  const dt = new Date(y, m - 1, d, 12, 0, 0);
  return dt.toLocaleString("pt-BR", { month: "long", year: "numeric" });
}

/* -------------------- UI -------------------- */

function Segmented({
  left,
  right,
  value,
  onChange,
}: {
  left: string;
  right: string;
  value: "MY" | "AREA";
  onChange: (v: "MY" | "AREA") => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        maxWidth: 520,
        borderRadius: 14,
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.10)",
        background: "rgba(255,255,255,0.05)",
      }}
    >
      <button
        onClick={() => onChange("MY")}
        style={{
          flex: 1,
          padding: "12px 14px",
          border: "none",
          cursor: "pointer",
          fontWeight: 900,
          background: value === "MY" ? "rgba(63,169,245,0.25)" : "transparent",
          color: text,
        }}
      >
        {left}
      </button>
      <button
        onClick={() => onChange("AREA")}
        style={{
          flex: 1,
          padding: "12px 14px",
          border: "none",
          cursor: "pointer",
          fontWeight: 900,
          background: value === "AREA" ? "rgba(63,169,245,0.25)" : "transparent",
          color: text,
        }}
      >
        {right}
      </button>
    </div>
  );
}

function Shell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: navy,
        color: text,
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto",
        padding: wide ? 28 : 18,
        display: "flex",
        justifyContent: "center",
      }}
    >
      {children}
    </main>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: "100%",
        padding: 18,
        borderRadius: 14,
        background: "rgba(255,255,255,0.06)",
        border: "1px solid rgba(255,255,255,0.10)",
      }}
    >
      {children}
    </div>
  );
}

function TabButton({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "10px 14px",
        borderRadius: 999,
        border: "1px solid rgba(255,255,255,0.12)",
        background: active ? blue : "rgba(255,255,255,0.06)",
        color: active ? "#001423" : text,
        cursor: "pointer",
        fontWeight: 900,
      }}
    >
      {children}
    </button>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  opacity: 0.85,
  display: "block",
  marginTop: 10,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  marginTop: 6,
  padding: "12px 12px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.25)",
  color: text,
  outline: "none",
};

const selectStyle: React.CSSProperties = {
  width: "100%",
  marginTop: 6,
  padding: "12px 12px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.25)",
  color: text,
  outline: "none",
};

const headerButton: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.06)",
  color: text,
  cursor: "pointer",
  fontWeight: 900,
  height: 44,
};

const buttonPrimary: React.CSSProperties = {
  width: "100%",
  padding: "12px 18px",
  borderRadius: 10,
  border: "none",
  cursor: "pointer",
  background: blue,
  color: "#001423",
  fontWeight: 900,
  fontSize: 16,
};

const buttonPrimaryAuto: React.CSSProperties = {
  padding: "12px 16px",
  borderRadius: 12,
  border: "none",
  cursor: "pointer",
  background: blue,
  color: "#001423",
  fontWeight: 900,
  fontSize: 15,
  width: "auto",
};

const buttonSmallPrimary: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "none",
  cursor: "pointer",
  background: blue,
  color: "#001423",
  fontWeight: 900,
};

const buttonSmallGhost: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.14)",
  cursor: "pointer",
  background: "rgba(255,255,255,0.06)",
  color: text,
  fontWeight: 900,
};

const buttonTiny: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.14)",
  cursor: "pointer",
  background: "rgba(255,255,255,0.06)",
  color: text,
  fontWeight: 900,
  fontSize: 12,
};

const rowCard: React.CSSProperties = {
  padding: 12,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.04)",
};

