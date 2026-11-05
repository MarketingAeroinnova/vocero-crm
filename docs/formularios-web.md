# Formularios web → Vocero (MetForm, Elementor, cualquier POST)

`POST /api/forms/<token>` crea el contacto en la etapa **Nuevo** del
Pipeline con origen **Landing**. El mismo teléfono enviado dos veces no
duplica nada: suma los campos nuevos a la ficha. No escribe por WhatsApp (la
persona no escribió primero; eso exigiría una plantilla aprobada por Meta).

## Token

Segmento secreto de la URL: `FORM_WEBHOOK_TOKEN` (opcional, `openssl rand -hex 24`);
si no existe se usa `META_WEBHOOK_VERIFY_TOKEN`. Token incorrecto → 404.
Comprobar la URL: abrirla en el navegador (GET) debe responder `{"ok":true}`.

## MetForm

Editar el formulario → **Settings → Webhook** → activar, URL:
`https://crm.aeroinnova.com/api/forms/<token>`. MetForm envía los campos
como `application/x-www-form-urlencoded`; también se acepta JSON.

- Teléfono: el campo debe llamarse (o terminar en) `telefono`, `phone`, `celular`,
  `whatsapp`, `fono` o `tel`. `9 3950 4939` se interpreta como móvil de Chile (+56).
- Nombre: `nombre`/`name`/`fname` (+ `apellido`/`lname`). Correo: `email`/`correo`.
- Todo lo demás (curso, duración, cuotas…) queda en la ficha del contacto.

## Respuestas

`200 {ok, created}` · `404` token · `422` `sin_telefono` | `telefono_invalido` |
`cuerpo_ilegible` · `413` · `429` (60/min por IP) · `503` sin organización.

## Consultas, históricos y respuesta por correo (070)

Cada envío queda además como fila en `form_submission` (correo, nombre, teléfono,
programa, motivo, mensaje, fecha). Sirve para reconocer a quien ya había escrito:
si llega un envío con un correo o teléfono conocido, la ficha del contacto suma
`consultas_previas` y `ultima_consulta_previa`.

- `POST /api/forms/<token>` ahora responde también `submissionId` y `previas`.
- `POST /api/forms/<token>/respuesta` `{submissionId, estado: "enviado"|"fallido"}`:
  el sitio avisa si el correo automático salió; queda en la consulta y en la
  ficha (`respuesta_correo`). Un equipo que responde a mano puede editar esa
  clave en la ficha.
- `POST /api/forms/historicos` (con sesión): carga consultas anteriores al CRM
  (`{rows:[{fecha ISO, nombre, apellidos, email, motivo, mensaje, telefono?}]}`,
  hasta 500). No crea contactos ni leads; es re-ejecutable.
- Campo del formulario: `mf-programa` (privado, comercial, mcc, ltc, drones, otro).

## Plantilla del correo automático

El correo de respuesta se arma en el sitio (WordPress) pero su contenido se edita
aquí, en `public/email/`:

- `correo-aeroinnova.html`: la plantilla. Marcadores `{{nombre}}`,
  `{{bloque_programa}}` y `{{texto_whatsapp}}`.
- `programas.json`: el párrafo por programa de interés (`privado`, `comercial`,
  `mcc`, `ltc`, `drones`) y `_default` si no eligió o no se reconoce.

Se publican en `https://crm.aeroinnova.com/email/…`; el fragmento de WordPress las
baja y las guarda 1 hora. Si el CRM no responde, sale un correo de texto simple.
No pongas datos privados en esos archivos: son públicos.
