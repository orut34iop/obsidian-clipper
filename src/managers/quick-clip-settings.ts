import browser from '../utils/browser-polyfill';
import { getMessage } from '../utils/i18n';
import { QUICK_CLIP_HIDDEN_SITES_KEY, loadQuickClipHiddenSites, normalizeQuickClipSite, parseQuickClipHiddenSites, setQuickClipSiteHidden } from '../utils/quick-clip-sites';

export async function initializeQuickClipSettings(): Promise<void> {
	const input = document.getElementById('quick-clip-site-input') as HTMLInputElement | null;
	const add = document.getElementById('quick-clip-site-add') as HTMLButtonElement | null;
	const list = document.getElementById('quick-clip-hidden-sites');
	const status = document.getElementById('quick-clip-sites-status');
	if (!input || !add || !list || !status) return;

	function render(sites: string[]) {
		list!.replaceChildren();
		for (const site of sites) {
			const item = document.createElement('li');
			const name = document.createElement('span');
			name.textContent = site;
			const restore = document.createElement('button');
			restore.type = 'button';
			restore.textContent = getMessage('quickClipRestoreOnSite');
			restore.setAttribute('aria-label', `${getMessage('quickClipRestoreOnSite')}: ${site}`);
			restore.addEventListener('click', async () => {
				restore.disabled = true;
				try {
					await setQuickClipSiteHidden(site, false);
					render(await loadQuickClipHiddenSites());
					status!.textContent = '';
				} catch (error) {
					restore.disabled = false;
					status!.textContent = getMessage('quickClipSaveFailed');
					console.error('[Clipper] Failed to restore quick clip button:', error);
				}
			});
			item.append(name, restore);
			list!.appendChild(item);
		}
	}

	async function addSite() {
		if (add!.disabled) return;
		const site = normalizeQuickClipSite(input!.value);
		if (!site) {
			input!.setCustomValidity(getMessage('quickClipInvalidSite'));
			input!.reportValidity();
			return;
		}
		add!.disabled = true;
		try {
			await setQuickClipSiteHidden(site, true);
			input!.value = '';
			status!.textContent = '';
			render(await loadQuickClipHiddenSites());
		} catch (error) {
			status!.textContent = getMessage('quickClipSaveFailed');
			console.error('[Clipper] Failed to save hidden website:', error);
		} finally {
			add!.disabled = false;
		}
	}

	// This setting saves independently, without triggering the general form's autosave.
	input.addEventListener('input', event => {
		event.stopPropagation();
		input.setCustomValidity('');
	});
	input.addEventListener('change', event => event.stopPropagation());
	input.addEventListener('keydown', event => {
		if (event.key === 'Enter') {
			event.preventDefault();
			void addSite();
		}
	});
	add.addEventListener('click', () => { void addSite(); });
	let revision = 0;
	browser.storage.onChanged.addListener((changes, area) => {
		if (area === 'sync' && changes[QUICK_CLIP_HIDDEN_SITES_KEY]) {
			revision++;
			render(parseQuickClipHiddenSites(changes[QUICK_CLIP_HIDDEN_SITES_KEY].newValue));
		}
	});
	try {
		const sites = await loadQuickClipHiddenSites();
		if (revision === 0) render(sites);
	} catch (error) {
		status.textContent = getMessage('quickClipSaveFailed');
		console.error('[Clipper] Failed to load hidden websites:', error);
	}
}
