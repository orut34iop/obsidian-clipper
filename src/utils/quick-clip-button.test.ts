// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import browser from './browser-polyfill';
import { initializeQuickClipButton } from './quick-clip-button';
import { QUICK_CLIP_HIDDEN_SITES_KEY as key } from './quick-clip-sites';
import { initializeQuickClipSettings } from '../managers/quick-clip-settings';

type Listener = (changes: Record<string, { newValue?: unknown }>, area: string) => void;
const { data, listeners } = vi.hoisted(() => ({
	data: {} as Record<string, unknown>,
	listeners: new Set<Listener>(),
}));
vi.mock('./browser-polyfill', () => ({
	default: {
		storage: {
			sync: {
				get: vi.fn(async () => ({ ...data })),
				set: vi.fn(async (values: Record<string, unknown>) => {
					Object.assign(data, values);
					const changes = Object.fromEntries(Object.entries(values).map(([name, newValue]) => [name, { newValue }]));
					listeners.forEach(listener => listener(changes, 'sync'));
				}),
			},
			local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) },
			onChanged: {
				addListener: vi.fn((listener: Listener) => listeners.add(listener)),
				removeListener: vi.fn((listener: Listener) => listeners.delete(listener)),
			},
		},
		runtime: { sendMessage: vi.fn(async () => ({})) },
		i18n: { getMessage: (name: string) => name },
	},
}));
vi.mock('./i18n', () => ({
	getMessage: (name: string) => name,
	getCurrentLanguage: async () => 'en',
	initializeI18n: async () => {},
}));

const getButton = () => document.querySelector<HTMLButtonElement>('#obsidian-clipper-quickclip-btn');
const openMenu = () => getButton()!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
let cleanup = () => {};

beforeEach(() => {
	vi.clearAllMocks();
	for (const name of Object.keys(data)) delete data[name];
	listeners.clear();
	document.body.replaceChildren();
	window.history.replaceState({}, '', '/article');
});

afterEach(() => {
	cleanup();
	cleanup = () => {};
	vi.restoreAllMocks();
});

it('keeps the normal left-click quick clip action', async () => {
	cleanup = await initializeQuickClipButton();
	getButton()!.click();
	expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ action: 'quickClipFromIcon' });
});

it('hides only the configured hostname across paths', async () => {
	data[key] = [window.location.hostname];
	cleanup = await initializeQuickClipButton();
	expect(getButton()).toBeNull();
	window.history.replaceState({}, '', '/different-path');
	cleanup();
	cleanup = await initializeQuickClipButton();
	expect(getButton()).toBeNull();
	await browser.storage.sync.set({ [key]: [`sub.${window.location.hostname}`, `${window.location.hostname}.evil.com`] });
	expect(getButton()).not.toBeNull();
});

it('saves from the menu, hides immediately, and stays hidden on reinjection', async () => {
	cleanup = await initializeQuickClipButton();
	openMenu();
	document.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click();
	await vi.waitFor(() => expect(getButton()).toBeNull());
	expect(data[key]).toEqual([window.location.hostname]);
	expect(document.querySelector('[role="menu"]')).toBeNull();
	expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
	cleanup();
	cleanup = await initializeQuickClipButton();
	expect(getButton()).toBeNull();
});

it('responds to settings changes without duplicating buttons and cleans up listeners', async () => {
	cleanup = await initializeQuickClipButton();
	await browser.storage.sync.set({ [key]: [window.location.hostname] });
	expect(getButton()).toBeNull();
	await browser.storage.sync.set({ [key]: [] });
	await browser.storage.sync.set({ [key]: [] });
	expect(document.querySelectorAll('#obsidian-clipper-quickclip-btn')).toHaveLength(1);
	cleanup();
	expect(getButton()).toBeNull();
	expect(listeners.size).toBe(0);
});

it('restores the icon when the stored list is removed', async () => {
	data[key] = [window.location.hostname];
	cleanup = await initializeQuickClipButton();
	listeners.forEach(listener => listener({ [key]: {} }, 'sync'));
	expect(getButton()).not.toBeNull();
});

it('does not let stale content scripts recreate the icon', async () => {
	let current = true;
	cleanup = await initializeQuickClipButton(() => current);
	current = false;
	cleanup();
	cleanup = await initializeQuickClipButton(() => current);
	expect(getButton()).toBeNull();
});

it('closes the menu with Escape and returns focus to the icon', async () => {
	cleanup = await initializeQuickClipButton();
	openMenu();
	document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
	expect(document.querySelector('[role="menu"]')).toBeNull();
	expect(document.activeElement).toBe(getButton());
});

it('keeps the icon visible and reports a failed save', async () => {
	vi.spyOn(console, 'error').mockImplementation(() => {});
	vi.mocked(browser.storage.sync.set).mockRejectedValueOnce(new Error('quota exceeded'));
	cleanup = await initializeQuickClipButton();
	openMenu();
	const hide = document.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
	hide.click();
	await vi.waitFor(() => expect(hide.textContent).toBe('quickClipSaveFailed'));
	expect(hide.disabled).toBe(false);
	expect(getButton()).not.toBeNull();
});

it('adds and restores websites in settings while updating the current page', async () => {
	document.body.innerHTML = '<input id="quick-clip-site-input"><button id="quick-clip-site-add"></button><ul id="quick-clip-hidden-sites"></ul><div id="quick-clip-sites-status"></div>';
	await initializeQuickClipSettings();
	cleanup = await initializeQuickClipButton();
	const input = document.getElementById('quick-clip-site-input') as HTMLInputElement;
	input.value = window.location.href;
	document.getElementById('quick-clip-site-add')!.click();
	await vi.waitFor(() => expect(document.querySelectorAll('#quick-clip-hidden-sites li')).toHaveLength(1));
	expect(getButton()).toBeNull();
	expect(input.value).toBe('');
	document.querySelector<HTMLButtonElement>('#quick-clip-hidden-sites button')!.click();
	await vi.waitFor(() => expect(document.querySelectorAll('#quick-clip-hidden-sites li')).toHaveLength(0));
	expect(getButton()).not.toBeNull();
	expect(data[key]).toEqual([]);
});
