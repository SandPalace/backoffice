# WhatsApp en Back Office (opcional)

## Qué hace

Los mensajes que te escriben por WhatsApp **llegan solos a Back Office** y aparecen en **Leads** (un lead por persona) y en la
página **/whatsapp** de tu oficina. El agente de ventas **prepara** la respuesta como borrador; **tú lo revisas y das clic en
Enviar**. El agente nunca envía nada por su cuenta.

**¿No te salió el QR o quieres varios números?** Hay una segunda opción, OpenWA: pídele al equipo de ventas «conecta mi WhatsApp con OpenWA» y te guía paso a paso (revisa tu computadora, instala, te muestra el QR). Con OpenWA el agente puede enviar, pero **solo después de que tú apruebes cada mensaje** (destinatario y texto).

## Riesgos (léelos antes de empezar)

- Esto usa **open-wa, una herramienta NO oficial**. WhatsApp no la autoriza y **puede bloquear tu número**.
- Usa un **número de prueba** o un **WhatsApp Business secundario**. No uses tu número principal ni el de tu negocio real.
- Mantén **volúmenes humanos**: nada de envíos masivos ni de escribir a quien no te escribió. Back Office **solo responde a quien te escribió primero**.
- Back Office limita el envío a **20 mensajes por hora**. No intentes saltarte ese límite.
- Todo corre en tu computadora (127.0.0.1). Las llaves se guardan en `data/.env` (dentro de la carpeta de Back Office); no las compartas ni las subas a GitHub.

## Paso a paso (Mac y Windows)

Necesitas tener Google Chrome instalado y Back Office ya instalado (`INSTALL.md`).

1. **Arranca Back Office** en una terminal: `./bin/backoffice start` (desde la carpeta de Back Office; Windows `.\bin\backoffice.cmd start`).
2. **Abre una segunda terminal** (Terminal en Mac, PowerShell en Windows) y corre: `./bin/backoffice whatsapp`.
3. La primera vez genera tus llaves, te muestra el aviso de riesgo y te pide escribir **acepto**. Solo te lo pide una vez.
4. Espera a que aparezca el **código QR** en la terminal (puede tardar un minuto; si cambia, escanea el nuevo).
5. En tu teléfono: **WhatsApp → Dispositivos vinculados → Vincular dispositivo** y escanea el QR.
6. **Deja esa terminal abierta**: mientras esté abierta, los mensajes llegan. `Ctrl+C` la detiene. Para revisar el estado: `./bin/backoffice status`.
7. Pídele a alguien que te escriba al número vinculado. Abre **/whatsapp** en tu oficina (http://localhost:4781/whatsapp) y verás el mensaje.
8. En Claude escribe al agente `sales-lead`: **«Atiende mis WhatsApp pendientes»**. Prepara un borrador por chat y actualiza el lead.
9. En la oficina abre **Leads → el lead → WhatsApp** (o **/whatsapp**), revisa el borrador, edítalo si quieres y da clic en **Enviar**.

Las instrucciones son las mismas en Mac y Windows; solo cambia la terminal.

## Cómo desconectar

- Desde el teléfono: **WhatsApp → Dispositivos vinculados →** toca la sesión → **Cerrar sesión**.
- Detén el programa con `Ctrl+C` en la terminal de `./bin/backoffice whatsapp`.
- Para borrar la sesión guardada en tu computadora: `./bin/backoffice whatsapp --reset` (te pide confirmación; luego tendrás que escanear el QR otra vez).

## Problemas comunes

- **No aparece el QR:** revisa que Chrome esté instalado y que el puerto 8002 esté libre.
- **Llegan mensajes pero no se ven en Back Office:** confirma que `./bin/backoffice start` (desde la carpeta de Back Office; Windows `.\bin\backoffice.cmd start`) sigue corriendo (`./bin/backoffice status`).
- **Claude dice que WhatsApp no está conectado:** corre `./bin/backoffice whatsapp` y escanea el QR.
