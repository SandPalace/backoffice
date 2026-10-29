import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decide } from './meta-gate.mjs';

const ads = (t) => `mcp__plugin_backoffice_meta-ads__${t}`;
const web = (t) => `mcp__plugin_backoffice_meta-browser__${t}`;
const verdict = (name, input = {}) => decide(name, input)?.[0] ?? 'pass';

test('reads pass through', () => {
  assert.equal(verdict(ads('ads_get_ad_accounts')), 'pass');
  assert.equal(verdict(ads('ads_insights_performance_trend'), { level: 'campaign' }), 'pass');
});

test('spending tools are denied', () => {
  for (const t of ['ads_activate_entity', 'ads_boost_ig_post', 'ads_pixel_event_create', 'ads_crm']) {
    assert.equal(verdict(ads(t)), 'deny', t);
  }
});

test('creates need explicit PAUSED', () => {
  assert.equal(verdict(ads('ads_create_campaign'), { status: 'PAUSED' }), 'pass');
  assert.equal(verdict(ads('ads_create_ad_set'), { status: 'paused' }), 'pass');
  assert.equal(verdict(ads('ads_create_ad'), { status: 'ACTIVE' }), 'deny');
  assert.equal(verdict(ads('ads_create_campaign'), {}), 'deny');
  assert.equal(verdict(ads('ads_create_creative'), {}), 'pass');
});

test('update only allows pausing', () => {
  assert.equal(verdict(ads('ads_update_entity'), { fields: { status: 'PAUSED' } }), 'pass');
  assert.equal(verdict(ads('ads_update_entity'), { fields: '{"status":"PAUSED"}' }), 'pass');
  assert.equal(verdict(ads('ads_update_entity'), { fields: { status: 'ACTIVE' } }), 'deny');
  assert.equal(verdict(ads('ads_update_entity'), { fields: { status: 'PAUSED', daily_budget: 5000 } }), 'deny');
});

test('unknown ads tools ask', () => {
  assert.equal(verdict(ads('ads_something_new')), 'ask');
});

test('browser: risky clicks ask, scripts denied, drafts pass', () => {
  assert.equal(verdict(web('browser_click'), { element: 'Botón Publicar', ref: 'e12' }), 'ask');
  assert.equal(verdict(web('browser_click'), { element: 'Programar publicación' }), 'ask');
  assert.equal(verdict(web('browser_click'), { element: 'Boost post' }), 'ask');
  assert.equal(verdict(web('browser_click'), { element: 'Guardar como borrador' }), 'pass');
  assert.equal(verdict(web('browser_navigate'), { url: 'https://business.facebook.com/billing_hub/accounts' }), 'ask');
  assert.equal(verdict(web('browser_navigate'), { url: 'https://business.facebook.com/latest/home' }), 'pass');
  assert.equal(verdict(web('browser_evaluate'), { function: '() => 1' }), 'deny');
  assert.equal(verdict(web('browser_run_code_unsafe'), {}), 'deny');
});

const ai = (t) => `mcp__plugin_backoffice_meta-ai__${t}`;

test('meta-ai: reads pass; every send, status change and template change asks, naming what and to whom', () => {
  for (const t of ['list_channels', 'list_inbox_contacts', 'get_conversation_history', 'get_message', 'get_messages_stats', 'get_social_summary', 'list_instagram_posts', 'list_facebook_posts', 'list_ad_accounts', 'get_ad_account_summary', 'list_whatsapp_templates', 'list_messenger_templates'])
    assert.equal(verdict(ai(t)), 'pass', t);
  const [d, why] = decide(ai('send_message'), { channel_id: 'ch-1', to: '5215500000000', type: 'text', text: 'Hola, ¿te late el martes?' });
  assert.equal(d, 'ask');
  assert.match(why, /5215500000000/);
  assert.match(why, /Hola, ¿te late el martes\?/);
  assert.match(decide(ai('send_message'), { channel_id: 'ch-1', to: 'IGSID', type: 'template', template: { name: 'seguimiento' } })[1], /plantilla seguimiento/);
  assert.equal(verdict(ai('send_message'), { channel_id: 'ch-1', text: 'sin destinatario' }), 'deny');
  assert.match(decide(ai('update_conversation_status'), { channel_id: 'ch-1', user_id: 'u-9', status: 'closed' })[1], /u-9.*closed/);
  for (const t of ['create_whatsapp_template', 'delete_whatsapp_template', 'create_messenger_template', 'delete_messenger_template'])
    assert.equal(verdict(ai(t), { name: 'promo_octubre' }), 'ask', t);
  assert.match(decide(ai('create_whatsapp_template'), { name: 'promo_octubre', body: 'Hola {{1}}' })[1], /promo_octubre.*Hola \{\{1\}\}/);
  assert.equal(verdict(ai('something_new')), 'ask');
  // The same gateway added by hand (`claude mcp add meta-ai`) is gated too.
  assert.equal(verdict('mcp__meta-ai__send_message', { to: 'x', text: 'y' }), 'ask');
  assert.equal(verdict('mcp__meta-ai__list_channels'), 'pass');
});

test('other tools are ignored', () => {
  assert.equal(decide('mcp__playwright__browser_click', { element: 'Publicar' }), null);
});

test('CLI: emits hook JSON and fails closed on garbage', () => {
  const script = fileURLToPath(new URL('./meta-gate.mjs', import.meta.url));
  const out = execFileSync('node', [script], {
    input: JSON.stringify({ tool_name: ads('ads_activate_entity'), tool_input: {} }),
  }).toString();
  assert.equal(JSON.parse(out).hookSpecificOutput.permissionDecision, 'deny');
  assert.throws(() => execFileSync('node', [script], { input: 'not json', stdio: 'pipe' }), (e) => e.status === 2);
  const send = JSON.parse(execFileSync('node', [script], {
    input: JSON.stringify({ tool_name: ai('send_message'), tool_input: { channel_id: 'c', to: '521', text: 'hola' } }),
  }).toString());
  assert.equal(send.hookSpecificOutput.permissionDecision, 'ask');
});
