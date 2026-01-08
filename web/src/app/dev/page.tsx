"use client";

import { useState } from "react";
import { clearDevSession, setDevSession } from "../../lib/devSession";

const navy = "#071A2B";
const blue = "#3FA9F5";
const text = "#EAF2FF";

type Area = "Front" | "Back";

export default function DevPage() {
  const [name, setName] = useState("Joao");
  const [email, setEmail] = useState("dev@local");
  const [area, setArea] = useState<Area>("Front");
  const [isManager, setIsManager] = useState(false);

  function enterDev() {
    setDevSession({
      uid: isManager ? "dev_manager_uid" : "dev_employee_uid",
      email: email.trim().toLowerCase(),
      name: name.trim() || "Dev",
      area,
      isManager,
    });
    window.location.href = "/dashboard";
  }

  function exitDev() {
    clearDevSession();
    window.location.href = "/";
  }

  return (
    <main style={wrap}>
      <div style={{ width: "100%", maxWidth: 720 }}>
        <div style={card}>
          <h1 style={{ marginTop: 0 }}>Sea San Shifts — DEV</h1>
          <p style={{ opacity: 0.85, marginTop: 0 }}>
            Isso aqui é só pra testar sem email/magic link. Depois a gente desliga.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={label}>Nome</label>
              <input style={input} value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            <div>
              <label style={label}>Email (qualquer)</label>
              <input style={input} value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
            <button style={pill(area === "Front")} onClick={() => setArea("Front")}>
              Front (salão)
            </button>
            <button style={pill(area === "Back")} onClick={() => setArea("Back")}>
              Back (cozinha)
            </button>

            <button style={pill(isManager)} onClick={() => setIsManager((v) => !v)}>
              {isManager ? "Gerente ✅" : "Gerente ❌"}
            </button>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
            <button style={primary} onClick={enterDev}>
              Entrar em DEV → Dashboard
            </button>
            <button style={ghost} onClick={exitDev}>
              Sair do DEV (voltar normal)
            </button>
          </div>

          <div style={{ marginTop: 14, opacity: 0.75, fontSize: 13 }}>
            URL: <b>/dev</b>
          </div>
        </div>
      </div>
    </main>
  );
}

const wrap: React.CSSProperties = {
  minHeight: "100vh",
  background: navy,
  color: text,
  fontFamily: "system-ui, -apple-system, Segoe UI, Roboto",
  display: "flex",
  justifyContent: "center",
  padding: 18,
};

const card: React.CSSProperties = {
  padding: 18,
  borderRadius: 14,
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.10)",
};

const label: React.CSSProperties = {
  fontSize: 13,
  opacity: 0.85,
  display: "block",
  marginTop: 10,
};

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

const primary: React.CSSProperties = {
  padding: "12px 16px",
  borderRadius: 12,
  border: "none",
  cursor: "pointer",
  background: blue,
  color: "#001423",
  fontWeight: 900,
  fontSize: 15,
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
