import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { recordReply } from "@/server/form-lead";
import { isValidWebhookToken } from "@/server/inbox/webhook";

/**
 * 070 — El sitio avisa si el correo automático de respuesta salió.
 * Mismo token que el webhook del formulario; token incorrecto → 404.
 */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ webhookToken: string }> };

const bodySchema = z.object({
  submissionId: z.string().min(1).max(60),
  estado: z.enum(["enviado", "fallido"]),
});

export async function POST(req: Request, { params }: Params) {
  const { webhookToken } = await params;
  const env = getEnv();
  if (!isValidWebhookToken(webhookToken, env.FORM_WEBHOOK_TOKEN ?? env.META_WEBHOOK_VERIFY_TOKEN)) {
    return new Response(null, { status: 404 });
  }
  const rl = checkRateLimit(`form-resp:${clientIp(req.headers)}`, { windowMs: 60_000, max: 60 });
  if (!rl.allowed) return Response.json({ error: "rate_limited" }, { status: 429 });

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "cuerpo_ilegible" }, { status: 422 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return Response.json({ error: "datos_invalidos" }, { status: 422 });

  const [org] = await getDb().select({ id: schema.organization.id }).from(schema.organization).limit(1);
  if (!org) return Response.json({ error: "sin_organizacion" }, { status: 503 });

  const ok = await recordReply(org.id, parsed.data.submissionId, parsed.data.estado);
  if (!ok) return Response.json({ error: "consulta_no_encontrada" }, { status: 404 });
  return Response.json({ ok: true });
}
