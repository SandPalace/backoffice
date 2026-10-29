<!--
  Back Office canvas template: document (markdown draft: letter, email, proposal, policy).
  Use: copy to $TMPDIR/backoffice-work/<task>/document.md (rename it, e.g. carta-cliente.md), replace every placeholder (TOKEN in double curly braces)
  with real data from the task or its files, write [NO DATA: what is missing] for any fact you do not have.
  Keep the header table and «Pendiente de validar». Delete the sections that do not apply to this kind of document.
  Prices, phones, dates and names only from a real source. Delete this comment before publishing.
-->

# {{TITLE}}

| | |
|---|---|
| **Para** | {{RECIPIENT_NAME_AND_ROLE}} |
| **De** | {{SENDER_NAME_AND_ROLE}} |
| **Fecha** | {{DATE}} |
| **Asunto** | {{SUBJECT}} |
| **Estado** | Borrador · preparado por {{AGENT_NAME}} |

---

{{GREETING}}

{{OPENING_PARAGRAPH_WHY_YOU_ARE_WRITING}}

## {{SECTION_TITLE}}

{{SECTION_BODY}}

<!-- REPEAT the section above as needed. For a proposal: Alcance · Entregables · Tiempos · Inversión · Siguientes pasos.
     For a policy: Objetivo · Alcance · Reglas · Responsables · Vigencia. -->

## Siguientes pasos

1. {{NEXT_STEP_WITH_OWNER_AND_DATE}}

{{CLOSING}}

{{SIGNATURE_NAME}}
{{SIGNATURE_ROLE}}

---

## Pendiente de validar

> Esta sección es para ti, no para el destinatario: bórrala antes de enviar.

- [ ] {{FACT_OR_WORDING_TO_CONFIRM}}
- [ ] Datos marcados [NO DATA] en el texto: {{LIST_OR_NONE}}
- [ ] Tono y forma de dirigirse al destinatario (tú / usted).
