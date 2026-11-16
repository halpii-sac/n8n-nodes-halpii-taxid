import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { BASE_URL, peruRucTarget, validationTarget, type RequestTarget } from './requestPath';

/*
 * Programmatic style, not declarative: the API has four dedicated routes (PE, MX, CO, CR) and a
 * generic one for the other countries, and a malformed ID comes back as HTTP 400 with a full answer
 * (verdict "fail") that should reach the workflow as data, while 401, 429 and 503 must become
 * clear errors. Both are simpler and easier to test as code than as routing expressions.
 */

const CREDENTIAL = 'halpiiTaxIdApi';

interface FullResponse {
	statusCode: number;
	body: unknown;
	headers?: Record<string, string>;
}

function asObject(body: unknown): IDataObject {
	if (body && typeof body === 'object' && !Array.isArray(body)) return body as IDataObject;
	if (typeof body === 'string') {
		try {
			const parsed = JSON.parse(body) as unknown;
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as IDataObject;
		} catch {
			// not JSON: fall through
		}
	}
	return { message: String(body ?? '') };
}

async function callApi(
	ctx: IExecuteFunctions,
	target: RequestTarget,
	itemIndex: number,
): Promise<IDataObject> {
	const options: IHttpRequestOptions = {
		method: 'GET',
		url: target.url,
		qs: target.qs,
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
		timeout: 20000,
	};
	const res = (await ctx.helpers.httpRequestWithAuthentication.call(
		ctx,
		CREDENTIAL,
		options,
	)) as FullResponse;
	const body = asObject(res.body);
	const status = res.statusCode;

	if (status >= 200 && status < 300) return body;

	// Malformed ID: the API still returns the full answer with assessment.verdict = "fail".
	if (status === 400 && body.assessment) return body;

	const apiMessage = typeof body.error === 'string' ? body.error : '';
	let message = `HALPII Tax ID returned HTTP ${status}`;
	let description = apiMessage;
	if (status === 401 || status === 403) {
		message = 'The API key was rejected';
		description = apiMessage || 'Check the HALPII Tax ID API credential.';
	} else if (status === 404) {
		message = 'Country or ID type not supported';
	} else if (status === 429) {
		message = 'Daily allowance used';
		description = `${apiMessage} The count resets at 00:00 UTC.`.trim();
	} else if (status === 503) {
		const retry = res.headers?.['retry-after'];
		message = 'The registry did not answer in time';
		description = `${apiMessage} This call was not billed and did not count against your quota.${
			retry ? ` Retry after ${retry} seconds.` : ''
		}`.trim();
	}
	throw new NodeApiError(ctx.getNode(), body as JsonObject, {
		message,
		description,
		httpCode: String(status),
		itemIndex,
	});
}

export class HalpiiTaxId implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'HALPII Tax ID',
		name: 'halpiiTaxId',
		icon: { light: 'file:../../icons/halpii-taxid.light.svg', dark: 'file:../../icons/halpii-taxid.dark.svg' },
		group: ['transform'],
		version: [1],
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'Validate business tax IDs: official registry where available, format and check digit elsewhere',
		defaults: {
			name: 'HALPII Tax ID',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: CREDENTIAL,
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Tax ID', value: 'taxId' },
					{ name: 'Country', value: 'country' },
				],
				default: 'taxId',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['taxId'] } },
				options: [
					{
						name: 'Validate',
						value: 'validate',
						description: 'Validate a tax ID for any supported country',
						action: 'Validate a tax ID',
					},
					{
						name: 'Peru RUC Lookup',
						value: 'peruRuc',
						description:
							'Look up a Peru RUC in SUNAT data: legal name, status, HABIDO condition and fiscal address',
						action: 'Look up a RUC in SUNAT data',
					},
				],
				default: 'validate',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['country'] } },
				options: [
					{
						name: 'Get Many',
						value: 'getAll',
						description: 'List supported countries, ID types and verification levels',
						action: 'Get many countries',
					},
				],
				default: 'getAll',
			},
			{
				displayName: 'Country Name or ID',
				name: 'country',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getCountries' },
				required: true,
				default: '',
				displayOptions: { show: { resource: ['taxId'], operation: ['validate'] } },
				description:
					'Two-letter ISO country code. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Tax ID',
				name: 'taxId',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'DE143454214',
				displayOptions: { show: { resource: ['taxId'], operation: ['validate'] } },
				description:
					'The tax ID to check. Spaces, dots and dashes are accepted. EU VAT numbers can include the country prefix.',
			},
			{
				displayName: 'ID Type',
				name: 'idType',
				type: 'string',
				default: '',
				placeholder: 'vat',
				displayOptions: { show: { resource: ['taxId'], operation: ['validate'] } },
				description:
					'Optional ID type, such as vat, siren or cnpj. Leave empty to detect it from the number. Ignored for Peru, Mexico, Colombia and Costa Rica.',
			},
			{
				displayName: 'RUC',
				name: 'ruc',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'e.g. 20XXXXXXXXX',
				displayOptions: { show: { resource: ['taxId'], operation: ['peruRuc'] } },
				description: 'The 11-digit Peru RUC',
			},
			{
				displayName: 'Split Into Items',
				name: 'split',
				type: 'boolean',
				default: true,
				displayOptions: { show: { resource: ['country'], operation: ['getAll'] } },
				description:
					'Whether to return one item per country. When off, the API response is returned as a single item.',
			},
		],
	};

	methods = {
		loadOptions: {
			async getCountries(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const body = (await this.helpers.httpRequestWithAuthentication.call(this, CREDENTIAL, {
					method: 'GET',
					url: `${BASE_URL}/v1/countries`,
					json: true,
				})) as { countries?: Array<{ country: string; name: string; verification_level: string }> };
				const levels: Record<string, string> = {
					official_registry: 'official registry',
					format_and_lists: 'format + tax-authority lists',
					format: 'format only',
				};
				return (body.countries ?? [])
					.map((c) => ({
						name: `${c.name} (${c.country})`,
						value: c.country,
						description: levels[c.verification_level] ?? c.verification_level,
					}))
					.sort((a, b) => a.name.localeCompare(b.name));
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;

				if (resource === 'taxId') {
					let target: RequestTarget;
					try {
						if (operation === 'peruRuc') {
							target = peruRucTarget(this.getNodeParameter('ruc', i) as string);
						} else {
							target = validationTarget(
								this.getNodeParameter('country', i) as string,
								this.getNodeParameter('taxId', i) as string,
								this.getNodeParameter('idType', i, '') as string,
							);
						}
					} catch (error) {
						throw new NodeOperationError(this.getNode(), (error as Error).message, { itemIndex: i });
					}
					returnData.push({ json: await callApi(this, target, i), pairedItem: { item: i } });
				} else if (resource === 'country' && operation === 'getAll') {
					const body = await callApi(this, { url: `${BASE_URL}/v1/countries` }, i);
					const split = this.getNodeParameter('split', i, true) as boolean;
					const countries = Array.isArray(body.countries) ? (body.countries as IDataObject[]) : [];
					if (split) {
						for (const c of countries) returnData.push({ json: c, pairedItem: { item: i } });
					} else {
						returnData.push({ json: body, pairedItem: { item: i } });
					}
				} else {
					throw new NodeOperationError(this.getNode(), `Unsupported operation "${operation}"`, {
						itemIndex: i,
					});
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				// API and validation errors are already NodeApiError / NodeOperationError with the item index.
				throw error instanceof NodeApiError || error instanceof NodeOperationError
					? error
					: new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}
