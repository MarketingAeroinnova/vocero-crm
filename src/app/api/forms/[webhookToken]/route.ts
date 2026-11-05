import { getDb, schema } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { extractFormLead, parseFormBody } from "@/lib/form-lead";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { recordSubmission, saveFormLead } from "@/server/form-lead";
import { isValidWebhookToken } from "@/server/inbox/webhook";

/**
 * 070 — Webhook público de formularios web (MetForm, Elementor o cualquier POST).
 *
 * Una capa: el segmento [webhookToken] debe coincidir con `FORM_WEBHOOK_TOKEN`
 * (o, si no existe, con `META_WEBHOOK_VERIFY_TOKEN`); si no → 404 sin efectos.
 * Acepta JSON y `application/x-www-form-urlencoded`. Crea contacto + lead en
 * "Nuevo" con origen "Landing", sin duplicar por teléfono.
 *
 * Los errores de contenido devuelven 422 con el motivo: a diferencia de Meta,
 * aquí quien llama es un formulario propio y le sirve verlo en su registro.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ webhookToken: string }> };

function tokenEsperado(): string {
  const env = getEnv();
  return env.FORM_WEBHOOK_TOKEN ?? env.META_WEBHOOK_VERIFY_TOKEN;
}

/** Para comprobar la URL a mano desde el navegador. */
export async function GET(_req: Request, { params }: Params) {
  const { webhookToken } = await params;
  if (!isValidWebhookToken(webhookToken, tokenEsperado())) {
    return new Response(null, { status: 404 });
  }
  return Response.json({ ok: true });
}

export async function POST(req: Request, { params }: Params) {
  const { webhookToken } = await params;
  if (!isValidWebhookToken(webhookToken, tokenEsperado())) {
    return new Response(null, { status: 404 });
  }

  // Freno contra un bucle o un abuso: el sitio envía desde una sola IP, así que
  // el tope es holgado (60 por minuto) y solo corta lo anormal.
  const rl = checkRateLimit(`form:${clientIp(req.headers)}`, { windowMs: 60_000, max: 60 });
  if (!rl.allowed) return Response.json({ error: "rate_limited" }, { status: 429 });

  const raw = await req.text();
  if (raw.length > 100_000) {
    return Response.json({ error: "payload_too_large" }, { status: 413 });
  }
  const body = parseFormBody(raw, req.headers.get("content-type"));
  if (!body) return Response.json({ error: "cuerpo_ilegible" }, { status: 422 });

  const extracted = extractFormLead(body);
  if (!extracted.ok) return Response.json({ error: extracted.reason }, { status: 422 });

  // Una instancia = un negocio (CLAUDE.md): la organización es la única.
  const [org] = await getDb().select({ id: schema.organization.id }).from(schema.organization).limit(1);
  if (!org) return Response.json({ error: "sin_organizacion" }, { status: 503 });

  const result = await saveFormLead(org.id, extracted.lead);
  const formId = typeof body.form_id === "string" ? body.form_id.slice(0, 40) : "";
  const consulta = await recordSubmission(org.id, extracted.lead, result.contactId, formId);
  return Response.json({
    ok: true,
    created: result.created,
    submissionId: consulta.submissionId,
    previas: consulta.previas,
  });
}
