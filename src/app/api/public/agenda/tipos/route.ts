import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { PUBLIC_READ_BUDGET, toPublicType } from "@/lib/public-booking";
import { loadPublicContext } from "@/server/agenda/public";

export const dynamic = "force-dynamic";

/**
 * 070 — Los tipos de cita que se pueden elegir en la página pública.
 * Solo lo que la persona necesita para elegir: jamás el correo ni el
 * calendario de quien atiende.
 */
export async function GET(req: Request) {
  const rl = checkRateLimit(`pub-agenda:${clientIp(req.headers)}`, PUBLIC_READ_BUDGET);
  if (!rl.allowed) return Response.json({ error: "rate_limited" }, { status: 429 });

  const gate = await loadPublicContext();
  if (!gate.ok) return gate.response;
  return Response.json({
    timezone: gate.ctx.settings.timezone,
    tipos: gate.ctx.settings.appointmentTypes.map(toPublicType),
  });
}
