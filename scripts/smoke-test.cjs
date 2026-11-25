// Smoke test: runs the compiled node (dist/) against the live API with a minimal fake n8n context.
// Usage: npm run build && HALPII_TAXID_KEY=... node scripts/smoke-test.cjs
// Uses about 12 lookups of the key's daily allowance. Development only; not part of the npm package.
const path = require('path');
const root = path.resolve(__dirname, '..');
const KEY = process.env.HALPII_TAXID_KEY;
if (!KEY) {
  console.error('Set HALPII_TAXID_KEY.');
  process.exit(1);
}
const { HalpiiTaxId } = require(root + '/dist/nodes/HalpiiTaxId/HalpiiTaxId.node.js');
const { HalpiiTaxIdApi } = require(root + '/dist/credentials/HalpiiTaxIdApi.credentials.js');
const cred = new HalpiiTaxIdApi();

async function http(credName, o, key = KEY) {
  if (credName !== cred.name) throw new Error('wrong credential name ' + credName);
  const auth = cred.authenticate.properties.headers.Authorization.replace(/^=/, '').replace('{{$credentials.apiKey}}', key);
  const u = new URL(o.url);
  for (const [k, v] of Object.entries(o.qs || {})) u.searchParams.set(k, v);
  const r = await fetch(u, { headers: { Authorization: auth } });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  if (o.returnFullResponse) return { statusCode: r.status, body, headers: Object.fromEntries(r.headers) };
  if (!r.ok && !o.ignoreHttpStatusErrors) throw new Error('HTTP ' + r.status);
  return body;
}

function ctx(params, items = 1, opts = {}) {
  return {
    getInputData: () => Array.from({ length: items }, () => ({ json: {} })),
    getNodeParameter: (n, i, d) => (n in params[i] ? params[i][n] : d),
    getNode: () => ({ name: 'HALPII Tax ID', type: 'halpiiTaxId', typeVersion: 1, parameters: {} }),
    continueOnFail: () => !!opts.continueOnFail,
    helpers: { httpRequestWithAuthentication: (c, o) => http(c, o, opts.key) },
  };
}

const node = new HalpiiTaxId();
const summary = (j) => ({ country: j.country, level: j.verification_level, verdict: j.assessment?.verdict, name: j.legal_name ?? j.name ?? null, error: j.error });
(async () => {
  // Números ficticios (o el RUC de HALPII): nunca identificadores reales de otras empresas.
  const cases = [
    { resource: 'taxId', operation: 'peruRuc', ruc: '20615614841' },
    { resource: 'taxId', operation: 'validate', country: 'PE', taxId: '20000000001' },
    { resource: 'taxId', operation: 'validate', country: 'pe', taxId: '201' },
    { resource: 'taxId', operation: 'validate', country: 'CO', taxId: '900000000-1' },
    { resource: 'taxId', operation: 'validate', country: 'MX', taxId: 'XAXX010101000' },
    { resource: 'taxId', operation: 'validate', country: 'CL', taxId: '11.111.111-1' },
    { resource: 'taxId', operation: 'validate', country: 'DO', taxId: '100000000' },
    { resource: 'taxId', operation: 'validate', country: 'NO', taxId: '900000000' },
    { resource: 'taxId', operation: 'validate', country: 'DE', taxId: 'DE123456789', idType: 'VAT' },
    { resource: 'taxId', operation: 'validate', country: 'AR', taxId: '30000000001' },
  ];
  const out = await node.execute.call(ctx(cases, cases.length));
  out[0].forEach((it, i) => console.log(i, JSON.stringify(cases[i]), '->', JSON.stringify(summary(it.json)), 'paired', it.pairedItem.item));

  const c = await node.execute.call(ctx([{ resource: 'country', operation: 'getAll', split: true }]));
  console.log('countries items:', c[0].length, 'first:', JSON.stringify(c[0][0].json).slice(0, 80));
  const c2 = await node.execute.call(ctx([{ resource: 'country', operation: 'getAll', split: false }]));
  console.log('countries raw keys:', Object.keys(c2[0][0].json));
  const lo = await node.methods.loadOptions.getCountries.call({ helpers: { httpRequestWithAuthentication: (cn, o) => http(cn, o) } });
  console.log('loadOptions:', lo.length, JSON.stringify(lo.slice(0, 2)));

  for (const [label, params, opts] of [
    ['unsupported country', { resource: 'taxId', operation: 'validate', country: 'XX', taxId: '123' }, {}],
    ['bad country code', { resource: 'taxId', operation: 'validate', country: 'Peru', taxId: '123' }, {}],
    ['bad key', { resource: 'taxId', operation: 'peruRuc', ruc: '20615614841' }, { key: 'not-a-real-key' }],
  ]) {
    try { await node.execute.call(ctx([params], 1, opts)); console.log(label, 'NO ERROR (unexpected)'); }
    catch (e) { console.log(label, '->', e.constructor.name, '|', e.message, '|', e.description ?? '', '| http', e.httpCode ?? ''); }
  }
  const cof = await node.execute.call(ctx([{ resource: 'taxId', operation: 'validate', country: 'XX', taxId: '1' }], 1, { continueOnFail: true }));
  console.log('continueOnFail ->', JSON.stringify(cof[0][0].json));
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
