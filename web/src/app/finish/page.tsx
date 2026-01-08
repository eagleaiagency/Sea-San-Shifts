"use client";

import { useEffect, useState } from "react";
import { auth } from "@/lib/firebase";
import { isSignInWithEmailLink, signInWithEmailLink } from "firebase/auth";

export default function Finish() {
  const [msg, setMsg] = useState("Finalizando login...");

  useEffect(() => {
    (async () => {
      const url = window.location.href;

      if (!isSignInWithEmailLink(auth, url)) {
        setMsg("Link inválido. Volte e tente novamente.");
        return;
      }

      let email = window.localStorage.getItem("seasan_emailForSignIn");
      if (!email) {
        email = window.prompt("Digite seu email para confirmar o login") || "";
      }

      await signInWithEmailLink(auth, email, url);
      window.localStorage.removeItem("seasan_emailForSignIn");
      setMsg("Logado ✅ Agora você pode fechar essa aba e voltar pro app.");
      window.location.href = "/";
    })().catch((e) => setMsg(`Erro: ${String(e?.message || e)}`));
  }, []);

  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#071A2B", color: "#EAF2FF" }}>
      <div style={{ textAlign: "center" }}>
        <h2>{msg}</h2>
      </div>
    </main>
  );
}
