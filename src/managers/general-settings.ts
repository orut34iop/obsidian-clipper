declare const __BUILD_DATE__: string;
declare const __BUILD_VERSION__: string;

import { handleDragStart, handleDragOver, handleDrop, handleDragEnd } from '../utils/drag-and-drop';
import { initializeIcons } from '../icons/icons';
import { getCommands } from '../utils/hotkeys';
import { initializeToggles, updateToggleState, initializeSettingToggle } from '../utils/ui-utils';
import { generalSettings, loadSettings, saveSettings, setLocalStorage, getLocalStorage } from '../utils/storage-utils';
import { detectBrowser } from '../utils/browser-detection';
import { createElementWithClass, createElementWithHTML } from '../utils/dom-utils';
import { createDefaultTemplate, getTemplates, saveTemplateSettings } from '../managers/template-manager';
import { updateTemplateList, showTemplateEditor } from '../managers/template-ui';
import { exportAllSettings, importAllSettings } from '../utils/import-export';
import { Settings, Template } from '../types/types';
import { exportHighlights } from './highlights-manager';
import { clearNoteIndex } from '../utils/note-index';
import { getMessage, setupLanguageAndDirection } from '../utils/i18n';
import { debounce } from '../utils/debounce';
import browser from '../utils/browser-polyfill';
import { createUsageChart, aggregateUsageData } from '../utils/charts';
import { getClipHistory } from '../utils/storage-utils';
import dayjs from 'dayjs';
import weekOfYear from 'dayjs/plugin/weekOfYear';
import { showModal, hideModal } from '../utils/modal-utils';

dayjs.extend(weekOfYear);

const STORE_URLS = {
	chrome: 'https://chromewebstore.google.com/detail/obsidian-web-clipper/cnjifjpddelmedmihgijeibhnjfabmlf',
	firefox: 'https://addons.mozilla.org/en-US/firefox/addon/web-clipper-obsidian/',
	safari: 'https://apps.apple.com/us/app/obsidian-web-clipper/id6720708363',
	edge: 'https://microsoftedge.microsoft.com/addons/detail/obsidian-web-clipper/eigdjhmgnaaeaonimdklocfekkaanfme'
};

export function updateVaultList(): void {
	const vaultList = document.getElementById('vault-list') as HTMLUListElement;
	if (!vaultList) return;

	// Clear existing vaults
	vaultList.textContent = '';
	generalSettings.vaults.forEach((vault, index) => {
		const li = document.createElement('li');
		li.dataset.index = index.toString();
		li.draggable = true;

		const dragHandle = createElementWithClass('div', 'drag-handle');
		dragHandle.appendChild(createElementWithHTML('i', '', { 'data-lucide': 'grip-vertical' }));
		li.appendChild(dragHandle);

		const span = document.createElement('span');
		span.textContent = vault;
		li.appendChild(span);

		const removeBtn = createElementWithClass('button', 'setting-item-list-remove clickable-icon');
		removeBtn.setAttribute('type', 'button');
		removeBtn.setAttribute('aria-label', getMessage('removeVault'));
		removeBtn.appendChild(createElementWithHTML('i', '', { 'data-lucide': 'trash-2' }));
		li.appendChild(removeBtn);

		li.addEventListener('dragstart', handleDragStart);
		li.addEventListener('dragover', handleDragOver);
		li.addEventListener('drop', handleDrop);
		li.addEventListener('dragend', handleDragEnd);
		removeBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			removeVault(index);
		});
		vaultList.appendChild(li);
	});

	initializeIcons(vaultList);
}

export function addVault(vault: string): void {
	generalSettings.vaults.push(vault);
	saveSettings();
	updateVaultList();
}

export function removeVault(index: number): void {
	generalSettings.vaults.splice(index, 1);
	saveSettings();
	updateVaultList();
}

export async function setShortcutInstructions() {
	const shortcutInstructionsElement = document.querySelector('.shortcut-instructions');
	if (shortcutInstructionsElement) {
		const browser = await detectBrowser();
		// Clear content
		shortcutInstructionsElement.textContent = '';
		shortcutInstructionsElement.appendChild(document.createTextNode(getMessage('shortcutInstructionsIntro') + ' '));
		
		// Browser-specific instructions
		let instructionsText = '';
		let url = '';
		
		switch (browser) {
			case 'chrome':
				instructionsText = getMessage('shortcutInstructionsChrome', ['$URL']);
				url = 'chrome://extensions/shortcuts';
				break;
			case 'brave':
				instructionsText = getMessage('shortcutInstructionsBrave', ['$URL']);
				url = 'brave://extensions/shortcuts';
				break;
			case 'firefox':
				instructionsText = getMessage('shortcutInstructionsFirefox', ['$URL']);
				url = 'about:addons';
				break;
			case 'edge':
				instructionsText = getMessage('shortcutInstructionsEdge', ['$URL']);
				url = 'edge://extensions/shortcuts';
				break;
			case 'safari':
			case 'mobile-safari':
				instructionsText = getMessage('shortcutInstructionsSafari');
				break;
			default:
				instructionsText = getMessage('shortcutInstructionsDefault');
		}
		
		if (url) {
			// Split text around the URL placeholder and add strong element
			const parts = instructionsText.split('$URL');
			if (parts.length === 2) {
				shortcutInstructionsElement.appendChild(document.createTextNode(parts[0]));
				
				const strongElement = document.createElement('strong');
				strongElement.textContent = url;
				shortcutInstructionsElement.appendChild(strongElement);
				
				shortcutInstructionsElement.appendChild(document.createTextNode(parts[1]));
			} else {
				// Fallback if no placeholder found
				shortcutInstructionsElement.appendChild(document.createTextNode(instructionsText));
			}
		} else {
			// Safari and default cases (no URL needed)
			shortcutInstructionsElement.appendChild(document.createTextNode(instructionsText));
		}
	}
}

async function initializeVersionDisplay(): Promise<void> {
	const manifest = browser.runtime.getManifest();
	const versionNumber = document.getElementById('version-number');
	const updateAvailable = document.getElementById('update-available');
	const usingLatestVersion = document.getElementById('using-latest-version');

	if (versionNumber) {
		versionNumber.textContent = manifest.version;
	}

	const buildDate = document.getElementById('build-date');
	if (buildDate && typeof __BUILD_DATE__ !== 'undefined') {
		buildDate.textContent = `(${__BUILD_DATE__})`;
	}

	// Only add update listener for browsers that support it
	const currentBrowser = await detectBrowser();
	if (currentBrowser !== 'safari' && currentBrowser !== 'mobile-safari' && browser.runtime.onUpdateAvailable) {
		browser.runtime.onUpdateAvailable.addListener((details) => {
			if (updateAvailable && usingLatestVersion) {
				updateAvailable.style.display = 'block';
				usingLatestVersion.style.display = 'none';
			}
		});
	} else {
		// For Safari, just hide the update status elements
		if (updateAvailable) {
			updateAvailable.style.display = 'none';
		}
		if (usingLatestVersion) {
			usingLatestVersion.style.display = 'none';
		}
	}
}

export function initializeGeneralSettings(): void {
	loadSettings().then(async () => {
		await setupLanguageAndDirection();

		// Add version check initialization
		await initializeVersionDisplay();

		// Get clip history and ratings
		const history = await getClipHistory();
		const totalClips = history.length;
		const existingRatings = await getLocalStorage('ratings') || [];

		// Show rating section only total clips >= 20 and no previous ratings
		const rateExtensionSection = document.getElementById('rate-extension');
		if (rateExtensionSection && totalClips >= 20 && existingRatings.length === 0) {
			rateExtensionSection.classList.remove('is-hidden');
		}

		if (totalClips >= 20 && existingRatings.length === 0) {
			const starRating = document.querySelector('.star-rating');
			if (starRating) {
				const stars = starRating.querySelectorAll('.star');
				stars.forEach(star => {
					star.addEventListener('click', async () => {
						const rating = parseInt(star.getAttribute('data-rating') || '0');
						stars.forEach(s => {
							if (parseInt(s.getAttribute('data-rating') || '0') <= rating) {
								s.classList.add('is-active');
							} else {
								s.classList.remove('is-active');
							}
						});
						await handleRating(rating);
						
						// Hide the rating section after rating
						if (rateExtensionSection) {
							rateExtensionSection.style.display = 'none';
						}
					});
				});
			}
		}

		updateVaultList();
		initializeShowMoreActionsToggle();
		initializeBetaFeaturesToggle();
		initializeLegacyModeToggle();
		initializeSilentOpenToggle();
		initializeVaultInput();
		initializeOpenBehaviorDropdown();
		initializeKeyboardShortcuts();
		initializeToggles();
		setShortcutInstructions();
		initializeAutoSave();
		initializeResetDefaultTemplateButton();
		initializeExportImportAllSettingsButtons();
		initializeHighlighterSettings();
		initializeExportHighlightsButton();
		initializeSaveBehaviorDropdown();
		initializeSelectionSearchSettings();
		await initializeUsageChart();

		// Initialize feedback modal close button
		const feedbackModal = document.getElementById('feedback-modal');
		const feedbackCloseBtn = feedbackModal?.querySelector('.feedback-close-btn');
		if (feedbackCloseBtn) {
			feedbackCloseBtn.addEventListener('click', () => hideModal(feedbackModal));
		}
	});
}

function initializeAutoSave(): void {
	const generalSettingsForm = document.getElementById('general-settings-form');
	if (generalSettingsForm) {
		// Listen for both input and change events
		generalSettingsForm.addEventListener('input', debounce(saveSettingsFromForm, 500));
		generalSettingsForm.addEventListener('change', debounce(saveSettingsFromForm, 500));
	}
}

function saveSettingsFromForm(): void {
	const openBehaviorDropdown = document.getElementById('open-behavior-dropdown') as HTMLSelectElement;
	const showMoreActionsToggle = document.getElementById('show-more-actions-toggle') as HTMLInputElement;
	const betaFeaturesToggle = document.getElementById('beta-features-toggle') as HTMLInputElement;
	const legacyModeToggle = document.getElementById('legacy-mode-toggle') as HTMLInputElement;
	const silentOpenToggle = document.getElementById('silent-open-toggle') as HTMLInputElement;
	const highlighterToggle = document.getElementById('highlighter-toggle') as HTMLInputElement;
	const alwaysShowHighlightsToggle = document.getElementById('highlighter-visibility') as HTMLInputElement;
	const highlightBehaviorSelect = document.getElementById('highlighter-behavior') as HTMLSelectElement;
	const selectionSearchToggle = document.getElementById('selection-search-toggle') as HTMLInputElement;
	const localRestApiUrl = document.getElementById('local-rest-api-url') as HTMLInputElement;
	const localRestApiKey = document.getElementById('local-rest-api-key') as HTMLInputElement;
	const similarityThreshold = document.getElementById('similarity-threshold') as HTMLInputElement;
	const searchPathsInput = document.getElementById('search-paths-input') as HTMLInputElement;

	const updatedSettings = {
		...generalSettings, // Keep existing settings
		openBehavior: (openBehaviorDropdown?.value as Settings['openBehavior']) ?? generalSettings.openBehavior,
		showMoreActionsButton: showMoreActionsToggle?.checked ?? generalSettings.showMoreActionsButton,
		betaFeatures: betaFeaturesToggle?.checked ?? generalSettings.betaFeatures,
		legacyMode: legacyModeToggle?.checked ?? generalSettings.legacyMode,
		silentOpen: silentOpenToggle?.checked ?? generalSettings.silentOpen,
		highlighterEnabled: highlighterToggle?.checked ?? generalSettings.highlighterEnabled,
		alwaysShowHighlights: alwaysShowHighlightsToggle?.checked ?? generalSettings.alwaysShowHighlights,
		highlightBehavior: highlightBehaviorSelect?.value ?? generalSettings.highlightBehavior,
		selectionSearchEnabled: selectionSearchToggle?.checked ?? generalSettings.selectionSearchEnabled,
		localRestApiUrl: localRestApiUrl?.value ?? generalSettings.localRestApiUrl,
		localRestApiKey: localRestApiKey?.value ?? generalSettings.localRestApiKey,
		searchSimilarityThreshold: similarityThreshold ? parseInt(similarityThreshold.value) / 100 : generalSettings.searchSimilarityThreshold,
		searchPaths: searchPathsInput?.value ?? generalSettings.searchPaths,
	};

	saveSettings(updatedSettings);
}

function initializeShowMoreActionsToggle(): void {
	initializeSettingToggle('show-more-actions-toggle', generalSettings.showMoreActionsButton, (checked) => {
		saveSettings({ ...generalSettings, showMoreActionsButton: checked });
	});
}

function initializeVaultInput(): void {
	const vaultInput = document.getElementById('vault-input') as HTMLInputElement;
	if (vaultInput) {
		vaultInput.addEventListener('keypress', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				const newVault = vaultInput.value.trim();
				if (newVault) {
					addVault(newVault);
					vaultInput.value = '';
				}
			}
		});
	}
}

async function initializeKeyboardShortcuts(): Promise<void> {
	const shortcutsList = document.getElementById('keyboard-shortcuts-list');
	if (!shortcutsList) return;

	const browser = await detectBrowser();

	if (browser === 'mobile-safari') {
		// For Safari, display a message about keyboard shortcuts not being available
		const messageItem = document.createElement('div');
		messageItem.className = 'shortcut-item';
		messageItem.textContent = getMessage('shortcutInstructionsSafari');
		shortcutsList.appendChild(messageItem);
	} else {
		// For other browsers, proceed with displaying the shortcuts
		getCommands().then(commands => {
			commands.forEach(command => {
				const shortcutItem = createElementWithClass('div', 'shortcut-item');
				
				const descriptionSpan = document.createElement('span');
				descriptionSpan.textContent = command.description;
				shortcutItem.appendChild(descriptionSpan);

				const hotkeySpan = createElementWithClass('span', 'setting-hotkey');
				hotkeySpan.textContent = command.shortcut || getMessage('shortcutNotSet');
				shortcutItem.appendChild(hotkeySpan);

				shortcutsList.appendChild(shortcutItem);
			});
		});
	}
}

function initializeBetaFeaturesToggle(): void {
	initializeSettingToggle('beta-features-toggle', generalSettings.betaFeatures, (checked) => {
		saveSettings({ ...generalSettings, betaFeatures: checked });
	});
}

function initializeLegacyModeToggle(): void {
	initializeSettingToggle('legacy-mode-toggle', generalSettings.legacyMode, (checked) => {
		saveSettings({ ...generalSettings, legacyMode: checked });
	});
}

function initializeSilentOpenToggle(): void {
	initializeSettingToggle('silent-open-toggle', generalSettings.silentOpen, (checked) => {
		saveSettings({ ...generalSettings, silentOpen: checked });
	});
}

function initializeOpenBehaviorDropdown(): void {
	initializeSettingDropdown(
		'open-behavior-dropdown',
		generalSettings.openBehavior,
		(value) => {
			saveSettings({ ...generalSettings, openBehavior: value as Settings['openBehavior'] });
		}
	);
}

function initializeResetDefaultTemplateButton(): void {
	const resetDefaultTemplateBtn = document.getElementById('reset-default-template-btn');
	if (resetDefaultTemplateBtn) {
		resetDefaultTemplateBtn.addEventListener('click', resetDefaultTemplate);
	}
}

function initializeSaveBehaviorDropdown(): void {
    const dropdown = document.getElementById('save-behavior-dropdown') as HTMLSelectElement;
    if (!dropdown) return;

    dropdown.value = generalSettings.saveBehavior;
    dropdown.addEventListener('change', () => {
        const newValue = dropdown.value as 'addToObsidian' | 'copyToClipboard' | 'saveFile';
        saveSettings({ saveBehavior: newValue });
    });
}

export function resetDefaultTemplate(): void {
	const defaultTemplate = createDefaultTemplate();
	const currentTemplates = getTemplates();
	const defaultIndex = currentTemplates.findIndex((t: Template) => t.name === getMessage('defaultTemplateName'));
	
	if (defaultIndex !== -1) {
		currentTemplates[defaultIndex] = defaultTemplate;
	} else {
		currentTemplates.unshift(defaultTemplate);
	}

	saveTemplateSettings().then(() => {
		updateTemplateList();
		showTemplateEditor(defaultTemplate);
	}).catch(error => {
		console.error('Failed to reset default template:', error);
		alert(getMessage('failedToResetTemplate'));
	});
}

function initializeExportImportAllSettingsButtons(): void {
	const exportAllSettingsBtn = document.getElementById('export-all-settings-btn');
	if (exportAllSettingsBtn) {
		exportAllSettingsBtn.addEventListener('click', exportAllSettings);
	}

	const importAllSettingsBtn = document.getElementById('import-all-settings-btn');
	if (importAllSettingsBtn) {
		importAllSettingsBtn.addEventListener('click', importAllSettings);
	}
}

function initializeExportHighlightsButton(): void {
	const exportHighlightsBtn = document.getElementById('export-highlights');
	if (exportHighlightsBtn) {
		exportHighlightsBtn.addEventListener('click', exportHighlights);
	}
}

function initializeHighlighterSettings(): void {
	initializeSettingToggle('highlighter-toggle', generalSettings.highlighterEnabled, (checked) => {
		saveSettings({ ...generalSettings, highlighterEnabled: checked });
	});

	initializeSettingToggle('highlighter-visibility', generalSettings.alwaysShowHighlights, (checked) => {
		saveSettings({ ...generalSettings, alwaysShowHighlights: checked });
	});

	const highlightBehaviorSelect = document.getElementById('highlighter-behavior') as HTMLSelectElement;
	if (highlightBehaviorSelect) {
		highlightBehaviorSelect.value = generalSettings.highlightBehavior;
		highlightBehaviorSelect.addEventListener('change', () => {
			saveSettings({ ...generalSettings, highlightBehavior: highlightBehaviorSelect.value });
		});
	}
}

async function initializeUsageChart(): Promise<void> {
	const chartContainer = document.getElementById('usage-chart');
	const periodSelect = document.getElementById('usage-period-select') as HTMLSelectElement;
	const aggregationSelect = document.getElementById('usage-aggregation-select') as HTMLSelectElement;
	if (!chartContainer || !periodSelect || !aggregationSelect) return;

	const history = await getClipHistory();

	const updateChart = async () => {
		const options = {
			timeRange: periodSelect.value as '30d' | 'all',
			aggregation: aggregationSelect.value as 'day' | 'week' | 'month'
		};
		
		const chartData = aggregateUsageData(history, options);
		await createUsageChart(chartContainer, chartData);
	};

	// Initialize with default selections
	await updateChart();

	// Update when any selector changes
	periodSelect.addEventListener('change', updateChart);
	aggregationSelect.addEventListener('change', updateChart);
}

async function handleRating(rating: number) {
	// Get existing ratings from storage
	const existingRatings = await getLocalStorage('ratings') || [];
	
	// Add new rating
	const newRating = {
		rating,
		date: new Date().toISOString()
	};
	
	// Update both storage and generalSettings
	const updatedRatings = [...existingRatings, newRating];
	generalSettings.ratings = updatedRatings;
	
	// Save to storage
	await setLocalStorage('ratings', updatedRatings);
	await saveSettings();

	if (rating >= 4) {
		// Redirect to appropriate store
		const browser = await detectBrowser();
		let storeUrl = STORE_URLS.chrome; // Default to Chrome store

		switch (browser) {
			case 'firefox':
			case 'firefox-mobile':
				storeUrl = STORE_URLS.firefox;
				break;
			case 'safari':
			case 'mobile-safari':
			case 'ipad-os':
				storeUrl = STORE_URLS.safari;
				break;
			case 'edge':
				storeUrl = STORE_URLS.edge;
				break;
		}

		window.open(storeUrl, '_blank');
	} else {
		// Show feedback modal for ratings < 4
		const modal = document.getElementById('feedback-modal');
		showModal(modal);
	}
}

function initializeSelectionSearchSettings(): void {
	const toggle = document.getElementById('selection-search-toggle') as HTMLInputElement;
	const config = document.getElementById('selection-search-config') as HTMLDivElement;
	const urlInput = document.getElementById('local-rest-api-url') as HTMLInputElement;
	const keyInput = document.getElementById('local-rest-api-key') as HTMLInputElement;
	const thresholdInput = document.getElementById('similarity-threshold') as HTMLInputElement;
	const thresholdDisplay = document.getElementById('similarity-threshold-display') as HTMLSpanElement;
	const searchPathsInput = document.getElementById('search-paths-input') as HTMLInputElement;
	const clearBtn = document.getElementById('clear-note-index-btn') as HTMLButtonElement;

	const trySave = async (updates: Partial<Settings>) => {
		try {
			await saveSettings({ ...generalSettings, ...updates });
		} catch (err) {
			console.error('[Settings] Failed to save selection search settings:', err, updates);
		}
	};

	if (toggle) {
		toggle.checked = generalSettings.selectionSearchEnabled;
		// initializeToggles ran before this, so sync the visual state now
		const tContainer = toggle.closest('.checkbox-container');
		if (tContainer) updateToggleState(tContainer as HTMLElement, toggle);

		toggle.addEventListener('change', async () => {
			const checked = toggle.checked;
			if (config) {
				config.style.opacity = checked ? '1' : '0.5';
				config.style.pointerEvents = checked ? 'auto' : 'none';
			}
			await trySave({ selectionSearchEnabled: checked });
		});
	}

	if (config) {
		config.style.opacity = generalSettings.selectionSearchEnabled ? '1' : '0.5';
		config.style.pointerEvents = generalSettings.selectionSearchEnabled ? 'auto' : 'none';
	}

	if (urlInput) {
		urlInput.value = generalSettings.localRestApiUrl || '';
		const save = () => trySave({ localRestApiUrl: urlInput.value.trim() });
		urlInput.addEventListener('input', debounce(save, 500));
		urlInput.addEventListener('blur', save);
		urlInput.addEventListener('change', save);
	}

	if (keyInput) {
		keyInput.value = generalSettings.localRestApiKey || '';
		const save = () => trySave({ localRestApiKey: keyInput.value.trim() });
		keyInput.addEventListener('input', debounce(save, 500));
		keyInput.addEventListener('blur', save);
		keyInput.addEventListener('change', save);
	}

	if (searchPathsInput) {
		searchPathsInput.value = generalSettings.searchPaths || '';
		const save = () => trySave({ searchPaths: searchPathsInput.value.trim() });
		searchPathsInput.addEventListener('input', debounce(save, 500));
		searchPathsInput.addEventListener('blur', save);
		searchPathsInput.addEventListener('change', save);
	}

	if (thresholdInput && thresholdDisplay) {
		const pct = Math.round((generalSettings.searchSimilarityThreshold || 0.8) * 100);
		thresholdInput.value = String(pct);
		thresholdDisplay.textContent = `${pct}%`;
		thresholdInput.addEventListener('input', () => {
			const val = parseInt(thresholdInput.value);
			thresholdDisplay.textContent = `${val}%`;
		});
		thresholdInput.addEventListener('change', async () => {
			const val = parseInt(thresholdInput.value) / 100;
			await trySave({ searchSimilarityThreshold: val });
		});
	}

	if (clearBtn) {
		clearBtn.addEventListener('click', async () => {
			if (confirm(getMessage('clearNoteIndex'))) {
				await clearNoteIndex();
			}
		});
	}
}

function initializeSettingDropdown(
	elementId: string,
	defaultValue: string,
	onChange: (newValue: string) => void
): void {
	const dropdown = document.getElementById(elementId) as HTMLSelectElement;
	if (!dropdown) return;
	dropdown.value = defaultValue;
	dropdown.addEventListener('change', () => {
		onChange(dropdown.value);
	});
}
