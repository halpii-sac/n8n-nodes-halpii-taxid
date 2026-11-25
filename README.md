# n8n-nodes-halpii-taxid

An [n8n](https://n8n.io/) community node for [HALPII Tax ID](https://taxid.halpii.com), an API that validates business tax IDs. It checks the official registry where one is published and supported (for example Peru, Colombia, Chile, Costa Rica, the Dominican Republic, Canada, Norway, Finland, France, Ireland and Taiwan), Mexico's SAT taxpayer lists, and the format and check digit for the other supported countries. Every answer says which of the three it did (`verification_level`) and ends in a `pass`, `review` or `fail` verdict with reasons in English.

Use it to vet suppliers or business customers before you pay or invoice them: vendor onboarding, accounts payable, KYB, or an AI agent in n8n that needs to check a company.

[Installation](#installation) · [Operations](#operations) · [Credentials](#credentials) · [Usage](#usage) · [Example workflow](#example-workflow) · [Errors](#errors) · [Compatibility](#compatibility) · [Resources](#resources)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation and install the package `n8n-nodes-halpii-taxid`.

## Operations

| Resource | Operation | What it calls | Output |
|---|---|---|---|
| Tax ID | **Validate** | Country + tax ID (+ optional ID type). Peru, Mexico, Colombia and Costa Rica go to their dedicated routes (`/v1/pe/ruc`, `/v1/mx/rfc`, `/v1/co/nit`, `/v1/cr/cedula`); every other country goes to `/v1/validate`. | The API's JSON answer, unchanged |
| Tax ID | **Peru RUC Lookup** | `GET /v1/pe/ruc/{ruc}`: SUNAT legal name, taxpayer status, HABIDO / NO HABIDO condition and fiscal address | The API's JSON answer, unchanged |
| Country | **Get Many** | `GET /v1/countries`: supported countries, ID types, verification level and endpoint for each | One item per country, or the raw response with **Split Into Items** off |

The **Country** field of *Validate* loads the list of supported countries from the API. You can also pass a two-letter ISO code with an expression, such as `{{ $json.country }}`.

The node can be used as a tool by n8n AI agents (`usableAsTool`).

## Credentials

1. Get an API key at <https://taxid.halpii.com/#key>. You only need an email address. The key is shown once, so store it right away.
2. In n8n, create a credential of type **HALPII Tax ID API** and paste the key into **API Key**.
3. Click **Test**. n8n calls `GET /v1/usage`, which checks the key without using any of your quota.

The key is sent as `Authorization: Bearer <key>`. A no-cost key has 10 trial lookups until you confirm your email; after that it includes 5 lookups a day, renewed every day at 00:00 UTC, with no monthly cap. The Monthly plan and its pricing are on the [pricing section](https://taxid.halpii.com/#pricing) of the site.

## Usage

A typical answer for *Peru RUC Lookup* with `20615614841` (HALPII S.A.C., the company that runs this API):

```json
{
  "country": "PE",
  "id_type": "RUC",
  "verification_level": "official_registry",
  "ruc": "20615614841",
  "legal_name": "HALPII S.A.C.",
  "status": { "code": "ACTIVO", "label": "Active", "active": true },
  "domicile_condition": { "code": "HABIDO", "label": "Located: SUNAT verified the fiscal address", "located": true },
  "source": { "name": "SUNAT Padrón Reducido del RUC", "data_as_of": "2026-11-14" },
  "assessment": { "verdict": "pass", "reasons": ["Taxpayer is active with SUNAT.", "Fiscal address is verified (HABIDO)."] }
}
```

(Shortened. The full answer also carries the address, the source URL and a disclaimer.)

Read the verdict with an **If** or **Switch** node on `{{ $json.assessment.verdict }}`:

| Verdict | Meaning | Suggested branch |
|---|---|---|
| `pass` | Found in the official registry and in good standing per the source | Continue |
| `review` | Needs a human look: format check only, not found in the latest registry copy, active but flagged, or any Mexican RFC (Mexico publishes no RFC registry) | Send to a person |
| `fail` | Invalid check digit, malformed, deregistered or not active, or on a blacklist | Stop and ask the counterparty to confirm the number |

A **malformed** ID (wrong length or characters) is not an error in this node: the API answers HTTP 400 with a full body, and the node passes it on with `assessment.verdict = "fail"` and an `error` field, so your workflow can branch on it like any other result.

Check `verification_level` before you treat a result as proof that a business exists: `format` means only the structure and check digit were checked.

## Example workflow

Validate a list of suppliers. Import this JSON into n8n (**Workflow** menu → **Import from File** or paste), then select your HALPII Tax ID credential on the HALPII node. Add a **Switch** node on `{{ $json.assessment.verdict }}` after it to route `pass`, `review` and `fail`.

```json
{
  "name": "Validate supplier tax IDs",
  "nodes": [
    {
      "parameters": {},
      "name": "When clicking 'Execute workflow'",
      "type": "n8n-nodes-base.manualTrigger",
      "typeVersion": 1,
      "position": [0, 0]
    },
    {
      "parameters": {
        "jsCode": "return [\n  { json: { supplier: 'Supplier A', country: 'PE', tax_id: '<RUC>' } },\n  { json: { supplier: 'Supplier B', country: 'CO', tax_id: '<NIT>' } },\n  { json: { supplier: 'Typo test', country: 'PE', tax_id: '20615614842' } }\n];"
      },
      "name": "Suppliers",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [220, 0]
    },
    {
      "parameters": {
        "resource": "taxId",
        "operation": "validate",
        "country": "={{ $json.country }}",
        "taxId": "={{ $json.tax_id }}"
      },
      "name": "HALPII Tax ID",
      "type": "n8n-nodes-halpii-taxid.halpiiTaxId",
      "typeVersion": 1,
      "position": [440, 0]
    }
  ],
  "connections": {
    "When clicking 'Execute workflow'": { "main": [[{ "node": "Suppliers", "type": "main", "index": 0 }]] },
    "Suppliers": { "main": [[{ "node": "HALPII Tax ID", "type": "main", "index": 0 }]] }
  }
}
```

## Errors

| HTTP | Node behavior |
|---|---|
| 400 with an answer body | Returned as data with `verdict: "fail"` (malformed ID) |
| 401 | Error: *The API key was rejected*. Check the credential. |
| 404 | Error: *Country or ID type not supported*. See **Country → Get Many**. |
| 429 | Error: *Daily allowance used*. The count resets at 00:00 UTC. |
| 503 | Error: *The registry did not answer in time*. The call is not billed and does not count against your quota; the message includes the `Retry-After` delay. Use the node's **Retry On Fail** setting or try again later. |

With **On Error → Continue**, a failed item comes out as `{ "error": "<message>" }` and the rest of the batch keeps going.

## Compatibility

Built with `@n8n/node-cli` 0.56 against `n8n-workflow` 2.47. Requires an n8n instance that can install community nodes.

## Resources

- [HALPII Tax ID API reference](https://taxid.halpii.com/docs)
- [Countries, ID types and sources](https://taxid.halpii.com/countries)
- [OpenAPI spec](https://taxid.halpii.com/openapi.json)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)

HALPII Tax ID is run by HALPII S.A.C. (Lima, Peru). It is an independent service and is not affiliated with or endorsed by any tax authority or registry. Results are informational, not legal or tax advice. Support: contacto@halpii.com.

## License

[MIT](LICENSE.md)
