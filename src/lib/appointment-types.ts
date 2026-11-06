import { z } from "zod";
import {
  WEEKDAYS,
  eachDateInRange,
  expandWorkingDayToUtc,
  isValidInterval,
  labelInTz,
  overlaps,
  weekdayKeyOf,
  type Interval,
  type SlotUtc,
  type WeekdayKey,
} from "@/lib/time/slots";

/**
 * 070 — Tipos de cita: la parte PURA (sin base de datos ni reloj).
 *
 * Vocero nació con UNA agenda por negocio: un horario, una duración y un
 * solo responsable. Un negocio que atiende de formas distintas —una llamada
 * con una persona, una visita a la escuela con otra, una videollamada— necesita
 * reglas propias para cada una: quién la atiende, cuándo, cuánto dura, cuánto
 * traslado hay que dejar y cómo se entrega.
 *
 * El motor sigue sin saber de proveedores: un tipo solo dice QUÉ y CON QUIÉN.
 *
 * Reglas que viven aquí, porque son las que hay que poder probar sin nada más:
 *  - Un recurso (la persona) no puede estar en dos citas a la vez.
 *  - El traslado no es parte de la cita pero SÍ ocupa a la persona: se mide
 *    sobre la ventana ocupada, no sobre la cita.
 */

export const DELIVERIES = ["meet", "phone", "in_person"] as const;
export type Delivery = (typeof DELIVERIES)[number];

export type WeeklyHours = Partial<Record<WeekdayKey, Interval[]>>;

const KEY = /^[a-z0-9_-]{2,32}$/;

export const appointmentTypeSchema = z.object({
  /** Identificador estable: el bot y la API hablan con él. */
  key: z.string().regex(KEY, "key: minúsculas, números, - o _ (2 a 32)"),
  label: z.string().trim().min(1).max(80),
  /**
   * La persona (recurso). Dos tipos con el mismo `resource` comparten agenda:
   * lo que ocupa uno bloquea al otro.
   */
  resource: z.string().regex(KEY, "resource: minúsculas, números, - o _ (2 a 32)"),
  /** Cómo se llama quien atiende; solo para mostrar. */
  responsibleName: z.string().trim().max(80).optional(),
  /** A quien Google le manda la invitación. */
  attendeeEmail: z.string().trim().toLowerCase().email(),
  durationMinutes: z.number().int().min(10).max(480),
  /** Hora de PARED del negocio, por día de la semana. */
  weeklyHours: z.unknown(),
  /** Traslado u ocupación ANTES de la cita (ocupa a la persona, no al cliente). */
  bufferBeforeMinutes: z.number().int().min(0).max(240).default(0),
  /** Ídem DESPUÉS de la cita. */
  bufferAfterMinutes: z.number().int().min(0).max(240).default(0),
  minNoticeHours: z.number().int().min(0).max(240).default(2),
  maxDaysAhead: z.number().int().min(1).max(120).default(21),
  delivery: z.enum(DELIVERIES),
  /**
   * Dónde es. Presencial: la dirección. Llamada: se escribe aparte que se
   * llama al cliente. Videollamada: no hace falta (el enlace lo da Meet).
   */
  location: z.string().trim().max(300).optional(),
  /** Texto corto para quien elige en la página de agenda («Conversa con un asesor…»). */
  description: z.string().trim().max(300).optional(),
});

export type AppointmentType = Omit<
  z.infer<typeof appointmentTypeSchema>,
  "weeklyHours"
> & { weeklyHours: WeeklyHours };

/**
 * Descarta intervalos inválidos y días vacíos, y ordena. Se limpia en vez de
 * rechazar: un día mal escrito no debe tumbar el guardado completo.
 */
export function normalizeHours(input: unknown): WeeklyHours {
  const out: WeeklyHours = {};
  if (typeof input !== "object" || input === null) return out;
  const source = input as Record<string, unknown>;
  for (const day of WEEKDAYS) {
    const intervals = source[day];
    if (!Array.isArray(intervals)) continue;
    const valid = intervals
      .filter(isValidInterval)
      .sort((a, b) => a.start.localeCompare(b.start));
    if (valid.length > 0) out[day] = valid;
  }
  return out;
}

export type ParseTypesResult =
  | { ok: true; types: AppointmentType[] }
  | { ok: false; errors: string[] };

/**
 * Validación ESTRICTA, para lo que llega por la API: quien guarda debe ver qué
 * está mal, no que se le descartó un tipo en silencio.
 */
export function parseAppointmentTypes(raw: unknown): ParseTypesResult {
  if (!Array.isArray(raw)) {
    return { ok: false, errors: ["Se esperaba una lista de tipos de cita"] };
  }
  const errors: string[] = [];
  const types: AppointmentType[] = [];
  const keys = new Set<string>();

  raw.forEach((item, i) => {
    const parsed = appointmentTypeSchema.safeParse(item);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push(`#${i + 1} ${issue.path.join(".") || "tipo"}: ${issue.message}`);
      }
      return;
    }
    const t = parsed.data;
    if (keys.has(t.key)) {
      errors.push(`#${i + 1} key: «${t.key}» está repetida`);
      return;
    }
    keys.add(t.key);
    const weeklyHours = normalizeHours(t.weeklyHours);
    if (Object.keys(weeklyHours).length === 0) {
      errors.push(`#${i + 1} weeklyHours: el tipo «${t.key}» no tiene ningún horario`);
      return;
    }
    types.push({ ...t, weeklyHours });
  });

  return errors.length > 0 ? { ok: false, errors } : { ok: true, types };
}

/**
 * Lectura TOLERANTE, para lo que ya está guardado: un tipo dañado no puede
 * dejar la agenda entera inservible, así que se descarta ese y se sigue.
 */
export function readAppointmentTypes(raw: unknown): AppointmentType[] {
  if (!Array.isArray(raw)) return [];
  const out: AppointmentType[] = [];
  for (const item of raw) {
    const one = parseAppointmentTypes([item]);
    if (one.ok) out.push(...one.types);
  }
  return out;
}

export function findType(
  types: AppointmentType[],
  key: string | null | undefined
): AppointmentType | null {
  if (!key) return null;
  return types.find((t) => t.key === key) ?? null;
}

/**
 * La ventana que la cita ocupa A LA PERSONA: la cita más su traslado. Es contra
 * esta ventana, y no contra la cita, que se comprueban los choques.
 */
export function occupiedWindow(
  startUtc: string,
  durationMinutes: number,
  bufferBeforeMinutes: number,
  bufferAfterMinutes: number
): SlotUtc {
  const start = Date.parse(startUtc);
  return {
    startUtc: new Date(start - Math.max(0, bufferBeforeMinutes) * 60_000).toISOString(),
    endUtc: new Date(
      start + (durationMinutes + Math.max(0, bufferAfterMinutes)) * 60_000
    ).toISOString(),
  };
}

/**
 * Los instantes candidatos de un tipo entre dos días (en la zona del negocio).
 * Las citas van una tras otra: el paso es la duración. El traslado NO separa a
 * los candidatos entre sí; se aplica al comprobar los choques.
 */
export function buildTypeCandidates(
  type: Pick<AppointmentType, "weeklyHours" | "durationMinutes">,
  timezone: string,
  fromISO: string,
  toISO: string
): SlotUtc[] {
  const out: SlotUtc[] = [];
  for (const date of eachDateInRange(fromISO, toISO)) {
    const weekday = weekdayKeyOf(date, timezone);
    if (!weekday) continue;
    const intervals = type.weeklyHours[weekday] ?? [];
    if (intervals.length === 0) continue; // día cerrado
    out.push(
      ...expandWorkingDayToUtc(date, intervals, timezone, type.durationMinutes, 0)
    );
  }
  return out;
}

export type FreeSlot = SlotUtc & { label: string };

/**
 * Deja solo lo reservable: lo que no ya pasó (con aviso mínimo) y cuya ventana
 * ocupada no choca con nada de lo que ya ocupa a la persona (`busy`, que ya
 * viene como ventanas ocupadas: sus propias citas con su traslado y lo ocupado
 * en su calendario).
 */
export function filterFreeForType(
  candidates: SlotUtc[],
  busy: SlotUtc[],
  opts: {
    now: Date;
    timezone: string;
    minNoticeHours: number;
    bufferBeforeMinutes: number;
    bufferAfterMinutes: number;
    durationMinutes: number;
    /** El operador puede reservar fuera de plazo; el bot no. */
    ignoreNotice?: boolean;
  }
): FreeSlot[] {
  const minStartMs = opts.ignoreNotice
    ? Number.NEGATIVE_INFINITY
    : opts.now.getTime() + opts.minNoticeHours * 3_600_000;
  return candidates
    .filter((c) => Date.parse(c.startUtc) >= minStartMs)
    .filter((c) => {
      const w = occupiedWindow(
        c.startUtc,
        opts.durationMinutes,
        opts.bufferBeforeMinutes,
        opts.bufferAfterMinutes
      );
      return !busy.some((b) => overlaps(w.startUtc, w.endUtc, b.startUtc, b.endUtc));
    })
    .sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc))
    .map((c) => ({ ...c, label: labelInTz(c.startUtc, opts.timezone) }));
}

/**
 * ¿Cabe este instante exacto, ignorando el horario semanal? Es la vía del
 * operador para los casos excepcionales (un sábado «a solicitud»): el horario
 * deja de mandar, el choque con otra cita de la persona NO.
 */
export function fitsIgnoringHours(
  startUtc: string,
  busy: SlotUtc[],
  type: Pick<
    AppointmentType,
    "durationMinutes" | "bufferBeforeMinutes" | "bufferAfterMinutes"
  >
): boolean {
  if (Number.isNaN(Date.parse(startUtc))) return false;
  const w = occupiedWindow(
    startUtc,
    type.durationMinutes,
    type.bufferBeforeMinutes,
    type.bufferAfterMinutes
  );
  return !busy.some((b) => overlaps(w.startUtc, w.endUtc, b.startUtc, b.endUtc));
}

/** Etiqueta para mostrar el modo de entrega, en lenguaje de persona. */
export const DELIVERY_LABELS: Record<Delivery, string> = {
  meet: "Videollamada (Google Meet)",
  phone: "Llamada telefónica",
  in_person: "Presencial",
};

/* ------------------------------------------------------------------ */
/* Texto del evento que ve quien atiende                              */
/* ------------------------------------------------------------------ */

/** Título del evento: «Visita al aeródromo — María». */
export function composeEventTopic(
  type: Pick<AppointmentType, "label"> | null,
  contactName: string
): string {
  const name = contactName.trim();
  if (!type) return name ? `Cita — ${name}` : "Cita";
  return name ? `${type.label} — ${name}` : type.label;
}

/**
 * Teléfono legible: «56912345678» → «+56 9 1234 5678». Un móvil chileno se
 * agrupa; cualquier otro número queda como «+dígitos».
 */
export function phoneForHumans(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 11 && digits.startsWith("569")) {
    return `+56 9 ${digits.slice(3, 7)} ${digits.slice(7)}`;
  }
  return `+${digits}`;
}

/** Enlace para escribirle por WhatsApp (avisar un atraso, una duda). */
function whatsappLink(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}` : null;
}

function ficha(ficha: Record<string, unknown> | null | undefined, key: string): string | null {
  const v = ficha?.[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * La descripción del evento: lo que quien atiende necesita para saber a QUIÉN
 * va a ver o llamar y qué preguntó. Solo texto plano.
 */
export function composeEventNotes(input: {
  type: Pick<AppointmentType, "delivery" | "label"> | null;
  contactName: string;
  phone: string | null | undefined;
  ficha: Record<string, unknown> | null | undefined;
  notes: string | null | undefined;
  source: "manual" | "ai" | "web";
}): string {
  const lines: string[] = [];
  if (input.contactName.trim()) lines.push(`Contacto: ${input.contactName.trim()}`);

  // El teléfono va SIEMPRE y arriba: sirve para coordinar (un atraso, una duda,
  // una pregunta para tener preparada) en cualquier tipo de cita, no solo en
  // la llamada.
  const phone = phoneForHumans(input.phone);
  if (phone) {
    lines.push(
      input.type?.delivery === "phone"
        ? `Llamar a: ${phone}`
        : `Teléfono / WhatsApp: ${phone}`
    );
    const wa = whatsappLink(input.phone);
    if (wa) lines.push(`Escribirle por WhatsApp: ${wa}`);
  } else {
    lines.push(
      "Teléfono: no registrado. Se le puede escribir por la conversación de WhatsApp del CRM."
    );
  }
  const programa = ficha(input.ficha, "programa");
  if (programa) lines.push(`Programa de interés: ${programa}`);
  const motivo = ficha(input.ficha, "motivo");
  if (motivo) lines.push(`Motivo de la consulta: ${motivo}`);
  const email = ficha(input.ficha, "email");
  if (email) lines.push(`Correo: ${email}`);
  if (input.notes?.trim()) lines.push(`Notas: ${input.notes.trim()}`);

  lines.push(
    input.source === "ai"
      ? "Agendada por el asistente de WhatsApp."
      : input.source === "web"
        ? "Agendada por la propia persona desde la página de agenda."
        : "Agendada por el equipo."
  );
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* Qué tipo de cita es                                                */
/* ------------------------------------------------------------------ */

export type PickTypeResult =
  | { ok: true; type: AppointmentType | null }
  | {
      ok: false;
      reason: "sin_tipos" | "desconocido" | "falta" | "otro_tipo";
      key?: string;
    };

/**
 * Resuelve el tipo de una reserva. Sin tipos configurados no hay nada que
 * resolver (y pedir uno es un error: la agenda no los tiene). Con tipos, manda
 * el que se pide; si no, el del horario ofrecido; si no, el predeterminado.
 */
export function pickAppointmentType(input: {
  types: AppointmentType[];
  defaultTypeKey: string | null;
  requested: string | null | undefined;
  /** El tipo para el que se ofreció el horario (si fue una oferta). */
  offeredTypeKey: string | null | undefined;
}): PickTypeResult {
  if (input.types.length === 0) {
    return input.requested
      ? { ok: false, reason: "sin_tipos" }
      : { ok: true, type: null };
  }
  const key = input.requested || input.offeredTypeKey || input.defaultTypeKey;
  if (!key) return { ok: false, reason: "falta" };
  const type = findType(input.types, key);
  if (!type) return { ok: false, reason: "desconocido", key };
  // El horario se ofreció para OTRO tipo: no vale para éste.
  if (input.offeredTypeKey && input.offeredTypeKey !== type.key) {
    return { ok: false, reason: "otro_tipo", key };
  }
  return { ok: true, type };
}
