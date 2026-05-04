import { describe, it, expect, vi } from 'vitest';
import { computeContentSimilarity } from './selection-search';

vi.mock('./browser-polyfill', () => ({
	default: {
		storage: { local: { get: vi.fn(() => Promise.resolve({})), set: vi.fn(() => Promise.resolve()) } },
		runtime: { sendMessage: vi.fn(() => Promise.resolve({ ok: false, error: 'No REST API URL configured' })) },
	},
}));

vi.mock('./storage-utils', () => ({
	generalSettings: {
		localRestApiUrl: '',
		localRestApiKey: '',
		searchSimilarityThreshold: 0.8,
		searchPaths: '',
	},
	loadSettings: vi.fn(() => Promise.resolve()),
}));

describe('computeContentSimilarity', () => {
	it('returns 1.0 for identical text', () => {
		const text = 'The quick brown fox jumps over the lazy dog';
		expect(computeContentSimilarity(text, text)).toBe(1);
	});

	it('returns high similarity for nearly identical text', () => {
		const a = 'The quick brown fox jumps over the lazy dog';
		const b = 'The quick brown fox jumps over the lazy dogs';
		const sim = computeContentSimilarity(a, b);
		expect(sim).toBeGreaterThan(0.7);
	});

	it('returns low similarity for unrelated text', () => {
		const a = 'The quick brown fox jumps over the lazy dog';
		const b = 'Quantum mechanics is a fundamental theory in physics';
		const sim = computeContentSimilarity(a, b);
		expect(sim).toBeLessThan(0.3);
	});

	it('is case insensitive', () => {
		const a = 'HELLO WORLD';
		const b = 'hello world';
		expect(computeContentSimilarity(a, b)).toBe(1);
	});
});
