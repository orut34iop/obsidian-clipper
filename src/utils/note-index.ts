import browser from './browser-polyfill';
import { NoteIndexEntry } from '../types/types';

const NOTE_INDEX_KEY = 'noteIndex';
const MAX_INDEX_ENTRIES = 5000;

export async function getNoteIndex(): Promise<NoteIndexEntry[]> {
	const result = await browser.storage.local.get(NOTE_INDEX_KEY);
	const index = result[NOTE_INDEX_KEY];
	return Array.isArray(index) ? index : [];
}

export async function addToNoteIndex(
	entry: Omit<NoteIndexEntry, 'id' | 'createdAt'>
): Promise<void> {
	const index = await getNoteIndex();
	const newEntry: NoteIndexEntry = {
		...entry,
		id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
		createdAt: new Date().toISOString(),
	};
	index.unshift(newEntry);
	if (index.length > MAX_INDEX_ENTRIES) {
		index.length = MAX_INDEX_ENTRIES;
	}
	await browser.storage.local.set({ [NOTE_INDEX_KEY]: index });
}

export async function clearNoteIndex(): Promise<void> {
	await browser.storage.local.remove(NOTE_INDEX_KEY);
}
