import { describe, expect, it } from 'vitest';
import { normalizeQuickClipSite, parseQuickClipHiddenSites } from './quick-clip-sites';

describe('quick clip website rules', () => {
	it.each([
		[' Example.COM ', 'example.com'],
		['https://EXAMPLE.com:8443/article?q=1#part', 'example.com'],
		['http://example.com./another', 'example.com'],
		['https://www.example.com', 'www.example.com'],
		['https://例子.中国/文章', 'xn--fsqu00a.xn--fiqs8s'],
		['localhost:3000', 'localhost'],
		['http://127.0.0.1:8080', '127.0.0.1'],
		['http://[::1]:8080', '[::1]'],
	])('normalizes %s to its exact hostname', (input, expected) => {
		expect(normalizeQuickClipSite(input)).toBe(expected);
	});

	it.each(['', 'bad host', '*.example.com', 'https://', 'file:///tmp/page', 'ftp://example.com', 'https://user:pass@example.com', '.example.com', 'example..com'])('rejects invalid or unsupported input %s', input => {
		expect(normalizeQuickClipSite(input)).toBeNull();
	});

	it('sanitizes imported data without merging sibling domains', () => {
		expect(parseQuickClipHiddenSites(['EXAMPLE.com', 'https://example.com/a', 'www.example.com', '*.example.com', null, 42]))
			.toEqual(['example.com', 'www.example.com']);
		expect(parseQuickClipHiddenSites('example.com')).toEqual([]);
	});
});
