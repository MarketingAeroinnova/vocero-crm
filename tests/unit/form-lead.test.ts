import { describe, expect, it } from "vitest";
import {
  extractFormLead,
  nombrePrograma,
  normalizeFormPhone,
  parseFormBody,
  resumenConsultasPrevias,
  textoRespuestaCorreo,
} from "@/lib/form-lead";

describe("normalizeFormPhone", () => {
  it.each([
    ["9 3950 4939", "56939504939"],
    ["+56 9 3950 4939", "56939504939"],
    ["0993950493", "56993950493"],
    ["56939504939", "56939504939"],
    ["+52 1 55 1234 5678", "525512345678"],
  ])("%s → %s", (raw, esperado) => {
    expect(normalizeFormPhone(raw)).toEqual({ ok: true, phone: esperado });
  });

  it("rechaza vacío y números sin código de país", () => {
    expect(normalizeFormPhone("")).toEqual({ ok: false, reason: "sin_telefono" });
    expect(normalizeFormPhone("12345")).toEqual({ ok: false, reason: "telefono_invalido" });
    expect(normalizeFormPhone("1".repeat(16))).toEqual({ ok: false, reason: "telefono_invalido" });
  });
});

describe("parseFormBody", () => {
  it("entiende urlencoded y JSON, y rechaza basura", () => {
    expect(parseFormBody("a=1&b=hola+mundo", "application/x-www-form-urlencoded")).toEqual({
      a: "1",
      b: "hola mundo",
    });
    expect(parseFormBody('{"a":1}', "application/json")).toEqual({ a: 1 });
    expect(parseFormBody("[1]", "application/json")).toBeNull();
    expect(parseFormBody("{roto", "application/json")).toBeNull();
    expect(parseFormBody("  ", null)).toBeNull();
  });
});

describe("extractFormLead", () => {
  it("detecta nombre, teléfono y correo con nombres de campo de MetForm", () => {
    const r = extractFormLead({
      "mf-listing-fname": "Ana",
      "mf-listing-lname": "Pérez",
      "mf-telephone": "+56 9 1234 5678",
      "mf-email": "ana@correo.cl",
      curso: "Piloto Privado",
      cuotas: "12",
      form_id: "674",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lead.name).toBe("Ana Pérez");
    expect(r.lead.phone).toBe("56912345678");
    expect(r.lead.email).toBe("ana@correo.cl");
    expect(r.lead.programa).toBe("Piloto Privado");
    expect(r.lead.ficha).toEqual({ cuotas: "12", email: "ana@correo.cl", programa: "Piloto Privado" });
  });

  it("sin nombre usa el teléfono como nombre", () => {
    const r = extractFormLead({ Telefono: "939504939" });
    expect(r.ok && r.lead.name).toBe("56939504939");
  });

  it("sin teléfono o con teléfono inválido devuelve el motivo", () => {
    expect(extractFormLead({ nombre: "Ana" })).toEqual({ ok: false, reason: "sin_telefono" });
    expect(extractFormLead({ telefono: "123" })).toEqual({ ok: false, reason: "telefono_invalido" });
  });
});

describe("programa, motivo y mensaje", () => {
  it("los separa del resto y traduce el programa a su nombre", () => {
    const r = extractFormLead({
      "mf-first-name": "Ana",
      "mf-telephone": "9 1234 5678",
      "mf-email": "ANA@Correo.cl",
      "mf-programa": "privado",
      "mf-subject": "Quiero saber más",
      "mf-comment": "Hola, me interesa volar",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lead.programa).toBe("Piloto Privado");
    expect(r.lead.motivo).toBe("Quiero saber más");
    expect(r.lead.mensaje).toBe("Hola, me interesa volar");
    expect(r.lead.email).toBe("ana@correo.cl");
    expect(r.lead.ficha.programa).toBe("Piloto Privado");
  });

  it("un programa desconocido se conserva tal cual", () => {
    expect(nombrePrograma("Otro curso")).toBe("Otro curso");
    expect(nombrePrograma("")).toBeNull();
    expect(nombrePrograma("otro")).toBe("Aún no lo sabe");
  });
});

describe("consultas previas", () => {
  it("la primera consulta no agrega nada a la ficha", () => {
    expect(resumenConsultasPrevias([])).toEqual({});
  });

  it("cuenta y recuerda la más reciente", () => {
    const r = resumenConsultasPrevias([
      { submittedAt: new Date("2025-03-10T15:00:00Z"), programa: null, motivo: "Precio", respuestaCorreo: "sin_dato" },
      { submittedAt: new Date("2026-01-20T15:00:00Z"), programa: "Piloto Comercial", motivo: "Requisitos", respuestaCorreo: "sin_dato" },
    ]);
    expect(r.consultas_previas).toBe(2);
    expect(r.ultima_consulta_previa).toBe("20-01-2026 · Piloto Comercial · Requisitos");
  });

  it("el texto de respuesta distingue enviado de fallido", () => {
    const d = new Date("2026-11-05T18:00:00Z");
    expect(textoRespuestaCorreo("enviado", d)).toBe("Automático enviado 05-11-2026");
    expect(textoRespuestaCorreo("fallido", d)).toContain("NO se pudo enviar");
  });
});
