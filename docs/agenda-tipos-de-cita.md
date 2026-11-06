# Tipos de cita

Con **tipos de cita**, una misma agenda atiende de formas distintas: una llamada
con una persona, una visita a la escuela con otra, una videollamada. Cada tipo
trae su responsable, su horario, su duración, su traslado y cómo se entrega.

Sin tipos configurados la agenda funciona **exactamente como antes** (un solo
horario para todo). Es opt-in: nada cambia hasta que se carga una lista.

## Qué trae cada tipo

| Campo | Qué es |
|---|---|
| `key`, `label` | Identificador estable y nombre que se muestra. |
| `resource` | La persona. Dos tipos con el mismo `resource` **comparten agenda**: lo que ocupa uno bloquea al otro. Personas distintas no se estorban. |
| `attendeeEmail` | A quien Google le manda la invitación (solo la de sus citas). |
| `durationMinutes` | Duración de la cita. |
| `weeklyHours` | Horario por día, en hora del negocio. Un día sin horario no se ofrece. |
| `bufferBeforeMinutes` / `bufferAfterMinutes` | Traslado: no es parte de la cita pero **sí ocupa a la persona**. |
| `minNoticeHours` / `maxDaysAhead` | Aviso mínimo y hasta cuántos días adelante. |
| `delivery` | `meet` (videollamada), `phone` (llamada) o `in_person` (presencial). |
| `location` | Dónde es (dirección). |

## Cómo se calcula lo reservable

```
horario del tipo
 − citas de la misma persona (con su traslado)
 − bloqueos manuales del negocio
 − lo que la persona tiene ocupado en su Google Calendar
```

- **Su propio calendario manda para bloquear.** Si la persona crea un evento
  (un vuelo, una clase, otra reunión), esas horas dejan de ofrecerse. Para eso
  su calendario debe estar compartido con la cuenta del CRM en modo
  **«Ver solo si estoy ocupado/a»**: el CRM jamás ve títulos ni detalles.
- Si Google no responde o el calendario no está compartido, se ofrece lo que el
  CRM sabe y la respuesta trae `calendarWarning`. Nunca se inventa «libre».
- **Fuera de horario**: el operador puede reservar o mover una cita con tipo
  fuera de horario (un sábado «a solicitud»); el choque con otra cita de esa
  persona sigue mandando. El bot nunca puede.

## Google Calendar

Se crea **un evento por cita** en el calendario del CRM, con la persona como
invitada: Google le manda el correo y el evento aparece en su calendario. Solo
las videollamadas llevan Meet. Al mover o cancelar, Google avisa a los
invitados. El título y la descripción dicen a quién atender (nombre, teléfono,
programa de interés, motivo).

Hace falta el permiso `calendar.freebusy` además de `calendar.events`. Si el
refresh token se generó solo con `calendar.events`, hay que **generarlo de nuevo**
con los dos.

## API

- `GET /api/calendar/types` · `PUT /api/calendar/types` — leer / reemplazar la
  lista (`{types, defaultTypeKey}`). Un error en un tipo no guarda ninguno y dice
  cuál es. `types: []` los quita.
- `GET /api/calendar/availability?type=<key>` — horarios de un tipo (operador).
- `GET /api/bot/availability?conversationId=…&tipo=<key>` — horarios de un tipo
  para el bot; quedan registrados como ofrecidos **para ese tipo**.
- `POST /api/bot/bookings` `{conversationId, startUtc, tipo?}` — reserva; si no
  se manda `tipo` vale el del horario ofrecido (o `defaultTypeKey`).
- `POST /api/bookings` `{…, typeKey?}` — el operador reserva con un tipo.

Con tipos configurados y sin `tipo` ni `defaultTypeKey`, el bot recibe 422 con la
lista de tipos disponibles.

## Anti doble reserva

El índice único de la base es por **persona e instante**
(`booking_org_resource_active_slot_uq`). Las citas anteriores a los tipos tienen
`resource` vacío y siguen compartiendo una sola agenda, como antes. El choque de
horarios que no empiezan igual (la visita de 11:00 y una cita de 11:30 de la
misma persona) lo evita la re-validación al confirmar, igual que en la agenda
de siempre.

## Preset de Aeroinnova

[`preset-agenda-aeroinnova.json`](preset-agenda-aeroinnova.json) es el cuerpo
del `PUT /api/calendar/types` con las cuatro citas: llamada (Cristóbal, 20 min),
entrevista en la oficina (60 min), visita al aeródromo La Victoria de Chacabuco
(60 min, solo de 10:00 a 13:00, con una hora de traslado antes y después) y
videollamada (45 min). Los tres últimos los atiende Jaime Andrés Silva.

## Página pública de agenda (`/agendar`)

Una página SIN sesión donde la persona elige cómo conversar, cuándo y deja sus
datos. Es la forma de agendar cuando el bot no puede elegir el tipo de cita:
el bot comparte el enlace `https://<tu-dominio>/agendar` al final del embudo y
la persona hace el resto.

Pasos: modalidad (los tipos configurados) → día y hora (solo lo reservable de
ese tipo) → nombre, teléfono (obligatorio), correo y nota (opcionales).

Qué pasa al confirmar:

- La persona se une a su contacto por **teléfono** (si ya escribió por WhatsApp,
  es el mismo contacto) o se crea uno nuevo en «Nuevo», y se avanza su etapa.
- La cita nace con **origen «web»** («Agendó el cliente» en la agenda) y con la
  invitación de Google a quien atiende. Si la persona dejó su correo, también
  recibe la invitación, con el lugar o el enlace de Meet.
- El evento lleva el teléfono y un enlace de WhatsApp para coordinar atrasos.

Qué NO puede hacer (es una superficie abierta a internet):

- No expone el correo de quien atiende ni su calendario: solo nombre, modalidad,
  lugar, duración y descripción de cada tipo.
- Solo reserva lo que la agenda ofrece: horario del tipo, aviso mínimo, sin
  chocar con la persona que atiende (incluido su calendario de Google).
  **Nunca** fuera de horario: eso es solo del operador.
- Una cita activa por tipo y persona. Límite por IP: 60 lecturas por minuto y 6
  reservas cada 10 minutos. Un campo señuelo detecta bots: se les responde «ok»
  sin crear nada.

Endpoints (`/api/public/agenda/…`): `GET tipos`, `GET horarios?tipo=<key>`,
`POST reservar`. Con la agenda apagada, o sin tipos configurados, responden 404.
