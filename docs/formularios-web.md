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
