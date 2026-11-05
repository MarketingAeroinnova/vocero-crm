import { normalizeMx } from "@/lib/meta/client";

/**
 * Lead de un formulario web (MetForm, Elementor, cualquier POST): la parte PURA.
 *
 * El formulario es de un tercero y cada sitio nombra sus campos distinto
 * (`mf-listing-fname`, `nombre`, `Telefono`…), así que no se exige un esquema
 * fijo: se detectan nombre, teléfono y correo por el nombre del campo y TODO lo
 * demás pasa a la ficha del contacto, donde el cerebro y el dueño lo leen.
 */

export type FormLead = {
  name: string;
  /** Identidad de WhatsApp (solo dígitos, con código de país). */
  phone: string;
  email: string | null;
  /** Resto de campos del formulario, ya acotados, para la ficha. */
  ficha: Record<string, string>;
};

export type FormLeadError = "sin_telefono" | "telefono_invalido";

const PHONE_KEYS = ["telefono", "tel", "phone", "fono", "celular", "movil", "whatsapp", "mobile"];
const EMAIL_KEYS = ["email", "correo", "mail"];
const NAME_KEYS = ["nombre", "name", "fname", "firstname"];
const SURNAME_KEYS = ["apellido", "lname", "lastname", "surname"];

/** Campos técnicos que MetForm/WordPress agregan y que no son del interesado. */
const IGNORED_KEYS = [
  "form_id",
  "form_nonce",
  "nonce",
  "action",
  "recaptcha",
  "g-recaptcha",
  "_wp",
  "referer",
  "submit",
  "mf-captcha",
];

const MAX_FIELDS = 40;
const MAX_KEY_LEN = 60;
const MAX_VALUE_LEN = 500;

const plain = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/** Quita prefijos de MetForm (`mf-listing-fname` → `fname`) y separadores. */
const tail = (key: string) => plain(key).replace(/^mf[-_](listing|input)?[-_]?/, "");

const matches = (key: string, candidates: string[]) => {
  const t = tail(key).replace(/[^a-z0-9]/g, "");
  return candidates.some((c) => t === c || t.endsWith(c) || t.startsWith(c));
};

/**
 * Cuerpo crudo a un objeto plano. Acepta JSON y `application/x-www-form-urlencoded`
 * (el formato por defecto de los webhooks de MetForm). Devuelve `null` si no
 * se entiende.
 */
export function parseFormBody(
  raw: string,
  contentType: string | null
): Record<string, unknown> | null {
  const text = raw.trim();
  if (!text) return null;
  const isJson = (contentType ?? "").includes("json") || text.startsWith("{");
  if (isJson) {
    try {
      const v: unknown = JSON.parse(text);
      return v && typeof v === "object" && !Array.isArray(v)
        ? (v as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of new URLSearchParams(text)) out[k] = v;
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Teléfono a identidad de WhatsApp.
 *
 * Un formulario chileno trae el número como lo escribe la gente: `9 3950 4939`,
 * `+56 9 3950 4939`, `0993950493`. Con 9 dígitos que empiezan en 9 se asume
 * móvil de Chile (+56), que es el caso de este negocio; con código de país se
 * respeta tal cual. Menos que eso no sirve: un contacto sin código de país
 * jamás casaría con quien escriba después.
 */
export function normalizeFormPhone(
  raw: string
): { ok: true; phone: string } | { ok: false; reason: FormLeadError } {
  let digits = raw.replace(/\D/g, "").replace(/^00/, "");
  if (!digits) return { ok: false, reason: "sin_telefono" };
  if (digits.length === 9 && digits.startsWith("9")) digits = `56${digits}`;
  else if (digits.length === 10 && digits.startsWith("09")) digits = `56${digits.slice(1)}`;
  if (digits.length < 11 || digits.length > 15) {
    return { ok: false, reason: "telefono_invalido" };
  }
  return { ok: true, phone: normalizeMx(digits) };
}

const asText = (v: unknown): string | null => {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    const parts = v.map(asText).filter((x): x is string => Boolean(x));
    return parts.length ? parts.join(", ") : null;
  }
  return null;
};

/** Cuerpo del formulario a un lead listo para guardar, o el motivo por el que no. */
export function extractFormLead(
  body: Record<string, unknown>
): { ok: true; lead: FormLead } | { ok: false; reason: FormLeadError } {
  let phoneRaw: string | null = null;
  let email: string | null = null;
  let first: string | null = null;
  let last: string | null = null;
  const rest: Record<string, string> = {};

  for (const [key, value] of Object.entries(body)) {
    const text = asText(value);
    if (!text) continue;
    const k = plain(key);
    if (IGNORED_KEYS.some((i) => k.startsWith(i))) continue;

    if (!phoneRaw && matches(key, PHONE_KEYS)) phoneRaw = text;
    else if (!email && matches(key, EMAIL_KEYS)) email = text.slice(0, 200);
    else if (!last && matches(key, SURNAME_KEYS)) last = text;
    else if (!first && matches(key, NAME_KEYS)) first = text;
    else if (
      Object.keys(rest).length < MAX_FIELDS &&
      key.length <= MAX_KEY_LEN
    ) {
      rest[tail(key).slice(0, MAX_KEY_LEN) || key] = text.slice(0, MAX_VALUE_LEN);
    }
  }

  if (!phoneRaw) return { ok: false, reason: "sin_telefono" };
  const phone = normalizeFormPhone(phoneRaw);
  if (!phone.ok) return phone;

  const name =
    [first, last]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || phone.phone;

  const ficha = { ...rest };
  if (email) ficha.email = email;
  return { ok: true, lead: { name, phone: phone.phone, email, ficha } };
}
