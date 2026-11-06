import { describe, expect, it } from "vitest";
import {
  composeEventNotes,
  composeEventTopic,
  buildTypeCandidates,
  filterFreeForType,
  fitsIgnoringHours,
  occupiedWindow,
  parseAppointmentTypes,
  phoneForHumans,
  pickAppointmentType,
  readAppointmentTypes,
  type AppointmentType,
} from "@/lib/appointment-types";

const TZ = "America/Santiago";
const LV = (start: string, end: string) => ({
  mon: [{ start, end }],
  tue: [{ start, end }],
  wed: [{ start, end }],
  thu: [{ start, end }],
  fri: [{ start, end }],
});

/** Lunes 9 de noviembre de 2026, hora de Santiago (UTC-3, horario de verano). */
const L = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 9, h + 3, m)).toISOString();

const PRESET = [
  {
    key: "llamada",
    label: "Llamada telefónica",
    resource: "cristobal",
    attendeeEmail: "cristobalcarvajal2005@gmail.com",
    durationMinutes: 20,
    weeklyHours: LV("10:00", "18:00"),
    delivery: "phone",
    minNoticeHours: 2,
  },
  {
    key: "oficina",
    label: "Entrevista en la oficina",
    resource: "jaime",
    attendeeEmail: "jaimea.silva@aeroinnova.com",
    durationMinutes: 60,
    weeklyHours: LV("10:00", "18:00"),
    delivery: "in_person",
    location: "Camino El Alba 9500, Torre B, oficina 405, Las Condes",
  },
  {
    key: "aerodromo",
    label: "Visita al aeródromo La Victoria",
    resource: "jaime",
    attendeeEmail: "jaimea.silva@aeroinnova.com",
    durationMinutes: 60,
    weeklyHours: LV("10:00", "13:00"),
    bufferBeforeMinutes: 60,
    bufferAfterMinutes: 60,
    minNoticeHours: 24,
    delivery: "in_person",
    location: "Aeródromo La Victoria, Chacabuco, comuna de Colina",
  },
  {
    key: "videollamada",
    label: "Videollamada",
    resource: "jaime",
    attendeeEmail: "jaimea.silva@aeroinnova.com",
    durationMinutes: 45,
    weeklyHours: LV("10:00", "18:00"),
    delivery: "meet",
  },
];

function types(): AppointmentType[] {
  const r = parseAppointmentTypes(PRESET);
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.types;
}
const tipo = (k: string) => types().find((t) => t.key === k)!;

describe("validación de los tipos", () => {
  it("acepta el preset de Aeroinnova y aplica los defaults", () => {
    const t = types();
    expect(t.map((x) => x.key)).toEqual(["llamada", "oficina", "aerodromo", "videollamada"]);
    expect(tipo("llamada").bufferBeforeMinutes).toBe(0);
    expect(tipo("llamada").maxDaysAhead).toBe(21);
    expect(tipo("aerodromo").bufferAfterMinutes).toBe(60);
  });

  it("rechaza con motivo: llave repetida, correo malo, sin horario", () => {
    const dup = parseAppointmentTypes([PRESET[0], PRESET[0]]);
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.errors.join()).toContain("repetida");

    const mail = parseAppointmentTypes([{ ...PRESET[0], attendeeEmail: "no-es-correo" }]);
    expect(mail.ok).toBe(false);

    const vacio = parseAppointmentTypes([{ ...PRESET[0], weeklyHours: {} }]);
    expect(vacio.ok).toBe(false);
    if (!vacio.ok) expect(vacio.errors.join()).toContain("ningún horario");

    expect(parseAppointmentTypes("nada").ok).toBe(false);
  });

  it("la lectura de lo guardado tolera un tipo dañado y sigue con el resto", () => {
    const leidos = readAppointmentTypes([PRESET[0], { key: "roto" }, PRESET[1]]);
    expect(leidos.map((t) => t.key)).toEqual(["llamada", "oficina"]);
  });
});

describe("candidatos por tipo", () => {
  it("aeródromo: lunes de 10:00 a 13:00 en citas de 60 min son tres", () => {
    const c = buildTypeCandidates(tipo("aerodromo"), TZ, "2026-11-09", "2026-11-09");
    expect(c.map((s) => s.startUtc)).toEqual([L(10), L(11), L(12)]);
  });

  it("llamada: 20 min entre 10:00 y 18:00 son 24 por día", () => {
    const c = buildTypeCandidates(tipo("llamada"), TZ, "2026-11-09", "2026-11-09");
    expect(c).toHaveLength(24);
    expect(c[0]!.startUtc).toBe(L(10));
    expect(c.at(-1)!.endUtc).toBe(L(18));
  });

  it("sábado y domingo no ofrecen nada (solo a solicitud)", () => {
    const sab = buildTypeCandidates(tipo("oficina"), TZ, "2026-11-14", "2026-11-15");
    expect(sab).toEqual([]);
  });
});

describe("choques entre citas de la misma persona", () => {
  const now = new Date(Date.UTC(2026, 10, 1)); // una semana antes: el aviso no estorba
  const libres = (key: string, busy: { startUtc: string; endUtc: string }[]) => {
    const t = tipo(key);
    return filterFreeForType(
      buildTypeCandidates(t, TZ, "2026-11-09", "2026-11-09"),
      busy,
      {
        now,
        timezone: TZ,
        minNoticeHours: t.minNoticeHours,
        bufferBeforeMinutes: t.bufferBeforeMinutes,
        bufferAfterMinutes: t.bufferAfterMinutes,
        durationMinutes: t.durationMinutes,
      }
    ).map((s) => s.startUtc);
  };

  it("una visita al aeródromo reserva la hora de ida y de vuelta", () => {
    // Jaime tiene una visita a las 11:00 (10:00 a 13:00 ocupado con su traslado).
    const busy = [occupiedWindow(L(11), 60, 60, 60)];
    expect(busy[0]).toEqual({ startUtc: L(10), endUtc: L(13) });
    // En la oficina puede atender a las 13:00 pero NO a las 12:00.
    const oficina = libres("oficina", busy);
    expect(oficina).not.toContain(L(10));
    expect(oficina).not.toContain(L(11));
    expect(oficina).not.toContain(L(12));
    expect(oficina).toContain(L(13));
  });

  it("una cita en la oficina a las 13:00 bloquea el aeródromo de las 12:00 (no cabe el traslado)", () => {
    const busy = [occupiedWindow(L(13), 60, 0, 0)]; // 13:00 a 14:00
    const aero = libres("aerodromo", busy);
    expect(aero).toContain(L(10)); // ventana 09:00-12:00
    expect(aero).toContain(L(11)); // ventana 10:00-13:00, termina justo cuando empieza la otra
    expect(aero).not.toContain(L(12)); // ventana 11:00-14:00 choca
  });

  it("personas distintas no se estorban: lo de Jaime no toca las llamadas de Cristóbal", () => {
    const busy = [occupiedWindow(L(11), 60, 60, 60)];
    // Quien filtra las llamadas recibe SOLO lo ocupado por Cristóbal (aquí nada).
    expect(libres("llamada", [])).toContain(L(11));
    // Y si se le pasara lo de Jaime por error, bloquearía: por eso el filtro de
    // recurso vive en la consulta, y esta prueba deja el contrato claro.
    expect(libres("llamada", busy)).not.toContain(L(11));
  });

  it("el aviso mínimo: el aeródromo pide 24 horas", () => {
    const t = tipo("aerodromo");
    const casi = new Date(Date.UTC(2026, 10, 9, 13, 0)); // lunes 10:00 Santiago
    const out = filterFreeForType(
      buildTypeCandidates(t, TZ, "2026-11-09", "2026-11-10"),
      [],
      {
        now: casi,
        timezone: TZ,
        minNoticeHours: t.minNoticeHours,
        bufferBeforeMinutes: t.bufferBeforeMinutes,
        bufferAfterMinutes: t.bufferAfterMinutes,
        durationMinutes: t.durationMinutes,
      }
    ).map((s) => s.startUtc);
    // Todo el lunes queda fuera; del martes entran las 10:00 (exactamente 24 h).
    expect(out.some((s) => Date.parse(s) < Date.parse(L(10)) + 24 * 3_600_000)).toBe(false);
    expect(out[0]).toBe(new Date(Date.parse(L(10)) + 24 * 3_600_000).toISOString());
  });
});

describe("casos excepcionales fuera de horario (el operador)", () => {
  const sabado10 = new Date(Date.UTC(2026, 10, 14, 13, 0)).toISOString();

  it("un sábado a solicitud cabe si la persona está libre", () => {
    expect(fitsIgnoringHours(sabado10, [], tipo("oficina"))).toBe(true);
  });

  it("pero el choque con otra cita suya sigue mandando", () => {
    const busy = [occupiedWindow(sabado10, 60, 60, 60)];
    expect(fitsIgnoringHours(sabado10, busy, tipo("oficina"))).toBe(false);
    expect(fitsIgnoringHours("no-es-fecha", [], tipo("oficina"))).toBe(false);
  });
});

describe("texto del evento para quien atiende", () => {
  it("el título lleva el tipo y el nombre", () => {
    expect(composeEventTopic(tipo("aerodromo"), "María Pérez")).toBe(
      "Visita al aeródromo La Victoria — María Pérez"
    );
    expect(composeEventTopic(tipo("llamada"), "  ")).toBe("Llamada telefónica");
    expect(composeEventTopic(null, "Ana")).toBe("Cita — Ana");
    expect(composeEventTopic(null, "")).toBe("Cita");
  });

  it("en una llamada dice a qué número llamar", () => {
    const n = composeEventNotes({
      type: tipo("llamada"),
      contactName: "María Pérez",
      phone: "56912345678",
      ficha: { programa: "Piloto Privado", motivo: "Quiere saber requisitos", email: "m@correo.cl" },
      notes: null,
      source: "ai",
    });
    expect(n).toContain("Llamar a: +56 9 1234 5678");
    expect(n).toContain("https://wa.me/56912345678");
    expect(n).toContain("Programa de interés: Piloto Privado");
    expect(n).toContain("Motivo de la consulta: Quiere saber requisitos");
    expect(n).toContain("Agendada por el asistente de WhatsApp.");
  });

  it("en una visita el teléfono también va, con el enlace de WhatsApp para coordinar", () => {
    const n = composeEventNotes({
      type: tipo("aerodromo"),
      contactName: "Luis",
      phone: "56987654321",
      ficha: null,
      notes: "Viene con su hijo",
      source: "manual",
    });
    expect(n).toContain("Teléfono / WhatsApp: +56 9 8765 4321");
    expect(n).toContain("Escribirle por WhatsApp: https://wa.me/56987654321");
    expect(n).not.toContain("Llamar a");
    expect(n).toContain("Notas: Viene con su hijo");
    expect(n).toContain("Agendada por el equipo.");
  });

  it("sin teléfono lo dice claro en vez de callar", () => {
    const n = composeEventNotes({
      type: tipo("videollamada"),
      contactName: "Luis",
      phone: null,
      ficha: null,
      notes: null,
      source: "ai",
    });
    expect(n).toContain("Teléfono: no registrado");
    expect(n).not.toContain("wa.me");
  });

  it("un número que no es móvil chileno queda como +dígitos", () => {
    expect(phoneForHumans("525512345678")).toBe("+525512345678");
    expect(phoneForHumans(null)).toBeNull();
    expect(phoneForHumans("")).toBeNull();
  });
});

describe("qué tipo de cita es", () => {
  const base = { types: types(), defaultTypeKey: null as string | null };

  it("sin tipos configurados no hay tipo, y pedir uno es un error", () => {
    const r = pickAppointmentType({ types: [], defaultTypeKey: null, requested: null, offeredTypeKey: null });
    expect(r).toEqual({ ok: true, type: null });
    expect(
      pickAppointmentType({ types: [], defaultTypeKey: null, requested: "llamada", offeredTypeKey: null })
    ).toEqual({ ok: false, reason: "sin_tipos" });
  });

  it("manda el pedido; si no, el del horario ofrecido; si no, el predeterminado", () => {
    const pedido = pickAppointmentType({ ...base, requested: "oficina", offeredTypeKey: null });
    expect(pedido.ok && pedido.type?.key).toBe("oficina");

    const ofrecido = pickAppointmentType({ ...base, requested: null, offeredTypeKey: "llamada" });
    expect(ofrecido.ok && ofrecido.type?.key).toBe("llamada");

    const porDefecto = pickAppointmentType({ ...base, defaultTypeKey: "videollamada", requested: null, offeredTypeKey: null });
    expect(porDefecto.ok && porDefecto.type?.key).toBe("videollamada");
  });

  it("falta el tipo, tipo desconocido, y horario ofrecido para otro tipo", () => {
    expect(pickAppointmentType({ ...base, requested: null, offeredTypeKey: null })).toEqual({
      ok: false,
      reason: "falta",
    });
    expect(pickAppointmentType({ ...base, requested: "helicoptero", offeredTypeKey: null })).toEqual({
      ok: false,
      reason: "desconocido",
      key: "helicoptero",
    });
    // Se ofreció una llamada y se intenta reservar una visita con ese horario.
    expect(pickAppointmentType({ ...base, requested: "aerodromo", offeredTypeKey: "llamada" })).toEqual({
      ok: false,
      reason: "otro_tipo",
      key: "aerodromo",
    });
  });
});
