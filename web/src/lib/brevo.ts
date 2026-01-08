import * as brevo from "@getbrevo/brevo";

export async function sendEmailBrevo(opts: {
  to: { email: string; name?: string }[];
  subject: string;
  html: string;
}) {
  const apiKey = process.env.BREVO_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey) throw new Error("Missing BREVO_KEY in web/.env.local");
  if (!from) throw new Error("Missing EMAIL_FROM in web/.env.local");

  const api = new brevo.TransactionalEmailsApi();
  api.setApiKey(brevo.TransactionalEmailsApiApiKeys.apiKey, apiKey);

  const [fromName, fromEmail] = parseFrom(from);

  await api.sendTransacEmail({
    sender: { name: fromName, email: fromEmail },
    to: opts.to.map((x) => ({ email: x.email, name: x.name })),
    subject: opts.subject,
    htmlContent: opts.html,
  });
}

function parseFrom(from: string) {
  const m = from.match(/^(.*)<(.*)>$/);
  if (!m) return ["Sea San Shifts", from.trim()];
  return [m[1].trim(), m[2].trim()];
}
