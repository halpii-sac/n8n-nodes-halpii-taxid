import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class HalpiiTaxIdApi implements ICredentialType {
	name = 'halpiiTaxIdApi';

	displayName = 'HALPII Tax ID API';

	icon: Icon = { light: 'file:../icons/halpii-taxid.light.svg', dark: 'file:../icons/halpii-taxid.dark.svg' };

	documentationUrl = 'https://taxid.halpii.com/docs';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Your HALPII Tax ID API key. Get one at https://taxid.halpii.com/#key. It is shown only once when created.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	// GET /v1/usage answers 401 for a missing or unknown key and does not use any quota.
	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://taxid.halpii.com',
			url: '/v1/usage',
			method: 'GET',
		},
	};
}
