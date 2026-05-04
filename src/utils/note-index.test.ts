import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getNoteIndex, addToNoteIndex, clearNoteIndex } from './note-index';

const mockStorage: Record<string, any> = {};

vi.mock('./browser-polyfill', () => ({
	default: {
		storage: {
			local: {
				get: vi.fn((key: string | string[]) => {
					if (typeof key === 'string') {
						return Promise.resolve({ [key]: mockStorage[key] });
					}
					const result: Record<string, any> = {};
					key.forEach(k => { result[k] = mockStorage[k]; });
					return Promise.resolve(result);
				}),
				set: vi.fn((items: Record<string, any>) => {
					Object.assign(mockStorage, items);
					return Promise.resolve();
				}),
				remove: vi.fn((key: string | string[]) => {
					if (typeof key === 'string') {
						delete mockStorage[key];
					} else {
						key.forEach(k => delete mockStorage[k]);
					}
					return Promise.resolve();
				}),
			},
		},
	},
}));

describe('note-index', () => {
	beforeEach(() => {
		Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
	});

	it('returns empty array when no index exists', async () => {
		const index = await getNoteIndex();
		expect(index).toEqual([]);
	});

	it('adds an entry to the index', async () => {
		await addToNoteIndex({
			title: 'Test Note',
			path: 'test.md',
			vault: 'TestVault',
			content: 'Hello world',
			contentHash: 'abc123',
		});
		const index = await getNoteIndex();
		expect(index).toHaveLength(1);
		expect(index[0].title).toBe('Test Note');
		expect(index[0].vault).toBe('TestVault');
		expect(index[0].contentHash).toBe('abc123');
		expect(index[0].id).toBeDefined();
		expect(index[0].createdAt).toBeDefined();
	});

	it('prepends new entries', async () => {
		await addToNoteIndex({ title: 'First', path: '1.md', vault: 'V', content: 'a', contentHash: 'h1' });
		await addToNoteIndex({ title: 'Second', path: '2.md', vault: 'V', content: 'b', contentHash: 'h2' });
		const index = await getNoteIndex();
		expect(index[0].title).toBe('Second');
		expect(index[1].title).toBe('First');
	});

	it('clears the index', async () => {
		await addToNoteIndex({ title: 'Test', path: 't.md', vault: 'V', content: 'c', contentHash: 'h' });
		await clearNoteIndex();
		const index = await getNoteIndex();
		expect(index).toEqual([]);
	});
});
