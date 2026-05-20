import { Template, Property, PropertyType } from '../types/types';
import { compressToUTF16, decompressFromUTF16 } from 'lz-string';
import browser from '../utils/browser-polyfill';
import { generalSettings } from '../utils/storage-utils';
import { addPropertyType } from './property-types-manager';
import { getMessage } from '../utils/i18n';

export let templates: Template[] = [];
export let editingTemplateIndex = -1;

const STORAGE_KEY_PREFIX = 'template_';
const TEMPLATE_LIST_KEY = 'template_list';
const CHUNK_SIZE = 8000;
const SIZE_WARNING_THRESHOLD = 6000;

export function setEditingTemplateIndex(index: number): void {
	editingTemplateIndex = index;
}

export async function loadTemplates(): Promise<Template[]> {
	try {
		const data = await browser.storage.sync.get(['template_list']);
		let templateIds = data.template_list as string[] || [];

		// Filter out any null or undefined values
		templateIds = templateIds.filter(id => id != null);

		if (templateIds.length > 0) {
			const loadedTemplates = await Promise.all(templateIds.map(async (id: string) => {
			try {
			const result = await browser.storage.sync.get(`template_${id}`);
			const compressedChunks = result[`template_${id}`] as string[];
			if (compressedChunks) {
				const decompressedData = decompressFromUTF16(compressedChunks.join(''));
				const template = JSON.parse(decompressedData);
				if (template && Array.isArray(template.properties)) {
					return template;
				}
			}
			console.warn(`Template ${id} is invalid or missing`);
			return null;
			} catch (error) {
			console.error(`Error parsing template ${id}:`, error);
			return null;
			}
			}));

			templates = loadedTemplates.filter((t: Template | null): t is Template => t !== null);
		}

		if (templates.length === 0) {
			console.log('No valid templates found, creating default template');
			const defaultTemplate = createDefaultTemplate();
			templates = [defaultTemplate];
			await saveTemplateSettings();
		}

		// Auto-add built-in templates that the user doesn't already have
		const hasZhihuTemplate = templates.some(t =>
			t.name === '知乎回答' ||
			(t.triggers || []).some((tr: string) => tr.includes('zhihu') && tr.includes('answer'))
		);
		if (!hasZhihuTemplate) {
			templates.push(createZhihuTemplate());
			await saveTemplateSettings();
		}

		// Ensure exactly one default template exists (migration for existing installs)
		ensureDefaultTemplate();

		// After loading templates, update global property types
		await updateGlobalPropertyTypes(templates);

		return templates;
	} catch (error) {
		console.error('Error loading templates:', error);
		const defaultTemplate = createDefaultTemplate();
		templates = [defaultTemplate];
		await saveTemplateSettings();
		return templates;
	}
}

export async function saveTemplateSettings(): Promise<string[]> {
	const templateIds = templates.map(t => t.id);
	const warnings: string[] = [];
	const templateChunks: { [key: string]: string[] } = {};

	for (const template of templates) {
		if (!template.noteNameFormat || template.noteNameFormat.trim() === '') {
			warnings.push(`Warning: Template "${template.name}" has an empty note name format. Using default "{{title}}".`);
			template.noteNameFormat = '{{title}}';
		}

		const [chunks, warning] = await prepareTemplateForSave(template);
		templateChunks[STORAGE_KEY_PREFIX + template.id] = chunks;
		if (warning) {
			warnings.push(warning);
		}
	}

	try {
		await browser.storage.sync.set({ ...templateChunks, [TEMPLATE_LIST_KEY]: templateIds });
		console.log('Template settings saved');
		return warnings;
	} catch (error) {
		console.error('Error saving templates:', error);
		throw error;
	}
}

async function prepareTemplateForSave(template: Template): Promise<[string[], string | null]> {
	const compressedData = compressToUTF16(JSON.stringify(template));
	const chunks = [];
	for (let i = 0; i < compressedData.length; i += CHUNK_SIZE) {
		chunks.push(compressedData.slice(i, i + CHUNK_SIZE));
	}

	// Check if the template size is approaching the limit
	if (compressedData.length > SIZE_WARNING_THRESHOLD) {
		return [chunks, `Warning: Template "${template.name}" is ${(compressedData.length / 1024).toFixed(2)}KB, which is approaching the storage limit.`];
	}
	return [chunks, null];
}

export function createDefaultTemplate(): Template {
	return {
		id: Date.now().toString() + Math.random().toString(36).slice(2, 11),
		name: getMessage('defaultTemplateName'),
		behavior: 'create',
		noteNameFormat: '{{title}}',
		path: 'Clippings',
		noteContentFormat: '{{content}}',
		context: "",
		properties: [
			{ id: Date.now().toString() + Math.random().toString(36).slice(2, 11), name: 'title', value: '{{title}}' },
			{ id: Date.now().toString() + Math.random().toString(36).slice(2, 11), name: 'source', value: '{{url}}' },
			{ id: Date.now().toString() + Math.random().toString(36).slice(2, 11), name: 'author', value: '{{author|split:", "|wikilink|join}}' },
			{ id: Date.now().toString() + Math.random().toString(36).slice(2, 11), name: 'published', value: '{{published}}' },
			{ id: Date.now().toString() + Math.random().toString(36).slice(2, 11), name: 'created', value: '{{date}}' },
			{ id: Date.now().toString() + Math.random().toString(36).slice(2, 11), name: 'description', value: '{{description}}' },
			{ id: Date.now().toString() + Math.random().toString(36).slice(2, 11), name: 'tags', value: 'clippings' }
		],
		triggers: [],
		isDefault: true
	};
}

export function createZhihuTemplate(): Template {
	return {
		id: Date.now().toString() + Math.random().toString(36).slice(2, 11),
		name: '知乎回答',
		behavior: 'create',
		noteNameFormat: '{{selector:.QuestionHeader-title|first}}',
		path: 'Clips',
		noteContentFormat: '{{selectorHtml:.RichContent-inner|replace:" src=":" data-src="|replace:"data-original":"src"|join:"<hr>"|markdown}}',
		context: '',
		properties: [
			{ id: Date.now().toString() + Math.random().toString(36).slice(2, 11), name: 'up', value: '[[to read]]', type: 'text' },
			{ id: Date.now().toString() + Math.random().toString(36).slice(2, 11), name: 'title', value: '{{selector:.QuestionHeader-title|first}}', type: 'text' },
			{ id: Date.now().toString() + Math.random().toString(36).slice(2, 11), name: 'source', value: '{{url}}', type: 'text' },
			{ id: Date.now().toString() + Math.random().toString(36).slice(2, 11), name: 'author', value: '{{selector:.UserLink-link|slice:1,99|join:", "}}', type: 'text' },
			{ id: Date.now().toString() + Math.random().toString(36).slice(2, 11), name: 'published', value: '{{date}}', type: 'date' },
			{ id: Date.now().toString() + Math.random().toString(36).slice(2, 11), name: 'created', value: '{{date}}', type: 'date' },
			{ id: Date.now().toString() + Math.random().toString(36).slice(2, 11), name: 'description', value: '{{description}}', type: 'text' }
		],
		triggers: ['/^https.+zhihu.+answer.+$/']
	};
}

export function getDefaultTemplate(): Template | undefined {
	return templates.find(t => t.isDefault);
}

export function ensureDefaultTemplate(): void {
	const hasDefault = templates.some(t => t.isDefault);
	if (!hasDefault && templates.length > 0) {
		// Mark the first template as default if none is set
		templates[0].isDefault = true;
	}
}

export function setDefaultTemplate(templateId: string): void {
	// Unset all, then set the selected one
	templates.forEach(t => { t.isDefault = false; });
	const target = templates.find(t => t.id === templateId);
	if (target) {
		target.isDefault = true;
	}
}

export function getEditingTemplateIndex(): number {
	return editingTemplateIndex;
}

export function getTemplates(): Template[] {
	return templates;
}

export function findTemplateById(id: string): Template | undefined {
	return templates.find(template => template.id === id);
}

export function duplicateTemplate(templateId: string): Template {
	const originalTemplate = templates.find(t => t.id === templateId);
	if (!originalTemplate) {
		throw new Error('Template not found');
	}

	const newTemplate: Template = JSON.parse(JSON.stringify(originalTemplate));
	newTemplate.id = Date.now().toString() + Math.random().toString(36).slice(2, 11);
	newTemplate.name = getUniqueTemplateName(originalTemplate.name);
	
	templates.unshift(newTemplate);
	return newTemplate;
}

function getUniqueTemplateName(baseName: string): string {
	const baseNameWithoutNumber = baseName.replace(/\s\d+$/, '');
	const existingNames = new Set(templates.map(t => t.name));
	let newName = baseNameWithoutNumber;
	let counter = 1;

	while (existingNames.has(newName)) {
		counter++;
		newName = `${baseNameWithoutNumber} ${counter}`;
	}

	return newName;
}

export async function deleteTemplate(templateId: string): Promise<boolean> {
	const index = templates.findIndex(t => t.id === templateId);
	console.log('Deleting template:', templateId);
	if (index !== -1) {
		// Remove from the templates array
		const wasDefault = templates[index].isDefault;
		templates.splice(index, 1);
		if (wasDefault) ensureDefaultTemplate();
		setEditingTemplateIndex(-1);

		try {
			// Remove the template from storage
			await browser.storage.sync.remove(`template_${templateId}`);

			// Get the current template_list
			const data = await browser.storage.sync.get('template_list');
			let templateIds = data.template_list as string[] || [];

			// Remove the deleted template ID from the list
			templateIds = templateIds.filter(id => id !== templateId);

			// Update the template_list in storage
			await browser.storage.sync.set({ 'template_list': templateIds });

			console.log(`Template ${templateId} deleted successfully`);
			return true;
		} catch (error) {
			console.log('Error deleting template:', error);
			return false;
		}
	}
	console.log('Error deleting template');
	return false;
}

async function updateGlobalPropertyTypes(templates: Template[]): Promise<void> {
	const existingTypes = new Set(generalSettings.propertyTypes.map(p => p.name));
	const newTypes: PropertyType[] = [];

	const defaultTypes: { [key: string]: { type: string, defaultValue: string } } = {
		'title': { type: 'text', defaultValue: '{{title}}' },
		'source': { type: 'text', defaultValue: '{{url}}' },
		'author': { type: 'multitext', defaultValue: '{{author|split:", "|wikilink|join}}' },
		'published': { type: 'date', defaultValue: '{{published}}' },
		'created': { type: 'date', defaultValue: '{{date}}' },
		'description': { type: 'text', defaultValue: '{{description}}' },
		'tags': { type: 'multitext', defaultValue: 'clippings' }
	};

	templates.forEach(template => {
		template.properties.forEach(property => {
			if (!existingTypes.has(property.name)) {
			const defaultType = defaultTypes[property.name] || { type: 'text', defaultValue: '' };
			newTypes.push({ 
			name: property.name, 
			type: defaultType.type,
			defaultValue: defaultType.defaultValue
			});
			existingTypes.add(property.name);
			}
		});
	});

	for (const newType of newTypes) {
		await addPropertyType(newType.name, newType.type, newType.defaultValue);
	}
}

export async function rebuildTemplateList(): Promise<void> {
	try {
		// Get all items in storage
		const allItems = await browser.storage.sync.get(null);
		
		// Filter for template keys and extract IDs
		const templateIds = Object.keys(allItems)
			.filter(key => key.startsWith('template_') && key !== 'template_list')
			.map(key => key.replace('template_', ''));

		console.log('Found template IDs:', templateIds);

		// Update the template_list in storage
		await browser.storage.sync.set({ 'template_list': templateIds });

		console.log('Template list rebuilt successfully');

		// Reload templates
		templates = await loadTemplates();

		console.log('Templates reloaded:', templates);
	} catch (error) {
		console.error('Error rebuilding template list:', error);
	}
}

export async function cleanupTemplateStorage(): Promise<void> {
	await rebuildTemplateList();
	await loadTemplates();
	console.log('Template storage cleaned up and rebuilt');
}
