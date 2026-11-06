import { z } from "zod";
import {
  dayIsoInTz,
  dayLabelInTz,
  timeInTz,
  type SlotUtc,
} from "@/lib/time/slots";
import type { AppointmentType, Delivery } from "@/lib/appointment-types";

/**
 * 070 — La página pública de agenda: la parte PURA.
 *
 * Lo que sale a internet va aquí, acotado a propósito: de un tipo de cita solo
 * se publica lo que la persona necesita para elegir (nombre, modalidad, dónde,
 * cuánto dura). NUNCA el correo de quien atiende ni su calendario.
 */

export type PublicType = {
  key: string;
  label: string;
  delivery: Delivery;
  location: string | null;
  durationMinutes: number;
  description: string | null;
};

export function toPublicType(t: AppointmentType): PublicType {
  return {
    key: t.key,
    label: t.label,
    delivery: t.delivery,
    location: t.location ?? null,
    durationMinutes: t.durationMinutes,
    description: t.description ?? null,
  };
}

export type DayGroup = {
  dayIso: string;
  dayLabel: string;
  slots: { startUtc: string; time: string }[];
};

/** Los horarios agrupados por día, en la hora del negocio (no la del navegador). */
export function groupSlotsByDay(
  slots: SlotUtc[],
  timezone: string,
  now: Date
): DayGroup[] {
  const days = new Map<string, DayGroup>();
  for (const s of slots) {
    const dayIso = dayIsoInTz(new Date(s.startUtc), timezone);
    let group = days.get(dayIso);
    if (!group) {
      group = {
        dayIso,
        dayLabel: dayLabelInTz(s.startUtc, timezone, now),
        slots: [],
      };
      days.set(dayIso, group);
    }
    group.slots.push({ startUtc: s.startUtc, time: timeInTz(s.startUtc, timezone) });
  }
  return [...days.values()].sort((a, b) => a.dayIso.localeCompare(b.dayIso));
}

/**
 * Lo que envía quien agenda. El teléfono es obligatorio: es lo que une la cita
 * con la persona en el CRM y con lo que Cristóbal o Jaime necesitan para
 * coordinar. `website` es un señuelo que ninguna persona ve: si viene lleno,
 * es un bot.
 */
export const publicBookingSchema = z.object({
  tipo: z.string().trim().min(1).max(32),
  startUtc: z.string().datetime({ offset: true }),
  nombre: z.string().trim().min(2, "Escribe tu nombre").max(120),
  telefono: z.string().trim().min(6, "Escribe tu teléfono").max(30),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(200)
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => v === undefined || z.string().email().safeParse(v).success, {
      message: "El correo no parece válido",
    }),
  notas: z.string().trim().max(500).optional(),
  website: z.string().max(200).optional(),
});

export type PublicBookingInput = z.infer<typeof publicBookingSchema>;

/** Presupuestos de uso (por IP): leer es barato; reservar, no. */
export const PUBLIC_READ_BUDGET = { windowMs: 60_000, max: 60 };
export const PUBLIC_BOOK_BUDGET = { windowMs: 10 * 60_000, max: 6 };
