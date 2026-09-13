import browser from './browser-polyfill';
import { getMessage, getCurrentLanguage, initializeI18n } from './i18n';
import { QUICK_CLIP_HIDDEN_SITES_KEY, loadQuickClipHiddenSites, normalizeQuickClipSite, parseQuickClipHiddenSites, setQuickClipSiteHidden } from './quick-clip-sites';

export async function initializeQuickClipButton(isCurrent: () => boolean = () => true): Promise<() => void> {
	const site = normalizeQuickClipSite(document.URL);
	if (!site || !/^https?:/.test(document.URL)) return () => {};
	const language = await getCurrentLanguage();
	if (language) await initializeI18n();
	if (!isCurrent()) return () => {};
	const getLabel = (key: string) => language ? getMessage(key) : browser.i18n.getMessage(key) || getMessage(key);
	let button: HTMLButtonElement | null = null;
	let menu: HTMLDivElement | null = null;
	let cleanupDrag = () => {};
	let revision = 0;

	function closeMenu() {
		menu?.remove();
		menu = null;
		button?.setAttribute('aria-expanded', 'false');
		document.removeEventListener('pointerdown', onOutsidePointerDown, true);
		document.removeEventListener('keydown', onMenuKeyDown);
	}

	function onOutsidePointerDown(event: PointerEvent) {
		if (!menu?.contains(event.target as Node)) closeMenu();
	}

	function onMenuKeyDown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			closeMenu();
			button?.focus();
		}
	}

	function showMenu(anchor: HTMLButtonElement) {
		closeMenu();
		menu = document.createElement('div');
		menu.id = 'obsidian-clipper-quickclip-menu';
		menu.setAttribute('role', 'menu');
		Object.assign(menu.style, {
			position: 'fixed', right: '48px',
			top: `${Math.max(8, Math.min(anchor.getBoundingClientRect().top, window.innerHeight - 100))}px`,
			zIndex: '2147483647', padding: '6px', borderRadius: '8px',
			background: '#fff', color: '#222', boxShadow: '0 2px 12px #0003',
			maxWidth: 'calc(100vw - 64px)', font: '14px system-ui',
		});
		const hide = document.createElement('button');
		hide.type = 'button';
		hide.setAttribute('role', 'menuitem');
		hide.textContent = getLabel('quickClipHideOnSite');
		Object.assign(hide.style, {
			display: 'block', border: 'none', borderRadius: '4px', padding: '10px 12px',
			background: '#f3f0ff', color: '#222', font: 'inherit', cursor: 'pointer',
		});
		hide.addEventListener('click', async event => {
			event.stopPropagation();
			hide.disabled = true;
			try {
				await setQuickClipSiteHidden(site!, true);
				updateVisibility(true);
			} catch (error) {
				hide.disabled = false;
				hide.textContent = getLabel('quickClipSaveFailed');
				console.error('[Clipper] Failed to hide quick clip button:', error);
			}
		});
		menu.appendChild(hide);
		document.body.appendChild(menu);
		anchor.setAttribute('aria-expanded', 'true');
		hide.focus();
		document.addEventListener('pointerdown', onOutsidePointerDown, true);
		document.addEventListener('keydown', onMenuKeyDown);
	}

	function removeButton() {
		closeMenu();
		cleanupDrag();
		button?.remove();
		button = null;
	}

	function updateVisibility(hidden: boolean) {
		if (!isCurrent()) return;
		if (hidden) removeButton();
		else if (!button) button = createQuickClipButton();
	}

	const QUICKCLIP_STORAGE_KEY = 'quickClipButtonOffset';

	async function loadQuickClipOffset(): Promise<number> {
		try {
			const result = await browser.storage.local.get(QUICKCLIP_STORAGE_KEY);
			return typeof result[QUICKCLIP_STORAGE_KEY] === 'number' ? result[QUICKCLIP_STORAGE_KEY] : 0;
		} catch {
			return 0;
		}
	}

	async function saveQuickClipOffset(offset: number): Promise<void> {
		try {
			await browser.storage.local.set({ [QUICKCLIP_STORAGE_KEY]: offset });
		} catch {
			// ignore
		}
	}

	function createQuickClipButton(): HTMLButtonElement {
		const btn = document.createElement('button');
		btn.id = 'obsidian-clipper-quickclip-btn';
		btn.type = 'button';
		btn.setAttribute('aria-label', getLabel('quickClipButtonTooltip'));
		btn.title = getLabel('quickClipButtonTooltip');
		btn.setAttribute('aria-haspopup', 'menu');
		btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>`;

		// Inline styles to avoid depending on CSS injection
		Object.assign(btn.style, {
			position: 'fixed',
			right: '0',
			top: '50%',
			transform: 'translateY(-50%)',
			zIndex: '999999999',
			width: '36px',
			height: '48px',
			padding: '0',
			margin: '0',
			border: 'none',
			borderRadius: '8px 0 0 8px',
			backgroundColor: '#7c3aed',
			color: '#fff',
			cursor: 'pointer',
			display: 'flex',
			alignItems: 'center',
			justifyContent: 'center',
			boxShadow: '-2px 0 8px rgba(0,0,0,0.15)',
			transition: 'width 0.2s ease, background-color 0.2s ease',
			userSelect: 'none',
			webkitUserSelect: 'none',
		});

		let pointerId: number | null = null;
		let isDragging = false;
		let dragStartY = 0;
		let dragStartOffset = 0;
		let currentOffset = 0;
		let hasDragged = false;

		function updatePosition(offset: number) {
			currentOffset = offset;
			btn.style.transform = `translateY(calc(-50% + ${offset}px))`;
		}

		// Load saved position
		loadQuickClipOffset().then(offset => {
			currentOffset = offset;
			updatePosition(offset);
		});

		function onPointerMove(e: PointerEvent) {
			if (!isDragging) return;
			const deltaY = e.clientY - dragStartY;
			if (Math.abs(deltaY) > 3) {
				hasDragged = true;
			}
			updatePosition(dragStartOffset + deltaY);
		}

		function onPointerUp() {
			if (!isDragging) return;
			isDragging = false;
			btn.style.cursor = 'pointer';
			if (pointerId !== null && btn.hasPointerCapture(pointerId)) btn.releasePointerCapture(pointerId);
			document.removeEventListener('pointermove', onPointerMove);
			document.removeEventListener('pointerup', onPointerUp);
			if (hasDragged) {
				saveQuickClipOffset(currentOffset);
			}
			setTimeout(() => { hasDragged = false; }, 50);
		}

		btn.addEventListener('pointerdown', (e) => {
			// Only left click / primary pointer
			if (e.button !== 0) return;
			isDragging = true;
			hasDragged = false;
			dragStartY = e.clientY;
			dragStartOffset = currentOffset;
			btn.style.cursor = 'grabbing';
			pointerId = e.pointerId;
			try { btn.setPointerCapture(e.pointerId); } catch { /* ignore */ }
			document.addEventListener('pointermove', onPointerMove);
			document.addEventListener('pointerup', onPointerUp);
		});

		btn.addEventListener('mouseenter', () => {
			if (isDragging) return;
			btn.style.width = '44px';
			btn.style.backgroundColor = '#6d28d9';
		});
		btn.addEventListener('mouseleave', () => {
			if (isDragging) return;
			btn.style.width = '36px';
			btn.style.backgroundColor = '#7c3aed';
		});

		btn.addEventListener('click', (e) => {
			if (hasDragged) {
				e.preventDefault();
				e.stopPropagation();
				return;
			}
			browser.runtime.sendMessage({ action: 'quickClipFromIcon' })
				.catch(error => console.error('[Clipper] Failed to send quick clip:', error));
		});

		btn.addEventListener('contextmenu', event => {
			event.preventDefault();
			event.stopPropagation();
			showMenu(btn);
		});
		cleanupDrag = () => {
			document.removeEventListener('pointermove', onPointerMove);
			document.removeEventListener('pointerup', onPointerUp);
		};
		document.body.appendChild(btn);
		return btn;
	}


	const onStorageChanged = (changes: Record<string, browser.Storage.StorageChange>, area: string) => {
		if (area !== 'sync' || !changes[QUICK_CLIP_HIDDEN_SITES_KEY] || !isCurrent()) return;
		revision++;
		updateVisibility(parseQuickClipHiddenSites(changes[QUICK_CLIP_HIDDEN_SITES_KEY].newValue).includes(site));
	};
	browser.storage.onChanged.addListener(onStorageChanged);
	const initialRevision = revision;
	try {
		const sites = await loadQuickClipHiddenSites();
		if (revision === initialRevision) updateVisibility(sites.includes(site));
	} catch (error) {
		console.error('[Clipper] Failed to load quick clip visibility:', error);
	}

	return () => {
		browser.storage.onChanged.removeListener(onStorageChanged);
		removeButton();
	};
}
