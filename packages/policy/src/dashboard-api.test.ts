import { describe, expect, it } from 'vitest';
import { ApiError, DASHBOARD_API, DeviceRegistrationRequest } from './dashboard-api.ts';

describe('dashboard API contracts', () => {
	it('let only the dashboard pick a device id, and take an optional printable label (#51)', () => {
		expect(DeviceRegistrationRequest.safeParse({}).success).toBe(true);
		expect(DeviceRegistrationRequest.parse({ label: ' Asset 1042 ' })).toEqual({ label: 'Asset 1042' });
		expect(DeviceRegistrationRequest.safeParse({ deviceId: 'dev-7f3a' }).success).toBe(false);
		expect(DeviceRegistrationRequest.safeParse({ label: 'x'.repeat(65) }).success).toBe(false);
		expect(DeviceRegistrationRequest.safeParse({ label: 'a\u0000b' }).success).toBe(false);
		expect(DeviceRegistrationRequest.safeParse({ label: 'a\u202Eb' }).success).toBe(false);
		expect(DeviceRegistrationRequest.safeParse({ label: 'x', hostname: 'x' }).success).toBe(false);
	});

	it('describe errors with a known code', () => {
		expect(ApiError.safeParse({ error: { code: 'rate_limited', message: 'slow down' } }).success).toBe(true);
		expect(ApiError.safeParse({ error: { code: 'teapot', message: '' } }).success).toBe(false);
	});

	it('use the paths the dashboard serves', () => {
		expect(Object.values(DASHBOARD_API).map((e) => `${e.method} ${e.path}`)).toEqual([
			'POST /api/devices',
			'GET /api/policy',
			'POST /api/events'
		]);
	});
});
