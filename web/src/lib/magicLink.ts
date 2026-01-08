import { auth } from "./firebase";
import { sendSignInLinkToEmail } from "firebase/auth";

const STORAGE_KEY = "seasan_emailForSignIn";

export async function sendMagicLink(email: string) {
  const actionCodeSettings = {
    url: `${window.location.origin}/finish`,
    handleCodeInApp: true,
  };

  await sendSignInLinkToEmail(auth, email, actionCodeSettings);
  window.localStorage.setItem(STORAGE_KEY, email);
}
