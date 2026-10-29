#!/usr/bin/env node
// PreToolUse gate for the Meta connectors: the official Ads MCP + Playwright browser (marketing) and the Meta-AI
// gateway (`meta-ai`: WhatsApp / Messenger / Instagram inbox, sending, templates and analytics; marketing and sales).
//
// Policy (mirrors the CMO's hard rules; the person activates, publishes and pays):
//   meta-ads reads (ads_get_*, ads_insights_*)            -> no decision (normal permission flow)
//   ads_create_campaign / _ad_set / _ad                   -> allowed only with status PAUSED, else deny
//   ads_update_entity                                     -> only { status: PAUSED } (kill-switch), else deny
//   activate, boost, budget, billing, pixel, crm, catalog -> deny
//   any other meta-ads tool                               -> ask
//   browser: evaluate / run_code                          -> deny (would bypass this gate)
//   browser: clicks/keys on publish, schedule, boost,
//            pay, activate, delete; billing pages         -> ask (a human signs at the screen)
//   meta-ai reads (list_*, get_*)                         -> no decision (normal permission flow)
//   meta-ai send_message                                  -> ask, naming channel, recipient and text (one OK per message,
//                                                            the same rule as OpenWA sends); no recipient -> deny
//   meta-ai update_conversation_status                    -> ask, naming the contact and the new status
//   meta-ai create_/delete_*_template                     -> ask, naming the template
//   any other meta-ai tool                                -> ask
//   unparseable input / any error                         -> exit 2 (blocked; fail closed)
// An "ask" always reaches the person, even when a permission rule allow-lists the tool: drafts stay the default.
// Zero dependencies. Exported `decide` is pure so it can be unit-tested.

const DENY_ADS = /(activate|boost|budget|billing|payment|spend|pixel|crm|catalog_.*(create|update|delete)|delete)/i;
const READ_ADS = /^ads_(get_|insights_)/;
const CREATE_SPENDING = /^ads_create_(campaign|ad_set|adset|ad)$/;
const RISKY_UI = /(publi(sh|car)|post now|share now|compartir ahora|programar|schedule|boost|promocionar|impulsar|activ(ar|ate)|turn on|encender|pagar|\bpay\b|add funds|a[nñ]adir fondos|presupuesto|budget|eliminar|delete|submit for review|enviar a revisi[oó]n)/i;
const RISKY_URL = /(billing|payment|pagos|facturaci[oó]n|\/settings\/.*system-users)/i;

function statusOf(input) {
  for (const key of ['status', 'configured_status']) {
    if (typeof input?.[key] === 'string') return input[key].toUpperCase();
  }
  return null;
}

const clip = (v, n = 300) => {
  const t = String(v ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};
/** What a meta-ai send_message would say, in one line (text, template, caption, buttons...). */
function sendSummary(input) {
  const i = input ?? {};
  const parts = [];
  for (const k of ['text', 'body', 'caption', 'message']) if (typeof i[k] === 'string' && i[k].trim()) parts.push(i[k]);
  if (i.template) parts.push(`plantilla ${typeof i.template === 'string' ? i.template : i.template.name ?? JSON.stringify(i.template)}`);
  if (!parts.length) parts.push(`${i.type ?? 'mensaje'} ${JSON.stringify(Object.fromEntries(Object.entries(i).filter(([k]) => !['channel_id', 'to', 'type'].includes(k))))}`);
  return clip(parts.join(' · '));
}

function decideMetaAi(tool, input) {
  if (/^(list_|get_)/.test(tool)) return null;
  if (tool === 'send_message') {
    const to = input?.to ?? input?.user_id ?? input?.recipient;
    if (!to) return ['deny', 'send_message needs the recipient (`to`) so the person can approve it; ask them who it goes to.'];
    return ['ask', `Enviar por Meta-AI (canal ${input?.channel_id ?? '?'}) a ${clip(to, 80)}: «${sendSummary(input)}». Solo con el OK de la persona para ESTE mensaje.`];
  }
  if (tool === 'update_conversation_status') {
    return ['ask', `Cambiar la conversación de ${clip(input?.user_id ?? input?.to ?? '?', 80)} (canal ${input?.channel_id ?? '?'}) a «${clip(input?.status ?? '?', 40)}». Confírmalo la persona.`];
  }
  if (/^(create|delete)_(whatsapp|messenger)_template$/.test(tool)) {
    const name = input?.name ?? input?.template_name ?? input?.id ?? '?';
    const what = tool.startsWith('create') ? `Enviar a Meta para aprobación la plantilla «${clip(name, 80)}»` : `Borrar la plantilla «${clip(name, 80)}»`;
    const body = input?.body ?? input?.text ?? (input?.components ? JSON.stringify(input.components) : '');
    return ['ask', `${what}${body ? `: ${clip(body)}` : ''}. Confírmalo la persona.`];
  }
  return ['ask', `${tool} is not in Back Office's known Meta-AI list; a human must confirm.`];
}

export function decide(toolName, input) {
  // meta-ai from this plugin, or the same gateway added by hand with `claude mcp add meta-ai`.
  const ai = /^mcp__(?:plugin_backoffice_)?meta-ai__(.+)$/.exec(toolName ?? '');
  if (ai) return decideMetaAi(ai[1], input);
  const m = /^mcp__plugin_backoffice_meta-(ads|browser)__(.+)$/.exec(toolName ?? '');
  if (!m) return null;
  const [, server, tool] = m;

  if (server === 'ads') {
    if (READ_ADS.test(tool)) return null;
    if (tool === 'ads_update_entity') {
      let fields = input?.fields;
      if (typeof fields === 'string') fields = JSON.parse(fields);
      const keys = fields && typeof fields === 'object' ? Object.keys(fields) : [];
      if (keys.length === 1 && String(fields.status).toUpperCase() === 'PAUSED') return null;
      return ['deny', 'Only pausing is allowed from here. Budget, copy, schedule or status changes are made by the person in Ads Manager: leave them a checklist.'];
    }
    if (DENY_ADS.test(tool)) {
      return ['deny', `${tool} activates, boosts or spends money. Only the person does that in Ads Manager: leave them a checklist.`];
    }
    if (CREATE_SPENDING.test(tool)) {
      if (statusOf(input) === 'PAUSED') return null;
      return ['deny', `Create it with status "PAUSED" explicitly; the person activates it in Ads Manager.`];
    }
    if (/^ads_create_creative$|^ads_creative_upload_(image|video)$/.test(tool)) return null;
    return ['ask', `${tool} is not in the marketing team's known Meta list; a human must confirm.`];
  }

  // meta-browser (Playwright)
  if (/^browser_(evaluate|run_code)/.test(tool)) {
    return ['deny', 'Script execution in the Meta browser is disabled; use clicks and forms so every action is reviewable.'];
  }
  if (tool === 'browser_navigate' && RISKY_URL.test(String(input?.url ?? ''))) {
    return ['ask', 'Billing, payment and system-user pages are the person\'s; confirm before opening.'];
  }
  if (/^browser_(click|press_key|type|fill_form|select_option)$/.test(tool)) {
    const text = [input?.element, input?.key, input?.text, JSON.stringify(input?.fields ?? '')].join(' ');
    if (tool === 'browser_click' || tool === 'browser_press_key') {
      if (RISKY_UI.test(text)) {
        return ['ask', 'This looks like publishing, scheduling, activating, paying or deleting in Meta. Only the person does that; leave it as a draft.'];
      }
    }
  }
  return null;
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  const event = JSON.parse(raw);
  const verdict = decide(event.tool_name, event.tool_input ?? {});
  if (!verdict) return;
  const [permissionDecision, permissionDecisionReason] = verdict;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision, permissionDecisionReason },
  }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    process.stderr.write(`meta-gate: could not read the call, blocked: ${err.message}\n`);
    process.exit(2);
  });
}
