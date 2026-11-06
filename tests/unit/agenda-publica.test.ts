import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseAppointmentTypes, type AppointmentType } from "@/lib/appointment-types";
import {
  groupSlotsByDay,
  publicBookingSchema,
  toPublicType,
} from "@/lib/public-booking";
import { resetRateLimit } from "@/lib/rate-limit";

/**
 * 070 — La página pública de agenda. Está abierta a internet: lo que se prueba
 * aquí es lo que NO puede pasar (filtrar el correo de quien atiende, crear
 * citas por un bot, saltarse los límites) y lo que sí (agrupar bien por día).
 */

const LV = (a: string, b: string) => ({
  mon: [{ start: a, end: b }],
  tue: [{ start: a, end: b }],
  wed: [{ start: a, end: b }],
  thu: [{ start: a, end: b }],
  fri: [{ start: a, end: b }],
});

function tipos(): AppointmentType[] {
  const r = parseAppointmentTypes([
    {
      key: "aerodromo",
      label: "Visita al aeródromo La Victoria",
      resource: "jaime",
      attendeeEmail: "jaimea.silva@aeroinnova.com",
      durationMinutes: 60,
      weeklyHours: LV("10:00", "13:00"),
      bufferBeforeMinutes: 60,
      bufferAfterMinutes: 60,
      delivery: "in_person",
      location: "Aeródromo La Victoria, Chacabuco, comuna de Colina",
      description: "Conoce las instalaciones y los aviones.",
    },
    {
      key: "llamada",
      label: "Llamada telefónica",
      resource: "cristobal",
      attendeeEmail: "cristobalcarvajal2005@gmail.com",
      durationMinutes: 20,
      weeklyHours: LV("10:00", "18:00"),
      delivery: "phone",
    },
  ]);
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.types;
}

describe("lo que se publica de un tipo", () => {
  it("jamás incluye el correo de quien atiende ni su agenda", () => {
    const pub = toPublicType(tipos()[0]!);
    const json = JSON.stringify(pub);
    expect(json).not.toContain("jaimea.silva");
    expect(json).not.toContain("attendeeEmail");
    expect(json).not.toContain("resource");
    expect(json).not.toContain("weeklyHours");
    expect(pub).toEqual({
      key: "aerodromo",
      label: "Visita al aeródromo La Victoria",
      delivery: "in_person",
      location: "Aeródromo La Victoria, Chacabuco, comuna de Colina",
      durationMinutes: 60,
      description: "Conoce las instalaciones y los aviones.",
    });
  });
});

describe("agrupar horarios por día", () => {
  const now = new Date(Date.UTC(2026, 10, 9, 12, 0)); // lunes 9 nov, 09:00 Santiago
  const L = (d: number, h: number) => new Date(Date.UTC(2026, 10, d, h + 3)).toISOString();

  it("agrupa por día de Chile (no del navegador) y ordena", () => {
    const grupos = groupSlotsByDay(
      [
        { startUtc: L(11, 11), endUtc: L(11, 12) },
        { startUtc: L(10, 10), endUtc: L(10, 11) },
        { startUtc: L(10, 12), endUtc: L(10, 13) },
        // 22:30 de Chile es ya el día siguiente en UTC: sigue siendo el 10.
        { startUtc: new Date(Date.UTC(2026, 10, 11, 1, 30)).toISOString(), endUtc: "x" },
      ],
      "America/Santiago",
      now
    );
    expect(grupos.map((g) => g.dayIso)).toEqual(["2026-11-10", "2026-11-11"]);
    expect(grupos[0]!.slots.map((s) => s.time)).toEqual(["10:00", "12:00", "22:30"]);
    expect(grupos[1]!.slots).toHaveLength(1);
  });

  it("sin horarios devuelve una lista vacía", () => {
    expect(groupSlotsByDay([], "America/Santiago", now)).toEqual([]);
  });
});

describe("lo que envía quien agenda", () => {
  const base = {
    tipo: "llamada",
    startUtc: "2026-11-10T13:00:00.000Z",
    nombre: "María Pérez",
    telefono: "+56 9 1234 5678",
  };

  it("acepta lo mínimo y trata el correo vacío como ausente", () => {
    const r = publicBookingSchema.safeParse({ ...base, email: "" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.email).toBeUndefined();
  });

  it("normaliza el correo y rechaza uno malo, un nombre corto y una fecha que no es fecha", () => {
    const ok = publicBookingSchema.safeParse({ ...base, email: "  MARIA@Correo.CL " });
    expect(ok.success && ok.data.email).toBe("maria@correo.cl");

    expect(publicBookingSchema.safeParse({ ...base, email: "no-es-correo" }).success).toBe(false);
    expect(publicBookingSchema.safeParse({ ...base, nombre: "A" }).success).toBe(false);
    expect(publicBookingSchema.safeParse({ ...base, startUtc: "mañana" }).success).toBe(false);
    expect(publicBookingSchema.safeParse({ ...base, telefono: "" }).success).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Rutas                                                              */
/* ------------------------------------------------------------------ */

const h = vi.hoisted(() => ({
  gate: null as unknown,
  bookPublic: vi.fn(),
  availability: vi.fn(),
}));

vi.mock("@/server/agenda/public", async () => {
  class PublicBookingError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return {
    PublicBookingError,
    loadPublicContext: async () => h.gate,
    bookPublic: (...a: unknown[]) => h.bookPublic(...a),
    businessWhatsappDigits: async () => "56939504939",
  };
});
vi.mock("@/server/agenda/availability-types", () => ({
  computeAvailabilityForType: (...a: unknown[]) => h.availability(...a),
}));

import { GET as getTipos } from "@/app/api/public/agenda/tipos/route";
import { GET as getHorarios } from "@/app/api/public/agenda/horarios/route";
import { POST as reservar } from "@/app/api/public/agenda/reservar/route";
import { PublicBookingError } from "@/server/agenda/public";
import { BookingError } from "@/server/agenda/service";

const okGate = () => ({
  ok: true,
  ctx: {
    organizationId: "org_1",
    settings: { appointmentTypes: tipos(), timezone: "America/Santiago" },
  },
});

const post = (body: unknown, ip = "1.1.1.1") =>
  reservar(
    new Request("http://x/api/public/agenda/reservar", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );

const VALIDO = {
  tipo: "llamada",
  startUtc: "2026-11-10T13:00:00.000Z",
  nombre: "María Pérez",
  telefono: "+56 9 1234 5678",
};

beforeEach(() => {
  resetRateLimit();
  h.gate = okGate();
  h.bookPublic.mockReset();
  h.availability.mockReset();
});

describe("GET /tipos y /horarios", () => {
  it("la lista pública NO filtra correos de quien atiende", async () => {
    const res = await getTipos(new Request("http://x/api/public/agenda/tipos"));
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain("jaimea.silva");
    expect(text).not.toContain("cristobalcarvajal2005");
    expect(JSON.parse(text).tipos).toHaveLength(2);
  });

  it("sin agenda encendida o sin tipos, responde lo que diga la puerta", async () => {
    h.gate = { ok: false, response: new Response(null, { status: 404 }) };
    const res = await getTipos(new Request("http://x/api/public/agenda/tipos"));
    expect(res.status).toBe(404);
  });

  it("horarios agrupados por día, sin exponer el aviso interno del calendario", async () => {
    h.availability.mockResolvedValue({
      slots: [
        { startUtc: "2026-11-10T13:00:00.000Z", endUtc: "2026-11-10T14:00:00.000Z", label: "x" },
      ],
      calendarWarning: "No pude leer el calendario de jaime@x.cl",
    });
    const res = await getHorarios(
      new Request("http://x/api/public/agenda/horarios?tipo=aerodromo")
    );
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain("calendarWarning");
    expect(text).not.toContain("jaime@x.cl");
    expect(JSON.parse(text).dias[0].slots[0].time).toBe("10:00");
  });

  it("un tipo que no existe es 422", async () => {
    const res = await getHorarios(
      new Request("http://x/api/public/agenda/horarios?tipo=helicoptero")
    );
    expect(res.status).toBe(422);
    expect(h.availability).not.toHaveBeenCalled();
  });
});

describe("POST /reservar", () => {
  it("201 con lo que la persona necesita ver, sin datos internos", async () => {
    h.bookPublic.mockResolvedValue({
      result: { label: "mar 10 nov, 10:00", meetingLink: null, linkPending: false },
      type: tipos()[1],
    });
    const res = await post(VALIDO);
    expect(res.status).toBe(201);
    const j = await res.json();
    expect(j).toMatchObject({ ok: true, label: "mar 10 nov, 10:00", whatsapp: "56939504939" });
    expect(JSON.stringify(j)).not.toContain("cristobalcarvajal2005");
  });

  it("el señuelo lleno: responde ok y NO crea nada", async () => {
    const res = await post({ ...VALIDO, website: "http://spam.example" });
    expect(res.status).toBe(201);
    expect(h.bookPublic).not.toHaveBeenCalled();
  });

  it("cuerpo ilegible o inválido es 422 con el motivo, sin tocar la agenda", async () => {
    expect((await post("{roto")).status).toBe(422);
    const mala = await post({ ...VALIDO, nombre: "A" });
    expect(mala.status).toBe(422);
    expect((await mala.json()).error.message).toContain("nombre");
    expect(h.bookPublic).not.toHaveBeenCalled();
  });

  it("una cita activa del mismo tipo es 409 con su explicación", async () => {
    h.bookPublic.mockRejectedValue(new PublicBookingError("ya_tiene_cita", "Ya tienes una cita"));
    const res = await post(VALIDO);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("ya_tiene_cita");
  });

  it("teléfono inválido es 422", async () => {
    h.bookPublic.mockRejectedValue(new PublicBookingError("telefono_invalido", "Revisa tu teléfono"));
    expect((await post(VALIDO)).status).toBe(422);
  });

  it("si el horario se ocupó, 409 con el sobre estándar (y alternativas)", async () => {
    h.bookPublic.mockRejectedValue(
      new BookingError("slot_taken", "Ese horario ya no está disponible", [])
    );
    const res = await post(VALIDO);
    expect(res.status).toBe(409);
    const j = await res.json();
    expect(j.error.code).toBe("slot_taken");
    expect(Array.isArray(j.slots)).toBe(true);
  });

  it("el límite por IP: la séptima reserva en diez minutos es 429, y otra IP no se afecta", async () => {
    h.bookPublic.mockResolvedValue({
      result: { label: "x", meetingLink: null, linkPending: false },
      type: tipos()[1],
    });
    for (let i = 0; i < 6; i++) expect((await post(VALIDO, "9.9.9.9")).status).toBe(201);
    expect((await post(VALIDO, "9.9.9.9")).status).toBe(429);
    expect((await post(VALIDO, "8.8.8.8")).status).toBe(201);
  });
});
