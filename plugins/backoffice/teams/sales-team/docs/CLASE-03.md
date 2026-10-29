# Clase 03 · Captación y atención de clientes

**Perfilado de prospectos:** criterios para calificar, preguntas de seguimiento y respuestas preparadas.
El agente prepara, tú atiendes: nada se envía solo. Usas **tu propio negocio**.

## Paso a paso (escribe esto al agente `sales-lead`)

**1. Arranque** (≈ 10 min)
> Arranca ventas. Quiero configurar mi negocio.

Responde una pregunta a la vez (son máximo 8). Al final debes ver en **Archivos → ventas/** cuatro archivos:
`oferta.md`, `cliente-ideal.md`, `criterios-de-calificacion.md`, `tono-y-reglas.md`. Revisa que los precios sean EXACTAMENTE los tuyos y corrige lo que falte.

**2. Pega 3 mensajes de prueba** (uno por mensaje; usa los tuyos o los de abajo)
> Me escribió este prospecto por WhatsApp, prepárame la respuesta: «<pega el mensaje>»

Repite con el segundo y el tercero. Por cada uno debes ver: la ficha, el puntaje /100 con el porqué, 1-2 borradores para copiar y la fecha del próximo contacto.
En la pestaña **Leads** aparece **un lead por prospecto** (columna Nuevo o En conversación) con puntaje y fecha. En **Archivos → ventas/prospectos/<nombre>/** quedan `ficha.md` y `respuestas.md`. Tú copias el borrador y lo envías.

**3. Seguimiento**
> Arma el seguimiento del prospecto <nombre>: no me ha contestado.

Verás una secuencia de 3 a 5 toques con fechas (`sequence.md`) y el lead con su nueva fecha de próximo contacto.

**4. Reporte del pipeline**
> Dame el reporte del pipeline: a quién atiendo primero hoy.

Obtienes la tabla priorizada (etapa, puntaje, siguiente paso y fecha) y alertas de prospectos fríos. Cuando una venta se cierre, tú marcas el lead como **Ganado** en la pestaña Leads (el agente no puede).

## Ejercicio opcional · Prospección en Google Maps

> Búscame 10 <tipo de negocio> en <tu ciudad> en Google Maps.

El agente `lead-qualifier` abre Maps, junta nombre, teléfono, dirección, sitio y horarios (solo datos públicos del negocio) y guarda un CSV en **Archivos → ventas/prospeccion/** (ábrelo en Excel). Luego te pregunta si los carga como **Leads** (todos, los mejor calificados o solo los que tienen teléfono). Pide cantidades modestas (30 por defecto, máx. ~100): es un navegador de verdad y Google tiene términos de uso. Nada se contacta solo.

## Ejercicio opcional · WhatsApp real

Conecta un número de **prueba** (no el principal): los mensajes llegan a **Leads**, el agente prepara el borrador y tú das clic en **Enviar**.
Pídele a Claude: «Atiende mis WhatsApp pendientes». Antes de empezar lee los riesgos y los pasos en [`WHATSAPP.md`](WHATSAPP.md).

## Mensajes de práctica (negocio pequeño genérico)

1. **WhatsApp:** «Hola, vi su anuncio en Instagram. ¿Cuánto cuesta el servicio para una fiesta de 30 personas? Es el 2 de noviembre.»
2. **Formulario de Meta:** Nombre: Laura Gómez · Teléfono: 81 0000 0000 · Interés: «información» · Comentario: «Quiero cotizar algo para mi oficina, somos 12 personas, ¿tienen factura?»
3. **Instagram (DM):** «Hola 👋 ¿hacen envíos a Saltillo? Ando viendo opciones, aún no sé mi presupuesto.»

> Los datos son ficticios. El agente no debe inventar precios ni disponibilidad: lo que no esté en `ventas/oferta.md` te lo preguntará.

## Te llevas

Skill de perfilado (`qualify-lead` + `prepared-replies`) y flujo de seguimiento (`follow-up-sequence`) funcionando con tu negocio.
