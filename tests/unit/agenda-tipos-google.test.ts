import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { googleConnector } from "@/server/agenda/connectors/google";
import { clearGoogleTokenCache } from "@/server/agenda/connectors/google-credentials";

/**
 * 070 — El conector de Google con tipos de cita: invitar a la persona que
 * atiende, poner el lugar, no crear Meet cuando es una llamada o una visita,
 * avisar al mover o cancelar, y leer solo «ocupado/libre» de su calendario.
 */

vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    GOOGLE_CAL_BASE_URL: "https://cal.google.test/v3",
    GOOGLE_OAUTH_BASE_URL: "https://oauth.google.test",
  }),
}));

const creds = {
  clientId: "cli_1",
  clientSecret: "sec_1",
  refreshToken: "ref_1",
  calendarId: "marketing@aeroinnova.com",
  status: "connected" as const,
};

const REQ = {
  topic: "Visita al aeródromo La Victoria — Ana",
  startUtc: "2026-11-10T13:00:00.000Z",
  durationMinutes: 60,
  timezone: "America/Santiago",
};

type Call = { url: string; method: string; body: unknown };
const calls: Call[] = [];

beforeEach(() => {
  clearGoogleTokenCache();
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      let body: unknown = null;
      try {
        body = init?.body ? JSON.parse(String(init.body)) : null;
      } catch {
        body = String(init?.body); // el token va como formulario, no como JSON
      }
      calls.push({ url, method, body });
      if (url.endsWith("/token")) return Response.json({ access_token: "tk", expires_in: 3600 });
      if (url.includes("/freeBusy")) {
        return Response.json({
          calendars: {
            "jaime@aeroinnova.com": {
              busy: [{ start: "2026-11-10T14:00:00-03:00", end: "2026-11-10T15:00:00-03:00" }],
            },
            "privado@gmail.com": { busy: [], errors: [{ reason: "notFound" }] },
          },
        });
      }
      if (method === "POST") {
        return Response.json({
          id: "evt_9",
          hangoutLink: "https://meet.google.test/xyz",
        });
      }
      return new Response(null, { status: 204 });
    })
  );
});
afterEach(() => vi.unstubAllGlobals());

const eventCalls = () => calls.filter((c) => c.url.includes("/events") && c.method === "POST");

describe("crear el evento", () => {
  it("con invitado y sin Meet: manda la invitación, el lugar y NO crea videollamada", async () => {
    const out = await googleConnector.createMeeting(creds, {
      ...REQ,
      attendees: ["jaimea.silva@aeroinnova.com"],
      location: "Aeródromo La Victoria, Chacabuco, comuna de Colina",
      notes: "Contacto: Ana",
      meet: false,
    });
    const post = eventCalls()[0]!;
    expect(post.url).toContain("sendUpdates=all");
    expect(post.url).not.toContain("conferenceDataVersion");
    const body = post.body as Record<string, unknown>;
    expect(body.attendees).toEqual([{ email: "jaimea.silva@aeroinnova.com" }]);
    expect(body.location).toBe("Aeródromo La Victoria, Chacabuco, comuna de Colina");
    expect(body.conferenceData).toBeUndefined();
    // No hay enlace que esperar: no se re-lee el evento.
    expect(calls.filter((c) => c.method === "GET")).toHaveLength(0);
    expect(out.externalId).toBe("evt_9");
  });

  it("con Meet e invitado: pide la videollamada Y la invitación", async () => {
    const out = await googleConnector.createMeeting(creds, {
      ...REQ,
      attendees: ["jaimea.silva@aeroinnova.com"],
      meet: true,
    });
    const post = eventCalls()[0]!;
    expect(post.url).toContain("conferenceDataVersion=1");
    expect(post.url).toContain("sendUpdates=all");
    expect((post.body as { conferenceData?: unknown }).conferenceData).toBeDefined();
    expect(out.joinUrl).toBe("https://meet.google.test/xyz");
  });

  it("sin invitados ni tipo se comporta EXACTAMENTE como siempre", async () => {
    await googleConnector.createMeeting(creds, REQ);
    const post = eventCalls()[0]!;
    expect(post.url).toContain("conferenceDataVersion=1");
    expect(post.url).not.toContain("sendUpdates");
    const body = post.body as Record<string, unknown>;
    expect(body.attendees).toBeUndefined();
    expect(body.location).toBeUndefined();
    expect(body.conferenceData).toBeDefined();
  });
});

describe("mover y cancelar avisan a los invitados", () => {
  it("mover y borrar piden sendUpdates=all", async () => {
    await googleConnector.updateMeeting(creds, "evt_9", {
      startUtc: REQ.startUtc,
      durationMinutes: 60,
      timezone: "America/Santiago",
    });
    await googleConnector.deleteMeeting(creds, "evt_9");
    const mutaciones = calls.filter((c) => c.method === "PATCH" || c.method === "DELETE");
    expect(mutaciones).toHaveLength(2);
    for (const m of mutaciones) expect(m.url).toContain("sendUpdates=all");
  });
});

describe("ocupado/libre de las personas", () => {
  it("devuelve lo ocupado en UTC, y dice cuando un calendario no se puede leer", async () => {
    const r = await googleConnector.freeBusy!(
      creds,
      ["jaime@aeroinnova.com", "privado@gmail.com", "nadie@x.cl"],
      "2026-11-09T00:00:00.000Z",
      "2026-11-30T00:00:00.000Z"
    );
    expect(r["jaime@aeroinnova.com"]).toEqual({
      busy: [{ startUtc: "2026-11-10T17:00:00.000Z", endUtc: "2026-11-10T18:00:00.000Z" }],
    });
    // No compartido con la cuenta del CRM: se avisa, no se inventa «libre».
    expect(r["privado@gmail.com"]!.error).toBe("notFound");
    // Google ni lo devolvió.
    expect(r["nadie@x.cl"]!.error).toBeDefined();

    const q = calls.find((c) => c.url.includes("/freeBusy"))!;
    expect((q.body as { items: { id: string }[] }).items).toHaveLength(3);
  });

  it("sin calendarios no llama a Google", async () => {
    expect(await googleConnector.freeBusy!(creds, [], "a", "b")).toEqual({});
    expect(calls.filter((c) => c.url.includes("/freeBusy"))).toHaveLength(0);
  });
});
