import { describe, expect, it } from 'vitest';
import { emailDetector } from './index.ts';

describe('emailDetector', () => {
	it('finds an email and its offsets', () => {
		const text = 'payment declined for jane@northwind.com today';
		const [span] = emailDetector.detect(text);
		expect(text.slice(span.start, span.end)).toBe('jane@northwind.com');
		expect(span.dataTypeId).toBe('builtin:email');
	});

	it('returns nothing for clean text', () => {
		expect(emailDetector.detect('why is checkout failing?')).toEqual([]);
	});
});
