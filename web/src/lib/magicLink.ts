import { auth } from "./firebase";
import { sendSignInLinkToEmail } from "firebase/auth";

const STORAGE_KEY = "seasan_emailForSignIn";

export async function sendMagicLink(email: string) {
  const actionCodeSettings = {
    // ⚠️ URL SEMPRE AUTORIZADA (localhost ou Vercel)
    url: `${window.location.origin}/dashboard`,
    handleCodeInApp: true,
  };

  await sendSignInLinkToEmail(auth, email, actionCodeSettings);

  // salva o email para completar o login depois
  window.localStorage.setItem(STORAGE_KEY, email.toLowerCase());
}

