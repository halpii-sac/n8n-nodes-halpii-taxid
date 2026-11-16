/**
 * Maps a validation request to the HALPII Tax ID API route.
 *
 * Peru, Mexico, Colombia and Costa Rica have their own routes with more data, and
 * GET /v1/validate refuses them with HTTP 400. Every other country goes through
 * GET /v1/validate?country=XX&id=...[&id_type=...], which checks the official registry
 * where one is supported and the format and check digit elsewhere.
 */
export const BASE_URL = 'https://taxid.halpii.com';

export const DEDICATED_ROUTES: Record<string, string> = {
	PE: 'pe/ruc',
	MX: 'mx/rfc',
	CO: 'co/nit',
	CR: 'cr/cedula',
};

export interface RequestTarget {
	url: string;
	qs?: Record<string, string>;
}

export function validationTarget(country: string, id: string, idType = ''): RequestTarget {
	const cc = country.trim().toUpperCase();
	const value = id.trim();
	if (!/^[A-Z]{2}$/.test(cc)) {
		throw new Error(`Country must be a two-letter ISO code, like PE or DE. Got "${country}".`);
	}
	if (!value) {
		throw new Error('The tax ID is empty.');
	}
	const route = DEDICATED_ROUTES[cc];
	if (route) {
		return { url: `${BASE_URL}/v1/${route}/${encodeURIComponent(value)}` };
	}
	const qs: Record<string, string> = { country: cc, id: value };
	if (idType.trim()) {
		qs.id_type = idType.trim().toLowerCase();
	}
	return { url: `${BASE_URL}/v1/validate`, qs };
}

export function peruRucTarget(ruc: string): RequestTarget {
	return validationTarget('PE', ruc);
}
