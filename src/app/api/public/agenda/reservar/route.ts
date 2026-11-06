import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import {
  PUBLIC_BOOK_BUDGET,
  publicBookingSchema,
  toPublicType,
} from "@/lib/public-booking";
import { bookingErrorResponse } from "@/server/agenda/http";
import {
  bookPublic,
  businessWhatsappDigits,
  loadPublicContext,
  PublicBookingError,
} from "@/server/agenda/public";

export const dynamic = "force-dynamic";

/**
 * 070 — Reservar desde la página pública.
 *
 * Responde **201**, igual que el resto de las superficies de agenda. Abierta a
 * internet: límite por IP, señuelo contra bots y una cita activa por tipo.
 */
export async function POST(req: Request) {
  const rl = checkRateLimit(`pub-book:${clientIp(req.headers)}`, PUBLIC_BOOK_BUDGET);
  if (!rl.allowed) {
    return Response.json(
      { error: { code: "rate_limited", message: "Demasiados intentos. Espera unos minutos." } },
      { status: 429 }
    );
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json(
      { error: { code: "invalid_body", message: "Cuerpo ilegible" } },
      { status: 422 }
    );
  }
  const parsed = publicBookingSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: { code: "invalid_body", message: parsed.error.issues[0]?.message ?? "Datos inválidos" } },
      { status: 422 }
    );
  }
  const input = parsed.data;

  // Señuelo: ninguna persona ve ese campo. A un bot se le responde «ok» y no se
  // crea nada, para que no sepa que fue detectado.
  if (input.website) return Response.json({ ok: true }, { status: 201 });

  const gate = await loadPublicContext();
  if (!gate.ok) return gate.response;

  try {
    const { result, type } = await bookPublic(gate.ctx, input);
    return Response.json(
      {
        ok: true,
        label: result.label,
        tipo: toPublicType(type),
        meetingLink: result.meetingLink,
        linkPending: result.linkPending,
        whatsapp: await businessWhatsappDigits(gate.ctx.organizationId),
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof PublicBookingError) {
      const status = err.code === "ya_tiene_cita" ? 409 : 422;
      return Response.json({ error: { code: err.code, message: err.message } }, { status });
    }
    return bookingErrorResponse(err);
  }
}
