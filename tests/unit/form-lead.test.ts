import { describe, expect, it } from "vitest";
import { extractFormLead, normalizeFormPhone, parseFormBody } from "@/lib/form-lead";

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
    expect(r.lead.ficha).toEqual({ curso: "Piloto Privado", cuotas: "12", email: "ana@correo.cl" });
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
