import { describe, expect, it } from 'vitest';
import { ApiError, DASHBOARD_API, DeviceRegistrationRequest } from './dashboard-api.ts';

describe('dashboard API contracts', () => {
	it('only accept an id-shaped device id when registering', () => {
		expect(DeviceRegistrationRequest.safeParse({ deviceId: 'dev-7f3a' }).success).toBe(true);
		expect(DeviceRegistrationRequest.safeParse({ deviceId: 'Jane’s MacBook' }).success).toBe(false);
		expect(DeviceRegistrationRequest.safeParse({ deviceId: 'dev-7f3a', hostname: 'x' }).success).toBe(false);
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
