import browser from './browser-polyfill';

export const QUICK_CLIP_HIDDEN_SITES_KEY = 'quickClipHiddenSites';

// Match the exact hostname, regardless of scheme, port, or path. Keep sibling
// subdomains separate so hiding one service does not hide unrelated services.
export function normalizeQuickClipSite(value: string): string | null {
	const input = value.trim();
	if (!input || /\s/.test(input)) return null;
	try {
		const url = new URL(input.includes('://') ? input : `https://${input}`);
		if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
		const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
		if (!hostname || hostname.includes('*') || hostname.startsWith('.') || hostname.includes('..')) return null;
		return hostname;
	} catch {
		return null;
	}
}

export function parseQuickClipHiddenSites(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return [...new Set(value.flatMap(site => {
		const hostname = typeof site === 'string' ? normalizeQuickClipSite(site) : null;
		return hostname ? [hostname] : [];
	}))];
}

export async function loadQuickClipHiddenSites(): Promise<string[]> {
	const data = await browser.storage.sync.get(QUICK_CLIP_HIDDEN_SITES_KEY);
	return parseQuickClipHiddenSites(data[QUICK_CLIP_HIDDEN_SITES_KEY]);
}

export async function setQuickClipSiteHidden(site: string, hidden: boolean): Promise<void> {
	const hostname = normalizeQuickClipSite(site);
	if (!hostname) throw new Error('Invalid website');
	const sites = await loadQuickClipHiddenSites();
	const updated = hidden ? [...new Set([...sites, hostname])] : sites.filter(value => value !== hostname);
	await browser.storage.sync.set({ [QUICK_CLIP_HIDDEN_SITES_KEY]: updated });
}
