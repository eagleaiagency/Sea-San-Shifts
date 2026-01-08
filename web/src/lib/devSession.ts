// src/lib/devSession.ts
export type DevSession = {
  uid: string;
  email: string;
  name: string;
  area: "Front" | "Back";
  isManager: boolean;
};

const KEY = "devSession_v1";

export function setDevSession(s: DevSession) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function getDevSession(): DevSession | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DevSession;
  } catch {
    return null;
  }
}

export function clearDevSession() {
  localStorage.removeItem(KEY);
}
