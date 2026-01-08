import { auth } from "./firebase"; // ajuste se seu firebase estiver em outro caminho

export async function sendAppEmail(action: string, payload: any) {
  const u = auth.currentUser;
  if (!u) throw new Error("No auth user");

  const token = await u.getIdToken();

  const res = await fetch("/api/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action, payload }),
  });

  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Email failed");
  return data;
}
