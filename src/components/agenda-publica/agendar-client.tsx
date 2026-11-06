"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarCheck, Check, MapPin, Phone, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { DayGroup, PublicType } from "@/lib/public-booking";

/**
 * 070 — Página pública de agenda: la persona elige cómo conversar, cuándo, y
 * deja sus datos. Tres pasos en una sola pantalla, pensada primero para el
 * celular (de ahí llegan desde WhatsApp).
 */

type Confirmed = {
  label: string;
  tipo: PublicType;
  meetingLink: string | null;
  linkPending: boolean;
  whatsapp: string | null;
};

const DELIVERY = {
  phone: { icon: Phone, text: "Te llamamos por teléfono" },
  meet: { icon: Video, text: "Videollamada por Google Meet" },
  in_person: { icon: MapPin, text: "Presencial" },
} as const;

async function readError(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: { message?: string } | string };
    if (typeof j.error === "object" && j.error?.message) return j.error.message;
  } catch {
    /* sin cuerpo */
  }
  return res.status === 429
    ? "Demasiados intentos. Espera unos minutos."
    : "No pudimos completar la solicitud. Inténtalo de nuevo.";
}

export function AgendarClient() {
  const [tipos, setTipos] = useState<PublicType[] | null>(null);
  const [timezone, setTimezone] = useState("America/Santiago");
  const [loadError, setLoadError] = useState<string | null>(null);

  const [tipo, setTipo] = useState<PublicType | null>(null);
  const [dias, setDias] = useState<DayGroup[] | null>(null);
  const [dia, setDia] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);

  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [email, setEmail] = useState("");
  const [notas, setNotas] = useState("");
  const [website, setWebsite] = useState(""); // señuelo: ninguna persona lo ve
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Confirmed | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/public/agenda/tipos")
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<{ tipos: PublicType[]; timezone: string }>;
      })
      .then((j) => {
        if (!alive) return;
        setTipos(j.tipos);
        setTimezone(j.timezone);
      })
      .catch(() => {
        if (alive) setLoadError("La agenda no está disponible por ahora. Escríbenos por WhatsApp.");
      });
    return () => {
      alive = false;
    };
  }, []);

  const cargarHorarios = useCallback(async (t: PublicType) => {
    setDias(null);
    setDia(null);
    setSlot(null);
    const res = await fetch(`/api/public/agenda/horarios?tipo=${encodeURIComponent(t.key)}`);
    if (!res.ok) {
      setError(await readError(res));
      setDias([]);
      return;
    }
    const j = (await res.json()) as { dias: DayGroup[] };
    setDias(j.dias);
    setDia(j.dias[0]?.dayIso ?? null);
  }, []);

  function elegirTipo(t: PublicType) {
    setTipo(t);
    setError(null);
    void cargarHorarios(t);
  }

  async function confirmar(e: React.FormEvent) {
    e.preventDefault();
    if (!tipo || !slot) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/public/agenda/reservar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tipo: tipo.key,
          startUtc: slot,
          nombre,
          telefono,
          email: email || undefined,
          notas: notas || undefined,
          website,
        }),
      });
      if (res.ok) {
        const j = (await res.json()) as Partial<Confirmed>;
        setDone({
          label: j.label ?? "",
          tipo: j.tipo ?? tipo,
          meetingLink: j.meetingLink ?? null,
          linkPending: j.linkPending ?? false,
          whatsapp: j.whatsapp ?? null,
        });
        return;
      }
      setError(await readError(res));
      // Ese horario se ocupó mientras llenabas el formulario: se vuelve a elegir.
      if (res.status === 409) void cargarHorarios(tipo);
    } finally {
      setSending(false);
    }
  }

  if (done) return <Confirmacion done={done} />;

  const delDia = dias?.find((d) => d.dayIso === dia) ?? null;
  const slotLabel =
    delDia?.slots.find((s) => s.startUtc === slot)?.time && delDia
      ? `${delDia.dayLabel}, ${delDia.slots.find((s) => s.startUtc === slot)!.time}`
      : null;

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-[-0.03em]">Agenda una conversación</h1>
        <p className="mt-2 text-sm text-text-3">
          Elige cómo prefieres conversar con nuestro equipo y el horario que mejor te acomode.
        </p>
      </div>

      {loadError && (
        <Card>
          <CardContent className="py-6 text-center text-sm">{loadError}</CardContent>
        </Card>
      )}

      {!tipos && !loadError && (
        <p className="text-center text-sm text-text-3">Cargando opciones…</p>
      )}

      {tipos && (
        <section aria-labelledby="paso1" className="space-y-3">
          <h2 id="paso1" className="text-sm font-semibold">
            1. ¿Cómo prefieres conversar?
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {tipos.map((t) => {
              const d = DELIVERY[t.delivery];
              const Icon = d.icon;
              const activo = tipo?.key === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  aria-pressed={activo}
                  onClick={() => elegirTipo(t)}
                  className={`rounded-xl border bg-background p-4 text-left transition hover:-translate-y-px hover:border-foreground ${
                    activo ? "border-foreground ring-2 ring-ring" : "border-border-strong"
                  }`}
                >
                  <span className="flex items-center gap-2 font-semibold">
                    <Icon className="h-4 w-4" aria-hidden /> {t.label}
                  </span>
                  <span className="mt-1 block text-xs text-text-3">
                    {d.text} · {t.durationMinutes} min
                  </span>
                  {t.location && t.delivery === "in_person" && (
                    <span className="mt-1 block text-xs text-text-3">{t.location}</span>
                  )}
                  {t.description && <span className="mt-2 block text-sm">{t.description}</span>}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {tipo && (
        <section aria-labelledby="paso2" className="space-y-3">
          <h2 id="paso2" className="text-sm font-semibold">
            2. Elige día y hora
          </h2>
          {!dias && <p className="text-sm text-text-3">Buscando horarios…</p>}
          {dias && dias.length === 0 && (
            <Card>
              <CardContent className="py-5 text-sm">
                Por ahora no hay horarios disponibles para esta opción. Escríbenos por WhatsApp y
                lo coordinamos.
              </CardContent>
            </Card>
          )}
          {dias && dias.length > 0 && (
            <>
              <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Días">
                {dias.map((d) => (
                  <button
                    key={d.dayIso}
                    type="button"
                    role="tab"
                    aria-selected={d.dayIso === dia}
                    onClick={() => {
                      setDia(d.dayIso);
                      setSlot(null);
                    }}
                    className={`shrink-0 rounded-full border px-3 py-1.5 text-sm ${
                      d.dayIso === dia
                        ? "border-foreground bg-foreground text-background"
                        : "border-border-strong bg-background"
                    }`}
                  >
                    {d.dayLabel}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {delDia?.slots.map((s) => (
                  <button
                    key={s.startUtc}
                    type="button"
                    aria-pressed={s.startUtc === slot}
                    onClick={() => setSlot(s.startUtc)}
                    className={`rounded-lg border px-2 py-2 text-sm ${
                      s.startUtc === slot
                        ? "border-foreground bg-foreground text-background"
                        : "border-border-strong bg-background hover:border-foreground"
                    }`}
                  >
                    {s.time}
                  </button>
                ))}
              </div>
              <p className="text-xs text-text-3">
                Horarios en hora de Chile ({timezone.replace("_", " ")}).
              </p>
            </>
          )}
        </section>
      )}

      {tipo && slot && (
        <section aria-labelledby="paso3">
          <Card>
            <CardContent className="pt-6">
              <h2 id="paso3" className="mb-1 text-sm font-semibold">
                3. Tus datos
              </h2>
              <p className="mb-4 text-sm text-text-3">
                {tipo.label}
                {slotLabel ? ` · ${slotLabel}` : ""}
              </p>
              <form onSubmit={confirmar} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="nombre">Nombre</Label>
                  <Input
                    id="nombre"
                    autoComplete="name"
                    required
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="telefono">Teléfono / WhatsApp</Label>
                  <Input
                    id="telefono"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="+56 9 1234 5678"
                    required
                    value={telefono}
                    onChange={(e) => setTelefono(e.target.value)}
                  />
                  <p className="text-xs text-text-3">
                    Lo usamos para coordinar cualquier cambio o atraso.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email">Correo (opcional)</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  <p className="text-xs text-text-3">
                    Si lo dejas, te enviamos la invitación al calendario con los detalles.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="notas">¿Algo que quieras que sepamos? (opcional)</Label>
                  <Textarea
                    id="notas"
                    rows={3}
                    maxLength={500}
                    value={notas}
                    onChange={(e) => setNotas(e.target.value)}
                  />
                </div>
                {/* Señuelo contra bots: fuera de pantalla y del orden del teclado. */}
                <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
                  <label>
                    Sitio web
                    <input
                      tabIndex={-1}
                      autoComplete="off"
                      value={website}
                      onChange={(e) => setWebsite(e.target.value)}
                    />
                  </label>
                </div>
                {error && (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                )}
                <Button type="submit" size="lg" className="w-full" disabled={sending}>
                  {sending ? "Confirmando…" : "Confirmar cita"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </section>
      )}

      {error && !slot && (
        <p role="alert" className="text-center text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function Confirmacion({ done }: { done: Confirmed }) {
  const d = DELIVERY[done.tipo.delivery];
  const wa = done.whatsapp ? `https://wa.me/${done.whatsapp}` : null;
  return (
    <Card className="shadow-md">
      <CardContent className="space-y-4 pt-8 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="h-6 w-6" aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-bold tracking-[-0.02em]">¡Tu cita está agendada!</h1>
          <p className="mt-1 flex items-center justify-center gap-2 text-sm text-text-3">
            <CalendarCheck className="h-4 w-4" aria-hidden />
            {done.tipo.label}
            {done.label ? ` · ${done.label}` : ""}
          </p>
        </div>

        <div className="rounded-xl bg-subtle p-4 text-left text-sm">
          <p className="font-medium">{d.text}</p>
          {done.tipo.delivery === "in_person" && done.tipo.location && (
            <p className="mt-1">{done.tipo.location}</p>
          )}
          {done.tipo.delivery === "phone" && (
            <p className="mt-1">Te llamaremos al número que nos dejaste, a la hora acordada.</p>
          )}
          {done.tipo.delivery === "meet" &&
            (done.meetingLink ? (
              <p className="mt-1">
                Enlace:{" "}
                <a className="underline" href={done.meetingLink}>
                  {done.meetingLink}
                </a>
              </p>
            ) : (
              <p className="mt-1">
                Te enviaremos el enlace de la videollamada. Si dejaste tu correo, te llega con la
                invitación.
              </p>
            ))}
        </div>

        <p className="text-sm text-text-3">
          Si necesitas cambiar la cita o avisar un atraso, escríbenos por WhatsApp.
        </p>
        {wa && (
          <a
            href={wa}
            className="inline-flex h-10 items-center justify-center rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground"
          >
            Escribir por WhatsApp
          </a>
        )}
      </CardContent>
    </Card>
  );
}
