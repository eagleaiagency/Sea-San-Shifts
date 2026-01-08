import { NextResponse } from "next/server";
import { getAdminDb, verifyFirebaseIdToken } from "@/lib/firebaseAdmin";
import { sendEmailBrevo } from "@/lib/brevo";

function safeEmail(e?: string) {
  return (e || "").trim().toLowerCase();
}
function escapeHtml(s: any) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function getAppConfig() {
  const db = getAdminDb();
  const snap = await db.doc("app_config/main").get();
  const data = snap.exists ? (snap.data() as any) : {};
  const appUrl = (data.appUrl || process.env.APP_URL || "").trim();
  const managerEmail = safeEmail(data.managerEmail);
  return { appUrl, managerEmail };
}

async function requireAuthEmail(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) throw new Error("Missing Authorization: Bearer <idToken>");
  const decoded = await verifyFirebaseIdToken(m[1]);
  return safeEmail(decoded.email || "");
}

export async function POST(req: Request) {
  try {
    const callerEmail = await requireAuthEmail(req);
    const body = (await req.json()) as any;
    const { action, payload } = body || {};

    const { appUrl, managerEmail } = await getAppConfig();
    if (!appUrl) throw new Error("Missing appUrl (set app_config/main.appUrl or APP_URL)");

    const link = (path: string) => `${appUrl}${path}`;

    // ======================================================
    // 1) SCHEDULE PUBLICADO (manda 1 email por funcionário)
    // ======================================================
    if (action === "schedule_published_week") {
      const { weekStart, area } = payload || {};
      if (!weekStart || !area) throw new Error("Missing weekStart/area");

      const db = getAdminDb();

      const shiftsSnap = await db
        .collection("shifts")
        .where("weekStart", "==", weekStart)
        .where("area", "==", area)
        .where("status", "==", "PUBLISHED")
        .get();

      const shifts = shiftsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      const byEmail = new Map<string, any[]>();

      for (const s of shifts) {
        const em = safeEmail(s.employeeEmail);
        if (!em) continue;
        if (!byEmail.has(em)) byEmail.set(em, []);
        byEmail.get(em)!.push(s);
      }

      for (const [em, list] of byEmail.entries()) {
        list.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
        byEmail.set(em, list);
      }

      const scheduleLink = link(`/dashboard?tab=week&weekStart=${encodeURIComponent(weekStart)}`);

      const jobs: Promise<any>[] = [];
      for (const [em, list] of byEmail.entries()) {
        const employeeName = list[0]?.employeeName || em.split("@")[0];

        const items = list
          .map(
            (s) =>
              `<li><b>${escapeHtml(s.date)}</b> • ${escapeHtml(s.start)}–${escapeHtml(s.end)} • ${escapeHtml(s.role || "")}</li>`
          )
          .join("");

        const subject = `📅 Sua escala da semana (${weekStart}) — ${area}`;
        const html = `
          <div style="font-family:system-ui;line-height:1.4">
            <h2>${escapeHtml(subject)}</h2>
            <p>Olá ${escapeHtml(employeeName)}, aqui estão <b>somente</b> os seus shifts desta semana:</p>
            <ul>${items}</ul>
            <p>
              <a href="${scheduleLink}" style="display:inline-block;padding:12px 14px;background:#3FA9F5;color:#001423;border-radius:10px;text-decoration:none;font-weight:800">
                Ver schedule completo
              </a>
            </p>
          </div>
        `;

        jobs.push(sendEmailBrevo({ to: [{ email: em, name: employeeName }], subject, html }));
      }

      // opcional: confirma pro gerente (se managerEmail estiver setado)
      if (managerEmail) {
        const subject = `✅ Escala publicada (${weekStart}) — ${area}`;
        const html = `
          <div style="font-family:system-ui;line-height:1.4">
            <h2>${escapeHtml(subject)}</h2>
            <p>Escala publicada. Funcionários notificados.</p>
            <p><a href="${scheduleLink}">Abrir no app</a></p>
          </div>
        `;
        jobs.push(sendEmailBrevo({ to: [{ email: managerEmail, name: "Gerente" }], subject, html }));
      }

      await Promise.allSettled(jobs);
      return NextResponse.json({ ok: true, notified: byEmail.size });
    }

    // ======================================================
    // 2) TROCA: pedido criado -> email para TARGET
    // ======================================================
    if (action === "swap_requested") {
      const { targetEmail, targetName, requesterName, requesterEmail, type, note } = payload || {};
      if (!targetEmail) throw new Error("Missing targetEmail");

      const swapsLink = link("/dashboard?tab=swaps");
      const subject =
        type === "TAKE" ? "📩 Pedido: alguém quer pegar um shift seu" : "📩 Pedido: alguém quer trocar shift com você";

      const html = `
        <div style="font-family:system-ui;line-height:1.4">
          <h2>${escapeHtml(subject)}</h2>
          <p><b>Quem pediu:</b> ${escapeHtml(requesterName)} (${escapeHtml(requesterEmail)})</p>
          ${note ? `<p><b>Nota:</b> ${escapeHtml(note)}</p>` : ""}
          <p>Entre no app para aceitar ou rejeitar:</p>
          <p>
            <a href="${swapsLink}" style="display:inline-block;padding:12px 14px;background:#3FA9F5;color:#001423;border-radius:10px;text-decoration:none;font-weight:800">
              Ver detalhes no app
            </a>
          </p>
        </div>
      `;

      await sendEmailBrevo({
        to: [{ email: safeEmail(targetEmail), name: targetName || "Funcionário" }],
        subject,
        html,
      });
      return NextResponse.json({ ok: true });
    }

    // ======================================================
    // 3) TROCA: alvo aceitou -> email para GERENTE aprovar
    // ======================================================
    if (action === "swap_needs_manager") {
      // se managerEmail não estiver configurado, tenta usar managerEmail passado no payload
      const fallbackManager = safeEmail(payload?.managerEmail);
      const mgr = managerEmail || fallbackManager;
      if (!mgr) throw new Error("managerEmail not set (app_config/main.managerEmail)");

      const { requesterName, requesterEmail, targetName, targetEmail } = payload || {};
      const swapsLink = link("/dashboard?tab=swaps");

      const subject = "✅ Troca aguardando aprovação do gerente";
      const html = `
        <div style="font-family:system-ui;line-height:1.4">
          <h2>${escapeHtml(subject)}</h2>
          <p><b>Requester:</b> ${escapeHtml(requesterName)} (${escapeHtml(requesterEmail)})</p>
          <p><b>Target:</b> ${escapeHtml(targetName)} (${escapeHtml(targetEmail)})</p>
          <p>
            <a href="${swapsLink}" style="display:inline-block;padding:12px 14px;background:#3FA9F5;color:#001423;border-radius:10px;text-decoration:none;font-weight:800">
              Abrir no app para aprovar/rejeitar
            </a>
          </p>
        </div>
      `;

      await sendEmailBrevo({ to: [{ email: mgr, name: "Gerente" }], subject, html });
      return NextResponse.json({ ok: true });
    }

    // ======================================================
    // 4) TROCA: decisão do gerente -> email para REQUESTER + TARGET
    // ======================================================
    if (action === "swap_manager_decision") {
      const { requesterEmail, requesterName, targetEmail, targetName, status } = payload || {};
      const swapsLink = link("/dashboard?tab=swaps");

      const subject =
        status === "APPROVED_BY_MANAGER"
          ? "✅ Troca/pegar shift aprovado pelo gerente"
          : "❌ Troca/pegar shift rejeitado pelo gerente";

      const html = `
        <div style="font-family:system-ui;line-height:1.4">
          <h2>${escapeHtml(subject)}</h2>
          <p>Status: <b>${escapeHtml(status)}</b></p>
          <p>
            <a href="${swapsLink}" style="display:inline-block;padding:12px 14px;background:#3FA9F5;color:#001423;border-radius:10px;text-decoration:none;font-weight:800">
              Ver detalhes no app
            </a>
          </p>
        </div>
      `;

      const to: { email: string; name?: string }[] = [];
      if (requesterEmail) to.push({ email: safeEmail(requesterEmail), name: requesterName || "Funcionário" });
      if (targetEmail) to.push({ email: safeEmail(targetEmail), name: targetName || "Funcionário" });

      if (to.length) await sendEmailBrevo({ to, subject, html });
      return NextResponse.json({ ok: true });
    }

    // ======================================================
    // 5) FOLGA: pedido -> email para GERENTE
    // ======================================================
    if (action === "timeoff_pending") {
      const fallbackManager = safeEmail(payload?.managerEmail);
      const mgr = managerEmail || fallbackManager;
      if (!mgr) throw new Error("managerEmail not set (app_config/main.managerEmail)");

      const { employeeName, employeeEmail, date, type, note } = payload || {};
      const timeoffLink = link("/dashboard?tab=timeoff");

      const subject = "📩 Novo pedido de folga (aprovar/rejeitar)";
      const html = `
        <div style="font-family:system-ui;line-height:1.4">
          <h2>${escapeHtml(subject)}</h2>
          <p><b>Funcionário:</b> ${escapeHtml(employeeName)} (${escapeHtml(employeeEmail)})</p>
          <p><b>Data:</b> ${escapeHtml(date)}</p>
          ${type ? `<p><b>Tipo:</b> ${escapeHtml(type)}</p>` : ""}
          ${note ? `<p><b>Nota:</b> ${escapeHtml(note)}</p>` : ""}
          <p>
            <a href="${timeoffLink}" style="display:inline-block;padding:12px 14px;background:#3FA9F5;color:#001423;border-radius:10px;text-decoration:none;font-weight:800">
              Abrir no app
            </a>
          </p>
        </div>
      `;

      await sendEmailBrevo({ to: [{ email: mgr, name: "Gerente" }], subject, html });
      return NextResponse.json({ ok: true });
    }

    // ======================================================
    // 6) FOLGA: decisão -> email para funcionário
    // ======================================================
    if (action === "timeoff_decision") {
      const { employeeName, employeeEmail, status, date, type, note } = payload || {};
      if (!employeeEmail) throw new Error("Missing employeeEmail");

      const timeoffLink = link("/dashboard?tab=timeoff");
      const subject = status === "APPROVED" ? "✅ Sua folga foi aprovada" : "❌ Sua folga foi rejeitada";

      const html = `
        <div style="font-family:system-ui;line-height:1.4">
          <h2>${escapeHtml(subject)}</h2>
          <p><b>Data:</b> ${escapeHtml(date)}</p>
          ${type ? `<p><b>Tipo:</b> ${escapeHtml(type)}</p>` : ""}
          ${note ? `<p><b>Nota:</b> ${escapeHtml(note)}</p>` : ""}
          <p>
            <a href="${timeoffLink}" style="display:inline-block;padding:12px 14px;background:#3FA9F5;color:#001423;border-radius:10px;text-decoration:none;font-weight:800">
              Ver detalhes no app
            </a>
          </p>
        </div>
      `;

      await sendEmailBrevo({
        to: [{ email: safeEmail(employeeEmail), name: employeeName || "Funcionário" }],
        subject,
        html,
      });
      return NextResponse.json({ ok: true });
    }

    // ======================================================
    // 7) DISPONIBILIDADE: pedido -> email para GERENTE
    // ======================================================
    if (action === "availability_pending") {
      const fallbackManager = safeEmail(payload?.managerEmail);
      const mgr = managerEmail || fallbackManager;
      if (!mgr) throw new Error("managerEmail not set (app_config/main.managerEmail)");

      const { employeeName, employeeEmail, summary } = payload || {};
      const availabilityLink = link("/dashboard?tab=availability");

      const subject = "📩 Novo pedido de disponibilidade (aprovar/rejeitar)";
      const html = `
        <div style="font-family:system-ui;line-height:1.4">
          <h2>${escapeHtml(subject)}</h2>
          <p><b>Funcionário:</b> ${escapeHtml(employeeName)} (${escapeHtml(employeeEmail)})</p>
          <p><b>Pedido:</b> ${escapeHtml(summary || "(sem detalhes)")}</p>
          <p>
            <a href="${availabilityLink}" style="display:inline-block;padding:12px 14px;background:#3FA9F5;color:#001423;border-radius:10px;text-decoration:none;font-weight:800">
              Abrir no app
            </a>
          </p>
        </div>
      `;

      await sendEmailBrevo({ to: [{ email: mgr, name: "Gerente" }], subject, html });
      return NextResponse.json({ ok: true });
    }

    // ======================================================
    // 8) DISPONIBILIDADE: decisão -> email para funcionário
    // ======================================================
    if (action === "availability_decision") {
      const { employeeName, employeeEmail, status, summary } = payload || {};
      if (!employeeEmail) throw new Error("Missing employeeEmail");

      const availabilityLink = link("/dashboard?tab=availability");

      const subject = status === "APPROVED" ? "✅ Sua disponibilidade foi aprovada" : "❌ Sua disponibilidade foi rejeitada";
      const html = `
        <div style="font-family:system-ui;line-height:1.4">
          <h2>${escapeHtml(subject)}</h2>
          <p><b>Pedido:</b> ${escapeHtml(summary || "(sem detalhes)")}</p>
          <p>
            <a href="${availabilityLink}" style="display:inline-block;padding:12px 14px;background:#3FA9F5;color:#001423;border-radius:10px;text-decoration:none;font-weight:800">
              Ver detalhes no app
            </a>
          </p>
        </div>
      `;

      await sendEmailBrevo({
        to: [{ email: safeEmail(employeeEmail), name: employeeName || "Funcionário" }],
        subject,
        html,
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "unknown" }, { status: 500 });
  }
}
