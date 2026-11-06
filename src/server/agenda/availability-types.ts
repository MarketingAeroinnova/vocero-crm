import { and, eq, gte, inArray, lte, or } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  buildTypeCandidates,
  filterFreeForType,
  fitsIgnoringHours,
  occupiedWindow,
  type AppointmentType,
  type FreeSlot,
} from "@/lib/appointment-types";
import {
  addDaysISO,
  labelInTz,
  todayInTz,
  zonedWallClockToUtc,
  type SlotUtc,
} from "@/lib/time/slots";
import { getSettings, type CalendarSettings } from "@/server/agenda/settings";
import { bindConnector } from "@/server/agenda/connectors";

/**
 * 070 — Disponibilidad por TIPO de cita.
 *
 *   horario del tipo − lo que ya ocupa a esa persona − lo que tiene ocupado en
 *   su calendario de Google.
 *
 * «Lo que ya ocupa a esa persona» son las citas del mismo `resource` (con su
 * traslado) y los bloqueos del negocio. Las citas de otra persona NO cuentan:
 * es justo lo que permite que Cristóbal atienda una llamada a la misma hora en
 * que Jaime está en una visita.
 *
 * Lo ocupado del calendario es BEST-EFFORT, por la misma razón que los
 * conectores: un Google caído no puede dejar sin agenda al negocio. Si falla,
 * se ofrece lo que el CRM sabe y se devuelve un aviso (`calendarWarning`) para
 * que quien conduce la conversación y el operador sepan que esas horas no
 * están cruzadas con el calendario real.
 */

export type TypedAvailability = {
  slots: FreeSlot[];
  /** null si todo se pudo leer; texto si el calendario no se pudo cruzar. */
  calendarWarning: string | null;
};

const FREEBUSY_TTL_MS = 60_000;
const freeBusyCache = new Map<string, { at: number; value: BusyRead }>();
type BusyRead = { busy: SlotUtc[]; warning: string | null };

/** Solo para tests. */
export function resetFreeBusyCache(): void {
  freeBusyCache.clear();
}

/**
 * Las ventanas que ya ocupan a una persona entre dos instantes: sus citas con
 * su traslado, más los bloqueos del negocio (que valen para todos).
 */
export async function getBusyForResource(
  organizationId: string,
  resource: string,
  range: { fromUtc: Date; toUtc: Date; excludeBookingId?: string }
): Promise<SlotUtc[]> {
  // Un traslado puede empezar antes del rango y terminar dentro de él: se lee
  // con holgura de un día a cada lado y el choque se decide con las ventanas.
  const slack = 86_400_000;
  const rows = await getDb()
    .select({
      id: schema.booking.id,
      scheduledAt: schema.booking.scheduledAt,
      durationMinutes: schema.booking.durationMinutes,
      before: schema.booking.bufferBeforeMinutes,
      after: schema.booking.bufferAfterMinutes,
    })
    .from(schema.booking)
    .where(
      scoped(
        schema.booking.organizationId,
        organizationId,
        and(
          inArray(schema.booking.status, ["agendada", "realizada"]),
          eq(schema.booking.isTest, false),
          or(
            eq(schema.booking.resource, resource),
            // Un bloqueo manual sin responsable cierra la agenda de todos.
            and(eq(schema.booking.kind, "block"), eq(schema.booking.resource, ""))
          ),
          gte(schema.booking.scheduledAt, new Date(range.fromUtc.getTime() - slack)),
          lte(schema.booking.scheduledAt, new Date(range.toUtc.getTime() + slack))
        )
      )
    );

  return rows
    .filter((r) => r.id !== range.excludeBookingId)
    .map((r) =>
      occupiedWindow(r.scheduledAt.toISOString(), r.durationMinutes, r.before, r.after)
    );
}

/**
 * Lo que la persona tiene ocupado en su Google Calendar. Solo se intenta si el
 * conector activo es Google; si no, no hay nada que cruzar y no es un fallo.
 */
async function getCalendarBusy(
  organizationId: string,
  settings: CalendarSettings,
  email: string,
  fromUtc: Date,
  toUtc: Date
): Promise<BusyRead> {
  if (settings.connector !== "google") return { busy: [], warning: null };

  const key = `${organizationId}|${email}|${fromUtc.toISOString()}|${toUtc.toISOString()}`;
  const hit = freeBusyCache.get(key);
  if (hit && Date.now() - hit.at < FREEBUSY_TTL_MS) return hit.value;

  let value: BusyRead;
  try {
    const conn = await bindConnector(organizationId, "google", settings);
    if (!conn.freeBusy) return { busy: [], warning: null };
    const res = await conn.freeBusy([email], fromUtc.toISOString(), toUtc.toISOString());
    const one = res[email];
    value = one?.error
      ? {
          busy: [],
          warning: `No pude leer el calendario de ${email} (${one.error}). Revisa que lo haya compartido con la cuenta del CRM.`,
        }
      : { busy: one?.busy ?? [], warning: null };
  } catch (err) {
    console.warn(`[agenda] no pude leer lo ocupado de ${email}: ${err}`);
    value = {
      busy: [],
      warning: `No pude leer el calendario de ${email}: las horas no están cruzadas con su calendario real.`,
    };
  }
  freeBusyCache.set(key, { at: Date.now(), value });
  return value;
}

export async function computeAvailabilityForType(
  organizationId: string,
  type: AppointmentType,
  opts?: {
    fromISO?: string;
    toISO?: string;
    excludeBookingId?: string;
    now?: Date;
    settings?: CalendarSettings;
    ignoreNotice?: boolean;
  }
): Promise<TypedAvailability> {
  const settings = opts?.settings ?? (await getSettings(organizationId));
  const now = opts?.now ?? new Date();
  const tz = settings.timezone;

  const from = opts?.fromISO ?? todayInTz(now, tz);
  const to = opts?.toISO ?? addDaysISO(from, type.maxDaysAhead);

  const candidates = buildTypeCandidates(type, tz, from, to);
  if (candidates.length === 0) return { slots: [], calendarWarning: null };

  const fromUtc = zonedWallClockToUtc(from, "00:00", tz) ?? new Date(0);
  const toUtc =
    zonedWallClockToUtc(addDaysISO(to, 1), "00:00", tz) ??
    new Date(now.getTime() + 86_400_000 * 121);

  const [local, calendar] = await Promise.all([
    getBusyForResource(organizationId, type.resource, {
      fromUtc,
      toUtc,
      excludeBookingId: opts?.excludeBookingId,
    }),
    getCalendarBusy(organizationId, settings, type.attendeeEmail, fromUtc, toUtc),
  ]);

  const slots = filterFreeForType(candidates, [...local, ...calendar.busy], {
    now,
    timezone: tz,
    minNoticeHours: type.minNoticeHours,
    bufferBeforeMinutes: type.bufferBeforeMinutes,
    bufferAfterMinutes: type.bufferAfterMinutes,
    durationMinutes: type.durationMinutes,
    ignoreNotice: opts?.ignoreNotice,
  });
  return { slots, calendarWarning: calendar.warning };
}

/**
 * Re-valida que un instante concreto siga libre PARA ESE TIPO. Se llama al
 * confirmar, nunca al ofrecer.
 *
 * `ignoreHours` es la vía del operador para lo excepcional (un sábado «a
 * solicitud»): el horario semanal deja de mandar, pero el choque con otra cita
 * de la misma persona SIGUE mandando. El bot nunca lo usa.
 */
export async function findSlotForType(
  organizationId: string,
  type: AppointmentType,
  whenISO: string,
  opts?: {
    excludeBookingId?: string;
    now?: Date;
    settings?: CalendarSettings;
    ignoreHours?: boolean;
  }
): Promise<FreeSlot | null> {
  const target = Date.parse(whenISO);
  if (Number.isNaN(target)) return null;

  const settings = opts?.settings ?? (await getSettings(organizationId));
  const tz = settings.timezone;

  if (opts?.ignoreHours) {
    const startUtc = new Date(target).toISOString();
    const around = {
      fromUtc: new Date(target - 86_400_000),
      toUtc: new Date(target + 86_400_000),
    };
    const [local, calendar] = await Promise.all([
      getBusyForResource(organizationId, type.resource, {
        ...around,
        excludeBookingId: opts.excludeBookingId,
      }),
      getCalendarBusy(organizationId, settings, type.attendeeEmail, around.fromUtc, around.toUtc),
    ]);
    if (!fitsIgnoringHours(startUtc, [...local, ...calendar.busy], type)) return null;
    return {
      startUtc,
      endUtc: new Date(target + type.durationMinutes * 60_000).toISOString(),
      label: labelInTz(startUtc, tz),
    };
  }

  const dayInTz = todayInTz(new Date(target), tz);
  const { slots } = await computeAvailabilityForType(organizationId, type, {
    fromISO: addDaysISO(dayInTz, -1),
    toISO: addDaysISO(dayInTz, 1),
    excludeBookingId: opts?.excludeBookingId,
    now: opts?.now,
    settings,
  });
  return slots.find((s) => Date.parse(s.startUtc) === target) ?? null;
}
