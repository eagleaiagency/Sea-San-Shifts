"use client";

import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../lib/firebase";
import { sendMagicLink } from "../lib/magicLink";
import { MANAGER_EMAIL } from "../lib/config";
import {
  StaffArea,
  createStaff,
  findStaffByEmail,
  listUnclaimedStaff,
  setPendingStaffId,
  setStaffEmail,
} from "../lib/staff";

const navy = "#071A2B";
const blue = "#3FA9F5";
const text = "#EAF2FF";

type Step = "EMAIL" | "PICK_NAME" | "ADD_NAME" | "SENT";

export default function HomePage() {
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<Step>("EMAIL");

  const [area, setArea] = useState<StaffArea>("Front");
  const [unclaimed, setUnclaimed] = useState<any[]>([]);
  const [loadingNames, setLoadingNames] = useState(false);

  const [selectedStaffId, setSelectedStaffId] = useState<string>("");

  const [newName, setNewName] = useState("");
  const [msg, setMsg] = useState("");

  // se já estiver logado, manda pro dashboard
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) window.location.href = "/dashboard";
    });
    return () => unsub();
  }, []);

  async function loadUnclaimed(a: StaffArea) {
    setLoadingNames(true);
    try {
      const list = await listUnclaimedStaff(a);
      setUnclaimed(list);
      setSelectedStaffId(list[0]?.id || "");
    } finally {
      setLoadingNames(false);
    }
  }

  useEffect(() => {
    if (step === "PICK_NAME") loadUnclaimed(area);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, area]);

  const emailLower = useMemo(() => email.trim().toLowerCase(), [email]);

  async function continueWithEmail() {
    setMsg("");
    if (!emailLower || !emailLower.includes("@")) {
      setMsg("❌ Coloque um email válido.");
      return;
    }

    // gerente pode só mandar link direto
    if (emailLower === MANAGER_EMAIL.toLowerCase()) {
      await sendMagicLink(emailLower);
      setStep("SENT");
      return;
    }

    // se já existe staff com esse email => manda link direto
    const exists = await findStaffByEmail(emailLower);
    if (exists) {
      setPendingStaffId(exists.id); // ajuda na claim depois
      await sendMagicLink(emailLower);
      setStep("SENT");
      return;
    }

    // senão, precisa escolher nome não-claimed OU adicionar nome
    setStep("PICK_NAME");
  }

  async function chooseNameAndSend() {
    setMsg("");
    if (!selectedStaffId) {
      setMsg("❌ Selecione seu nome na lista.");
      return;
    }
    if (!emailLower || !emailLower.includes("@")) {
      setMsg("❌ Coloque um email válido.");
      return;
    }

    // associa email ao nome escolhido
    await setStaffEmail(selectedStaffId, emailLower);
    setPendingStaffId(selectedStaffId);

    await sendMagicLink(emailLower);
    setStep("SENT");
  }

  async function addNameAndSend() {
    setMsg("");
    const n = newName.trim();
    if (!n) {
      setMsg("❌ Digite seu nome.");
      return;
    }
    if (!emailLower || !emailLower.includes("@")) {
      setMsg("❌ Coloque um email válido.");
      return;
    }

    const id = await createStaff(n, area);
    await setStaffEmail(id, emailLower);
    setPendingStaffId(id);

    await sendMagicLink(emailLower);
    setStep("SENT");
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: navy,
        color: text,
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: 18,
      }}
    >
      <div style={{ width: "100%", maxWidth: 520 }}>
        <div
          style={{
            padding: 18,
            borderRadius: 14,
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.10)",
          }}
        >
          <h1 style={{ marginTop: 0, marginBottom: 6 }}>Sea San Shifts</h1>
          <p style={{ opacity: 0.85, marginTop: 0 }}>
            Entre com seu email para receber o link de acesso.
          </p>

          <label style={label}>Email</label>
          <input
            style={input}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="ex: joao@gmail.com"
          />

          {step === "EMAIL" && (
            <button style={primary} onClick={continueWithEmail}>
              Continuar
            </button>
          )}

          {step === "PICK_NAME" && (
            <>
              <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
                <button
                  style={pill(area === "Front")}
                  onClick={() => setArea("Front")}
                >
                  Front (salão)
                </button>
                <button
                  style={pill(area === "Back")}
                  onClick={() => setArea("Back")}
                >
                  Back (cozinha)
                </button>
              </div>

              <div style={{ marginTop: 12 }}>
                <div style={{ fontWeight: 900, marginBottom: 8 }}>
                  Selecione seu nome (ainda não claimed)
                </div>

                {loadingNames ? (
                  <p>Carregando...</p>
                ) : unclaimed.length === 0 ? (
                  <p style={{ opacity: 0.85 }}>
                    Nenhum nome disponível nessa área.
                  </p>
                ) : (
                  <select
                    style={select}
                    value={selectedStaffId}
                    onChange={(e) => setSelectedStaffId(e.target.value)}
                  >
                    {unclaimed.map((s: any) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                )}

                <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
                  <button style={primaryAuto} onClick={chooseNameAndSend} disabled={!selectedStaffId}>
                    Enviar link de acesso
                  </button>
                  <button style={ghost} onClick={() => setStep("ADD_NAME")}>
                    Adicionar nome
                  </button>
                  <button style={ghost} onClick={() => setStep("EMAIL")}>
                    Voltar
                  </button>
                </div>
              </div>
            </>
          )}

          {step === "ADD_NAME" && (
            <>
              <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
                <button
                  style={pill(area === "Front")}
                  onClick={() => setArea("Front")}
                >
                  Front (salão)
                </button>
                <button
                  style={pill(area === "Back")}
                  onClick={() => setArea("Back")}
                >
                  Back (cozinha)
                </button>
              </div>

              <label style={label}>Seu nome</label>
              <input
                style={input}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="ex: João"
              />

              <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
                <button style={primaryAuto} onClick={addNameAndSend}>
                  Enviar link de acesso
                </button>
                <button style={ghost} onClick={() => setStep("PICK_NAME")}>
                  Voltar
                </button>
              </div>
            </>
          )}

          {step === "SENT" && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontWeight: 900 }}>✅ Link enviado!</div>
              <p style={{ opacity: 0.85 }}>
                Abra o email e clique no link para entrar.
              </p>
              <button style={ghost} onClick={() => setStep("EMAIL")}>
                Enviar novamente
              </button>
            </div>
          )}

          {msg && <p style={{ marginTop: 12, opacity: 0.9 }}>{msg}</p>}
        </div>
      </div>
    </main>
  );
}

const label: React.CSSProperties = { fontSize: 13, opacity: 0.85, display: "block", marginTop: 10 };
const input: React.CSSProperties = {
  width: "100%",
  marginTop: 6,
  padding: "12px 12px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.25)",
  color: text,
  outline: "none",
};
const select: React.CSSProperties = {
  width: "100%",
  marginTop: 6,
  padding: "12px 12px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.25)",
  color: text,
  outline: "none",
};

const primary: React.CSSProperties = {
  width: "100%",
  marginTop: 12,
  padding: "12px 18px",
  borderRadius: 10,
  border: "none",
  cursor: "pointer",
  background: blue,
  color: "#001423",
  fontWeight: 900,
  fontSize: 16,
};
const primaryAuto: React.CSSProperties = {
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
const ghost: React.CSSProperties = {
  padding: "12px 14px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  cursor: "pointer",
  background: "rgba(255,255,255,0.06)",
  color: text,
  fontWeight: 900,
};
const pill = (active: boolean): React.CSSProperties => ({
  padding: "10px 14px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.12)",
  background: active ? blue : "rgba(255,255,255,0.06)",
  color: active ? "#001423" : text,
  cursor: "pointer",
  fontWeight: 900,
});
