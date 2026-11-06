import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseAppointmentTypes } from "@/lib/appointment-types";

/**
 * 070 — `bookPublic`: lo que pasa entre «la persona dio sus datos» y «la cita
 * existe». Los colaboradores se simulan; lo que se prueba es el orden y las
 * reglas de esta función.
 */

const h = vi.hoisted(() => ({
  existing: [] as unknown[],
  saveFormLead: vi.fn(),
  createSessionBooking: vi.fn(),
}));

vi.mock("@/lib/db", async (orig) => {
  const real = await orig<typeof import("@/lib/db")>();
  return {
    ...real,
    getDb: () => ({
      select: () => ({
        from: () => ({ where: () => ({ limit: async () => h.existing }) }),
      }),
    }),
  };
});
vi.mock("@/server/form-lead", () => ({
  saveFormLead: (...a: unknown[]) => h.saveFormLead(...a),
}));
vi.mock("@/server/agenda/service", () => ({
  createSessionBooking: (...a: unknown[]) => h.createSessionBooking(...a),
  BookingError: class extends Error {},
}));
vi.mock("@/server/agenda/settings", () => ({ getSettings: async () => ({}) }));
vi.mock("@/server/bot/auth", () => ({ resolveInstanceOrg: async () => "org_1" }));
vi.mock("@/server/whatsapp/credentials", () => ({ getCredentialsByOrg: async () => null }));

import { bookPublic, PublicBookingError } from "@/server/agenda/public";

const parsed = parseAppointmentTypes([
  {
    key: "llamada",
    label: "Llamada telefónica",
    resource: "cristobal",
    attendeeEmail: "cristobalcarvajal2005@gmail.com",
    durationMinutes: 20,
    weeklyHours: { mon: [{ start: "10:00", end: "18:00" }] },
    delivery: "phone",
  },
]);
if (!parsed.ok) throw new Error("fixture");
const ctx = {
  organizationId: "org_1",
  settings: { appointmentTypes: parsed.types },
} as never;

const INPUT = {
  tipo: "llamada",
  startUtc: "2026-11-10T13:00:00.000Z",
  nombre: "María Pérez",
  telefono: "9 1234 5678",
  email: "maria@correo.cl" as string | undefined,
  notas: "Quiero saber requisitos" as string | undefined,
  website: undefined,
};

beforeEach(() => {
  h.existing = [];
  h.saveFormLead.mockReset().mockResolvedValue({ contactId: "ct_1", created: true });
  h.createSessionBooking
    .mockReset()
    .mockResolvedValue({ booking: { id: "bk_1" }, label: "mar 10 nov, 10:00" });
});

describe("bookPublic", () => {
  it("normaliza el teléfono, une a la persona por él y reserva con origen web y SIN oferta previa", async () => {
    const out = await bookPublic(ctx, INPUT);

    const [org, lead] = h.saveFormLead.mock.calls[0]!;
    expect(org).toBe("org_1");
    expect(lead).toMatchObject({
      name: "María Pérez",
      phone: "56912345678",
      email: "maria@correo.cl",
    });
    expect(lead.ficha.origen_detalle).toBe("Página de agenda");
    expect(lead.ficha.notas_agenda).toBe("Quiero saber requisitos");

    expect(h.createSessionBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        contactId: "ct_1",
        startUtc: INPUT.startUtc,
        typeKey: "llamada",
        source: "web",
        requireOffer: false,
        guestEmail: "maria@correo.cl",
        notes: "Quiero saber requisitos",
      })
    );
    expect(out.type.key).toBe("llamada");
  });

  it("un tipo que no existe se rechaza antes de tocar el CRM", async () => {
    await expect(bookPublic(ctx, { ...INPUT, tipo: "helicoptero" })).rejects.toMatchObject({
      code: "tipo_desconocido",
    });
    expect(h.saveFormLead).not.toHaveBeenCalled();
    expect(h.createSessionBooking).not.toHaveBeenCalled();
  });

  it("un teléfono inválido se rechaza antes de crear el contacto", async () => {
    await expect(bookPublic(ctx, { ...INPUT, telefono: "123" })).rejects.toBeInstanceOf(
      PublicBookingError
    );
    expect(h.saveFormLead).not.toHaveBeenCalled();
  });

  it("si ya tiene una cita activa de ese tipo, no crea otra (y el contacto igual queda)", async () => {
    h.existing = [{ id: "bk_viejo" }];
    await expect(bookPublic(ctx, INPUT)).rejects.toMatchObject({ code: "ya_tiene_cita" });
    expect(h.saveFormLead).toHaveBeenCalledTimes(1);
    expect(h.createSessionBooking).not.toHaveBeenCalled();
  });

  it("sin correo ni notas no manda invitado y la ficha queda mínima", async () => {
    await bookPublic(ctx, { ...INPUT, email: undefined, notas: undefined });
    const lead = h.saveFormLead.mock.calls[0]![1];
    expect(lead.email).toBeNull();
    expect(lead.ficha).toEqual({ origen_detalle: "Página de agenda" });
    expect(h.createSessionBooking).toHaveBeenCalledWith(
      expect.objectContaining({ guestEmail: null, notes: null })
    );
  });
});
