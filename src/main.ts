/* eslint-disable obsidianmd/ui/sentence-case */
import { Plugin, ItemView, WorkspaceLeaf, TFile, Notice } from 'obsidian';
import { createRoot, Root } from 'react-dom/client';
import * as React from 'react';
import { ICalendarSettings, DEFAULT_SETTINGS, ICalendarSettingTab } from './settings';
import { Dashboard } from './icalendar';

export const VIEW_TYPE_ICALENDAR = "icalendar-view";

const REGEX = {
    DATE: /(?:📅|⏳|🛫)\s*(\d{4}-\d{2}-\d{2})/u,
    DONE_DATE: /✅\s*(\d{4}-\d{2}-\d{2})/u,
    TAG: /#[\w\u4e00-\u9fa5/]+/g,
    PRIORITY: /(?:🔺|⏫|🔼|🔽|⏬)/gu,
    TASK_MARKER: /-\s\[([\sxX])\]/
};

const PRIO_ICONS: Record<number, string> = { 5: '🔺', 4: '⏫', 3: '🔼', 1: '🔽', 0: '⏬' };

export interface TaskItem {
    content: string;
    date: string | null;
    type: 'todo' | 'done';
    priority: number;
    path: string;
    line: number;
    fileName: string;
    colorIndex: number;
    tags: string[];
    originalText: string;
}

interface DataviewTask {
    completed: boolean;
    text: string;
    completion?: string | Date;
    path: string;
    line: number;
}

interface DataviewPage {
    file: {
        name: string;
        path: string;
        tasks?: DataviewTask[];
        day?: {
            toISODate: () => string;
        };
    };
}
interface ObsidianTasksApiV1 {
    executeToggleCommand(file: TFile, lineNumber: number): Promise<void>;
}
interface ObsidianAppWithPlugins {
    plugins: {
        plugins: {
            'obsidian-tasks-plugin'?: {
                apiV1?: ObsidianTasksApiV1;
            };
            [key: string]: unknown;
        };
    };
}

interface DataviewAPI {
    pages(query: string): DataviewPage[];
    page(path: string): DataviewPage | undefined;
}

export class ICalendarView extends ItemView {
    root: Root | null = null;
    plugin: ICalendarPlugin;

    constructor(leaf: WorkspaceLeaf, plugin: ICalendarPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return VIEW_TYPE_ICALENDAR;
    }

    getDisplayText(): string {
        return "iCalendar";
    }

    getIcon(): string {
        return "calendar-clock";
    }

    async onOpen(): Promise<void> {
        const container = this.containerEl.children[1] as HTMLElement | undefined;
        if (!container) return;
        container.empty();
        
        container.addClass('icalendar-plugin-container');
        
        this.root = createRoot(container);
        
        this.root.render(
            React.createElement(Dashboard, { 
                plugin: this.plugin
            })
        );
    }

    async onClose(): Promise<void> {
        if (this.root) {
            this.root.unmount();
        }
    }
}

export default class ICalendarPlugin extends Plugin {
    settings!: ICalendarSettings; 
    private taskCache: Map<string, TaskItem[]> = new Map();

    async onload(): Promise<void> {
        await this.loadSettings();

        this.registerView(
            VIEW_TYPE_ICALENDAR,
            (leaf: WorkspaceLeaf) => new ICalendarView(leaf, this)
        );

        this.addRibbonIcon('calendar-clock', 'Open iCalendar view', () => {
            void this.activateView();
        });

        this.addCommand({
            id: 'open-view',
            name: 'Open calendar view',
            callback: () => {
                void this.activateView();
            }
        });
        this.app.workspace.onLayoutReady(() => {
            void this.initialFetch();
        });

        this.addSettingTab(new ICalendarSettingTab(this.app, this));
    }

    private async initialFetch() {
        const dv = this.getDataviewAPI();
        if (!dv) return;
        const pages = dv.pages('""');
        for (const page of pages) {
            this.updateFileCache(page);
        }
    }

    public updateFileCache(page: DataviewPage) {
        if (!page.file.tasks) {
            this.taskCache.delete(page.file.path);
            return;
        }
        
        const fileTasks: TaskItem[] = [];
        const fileDate = page.file.day ? page.file.day.toISODate() : null;

        for (const t of page.file.tasks) {
            const parsedTask = this.parseDataviewTask(t, page.file.name, fileDate, page.file.path);
            if (parsedTask) fileTasks.push(parsedTask);
        }
        
        this.taskCache.set(page.file.path, fileTasks);
    }

    private parseDataviewTask(t: DataviewTask, fileName: string, fileDate: string | null, filePath: string): TaskItem | null {
        let taskDate: string | null = null;
        const type: 'todo' | 'done' = t.completed ? 'done' : 'todo';

        if (t.completed) {
            const cMatch = t.text.match(REGEX.DONE_DATE);
            taskDate = cMatch?.[1] || (t.completion ? window.moment(t.completion).format('YYYY-MM-DD') : null);
        } else {
            const dMatch = t.text.match(REGEX.DATE);
            taskDate = dMatch?.[1] || null;
        }

        if (!taskDate && fileDate) taskDate = fileDate;
        
        // 🌟 核心引擎修改：允许收纳箱中的无日期任务穿透拦截
        const isInboxTask = filePath === this.settings.inboxFilePath;
        if (!taskDate && !isInboxTask) return null; 

        const rawText = t.text;
        let priorityLevel = 2;
        const prioMatch = rawText.match(REGEX.PRIORITY);
        if (prioMatch) {
            const icon = prioMatch[0];
            priorityLevel = Object.keys(PRIO_ICONS).find(k => PRIO_ICONS[Number(k)] === icon) ? Number(Object.keys(PRIO_ICONS).find(k => PRIO_ICONS[Number(k)] === icon)) : 2;
        }

        return {
            content: this.cleanTaskText(rawText),
            date: taskDate,
            type,
            priority: priorityLevel,
            path: t.path,
            line: t.line,
            fileName,
            colorIndex: (fileName.length % 3) + 1,
            tags: rawText.match(REGEX.TAG) || [],
            originalText: rawText
        };
    }

    private cleanTaskText(text: string): string {
        return text
            .replace(REGEX.DONE_DATE, '')
            .replace(REGEX.DATE, '')
            .replace(REGEX.TAG, '')
            .replace(REGEX.PRIORITY, '')
            .trim();
    }

    async getTasksFromCache(): Promise<TaskItem[]> {
        return Array.from(this.taskCache.values()).flat();
    }

    async activateView(): Promise<void> {
        const { workspace } = this.app;
        let leaf: WorkspaceLeaf | null = null;
        const leaves = workspace.getLeavesOfType(VIEW_TYPE_ICALENDAR);

        if (leaves.length > 0) {
            leaf = leaves[0] ?? null;
        } else {
            leaf = workspace.getLeaf('tab');
            if (leaf) {
                await leaf.setViewState({ type: VIEW_TYPE_ICALENDAR, active: true });
            }
        }
        if (leaf) {
            await workspace.revealLeaf(leaf);
        }
    }

    getDataviewAPI(): DataviewAPI | undefined {
        const customApp = this.app as unknown as {
            plugins?: {
                plugins?: {
                    dataview?: {
                        api?: DataviewAPI;
                    };
                };
            };
        };
        return customApp.plugins?.plugins?.dataview?.api;
    }

    async fetchTasksFromDataview(): Promise<TaskItem[]> {
        await new Promise(resolve => setTimeout(resolve, 50));

        const dv = this.getDataviewAPI();
        if (!dv) return [];

        const allTasks: TaskItem[] = [];
        const pages = dv.pages('""');

        for (const page of pages) {
            if (!page.file.tasks) continue;
            
            const fileDate = page.file.day ? page.file.day.toISODate() : null;

            for (const t of page.file.tasks) {
                let taskDate: string | null = null;
                let type: 'todo' | 'done' = 'todo';

                if (t.completed) {
                    type = 'done';
                    const cMatch = t.text.match(/✅\s*(\d{4}-\d{2}-\d{2})/);
                    if (cMatch && cMatch[1]) {
                        taskDate = cMatch[1];
                    } else if (t.completion) {
                        taskDate = window.moment(t.completion).format('YYYY-MM-DD');
                    }
                } else {
                    const dMatch = t.text.match(/(?:📅|⏳|🛫)\s*(\d{4}-\d{2}-\d{2})/);
                    if (dMatch && dMatch[1]) {
                        taskDate = dMatch[1];
                    }
                }

                if (!taskDate && fileDate) taskDate = fileDate;

                // 🌟 核心引擎修改：兼容初次拉取时的收纳箱任务穿透
                const isInboxTask = t.path === this.settings.inboxFilePath;

                if (taskDate || isInboxTask) {
                    const rawText = t.text;
                    let priorityLevel = 2; 
                    if (rawText.includes('🔺')) priorityLevel = 5;
                    else if (rawText.includes('⏫')) priorityLevel = 4;
                    else if (rawText.includes('🔼')) priorityLevel = 3;
                    else if (rawText.includes('🔽')) priorityLevel = 1;
                    else if (rawText.includes('⏬')) priorityLevel = 0;

                    const tags = rawText.match(/#[\w\u4e00-\u9fa5/]+/g) || [];
                
                    const cleanContent = rawText
                        .replace(/(?:✅|📅|⏳|🛫)\s*\d{4}-\d{2}-\d{2}/gu, '') 
                        .replace(/#[\w\u4e00-\u9fa5/]+/g, '')
                        .replace(/(?:🔺|⏫|🔼|🔽|⏬)/gu, '') 
                        .trim();
                    
                    let hash = 0;
                    for (let i = 0; i < page.file.name.length; i++) hash += page.file.name.charCodeAt(i);
                    const colorIndex = (hash % 3) + 1;

                    allTasks.push({
                        content: cleanContent || "未命名任务",
                        date: taskDate,
                        type,
                        priority: priorityLevel,
                        path: t.path,
                        line: t.line, 
                        fileName: page.file.name,
                        colorIndex,
                        tags,
                        originalText: rawText
                    });
                }
            }
        }
        return allTasks;
    }

    // 🌟 全新收纳箱追加接口（自动创建目录与文件）
    private async ensureFolderExists(path: string) {
        const normalizedPath = path.replace(/\\/g, '/');
        const folderPath = normalizedPath.substring(0, normalizedPath.lastIndexOf('/'));
        if (folderPath === '' || folderPath === '/') return;

        const folder = this.app.vault.getAbstractFileByPath(folderPath);
        if (!folder) {
            const folders = folderPath.split('/');
            let currentPath = '';
            for (const f of folders) {
                currentPath += currentPath === '' ? f : `/${f}`;
                const existing = this.app.vault.getAbstractFileByPath(currentPath);
                if (!existing) {
                    await this.app.vault.createFolder(currentPath);
                }
            }
        }
    }

    async appendTaskToInbox(text: string): Promise<void> {
        let inboxPath = this.settings.inboxFilePath.trim();
        if (!inboxPath.endsWith('.md')) inboxPath += '.md';
        
        await this.ensureFolderExists(inboxPath);
        
        const file = this.app.vault.getAbstractFileByPath(inboxPath);
        const newTaskLine = `- [ ] ${text}`;

        if (file instanceof TFile) {
            const content = await this.app.vault.read(file);
            const newContent = content + (content.endsWith('\n') || content === '' ? '' : '\n') + newTaskLine;
            await this.app.vault.modify(file, newContent);
        } else {
            await this.app.vault.create(inboxPath, newTaskLine);
        }
    }

    async revertTask(originalTask: TaskItem): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(originalTask.path);
        if (!(file instanceof TFile)) return;

        const content = await this.app.vault.read(file);
        const lines = content.split('\n');
        const lineStr = lines[originalTask.line];
        
        if (lineStr === undefined) return;

        lines[originalTask.line] = originalTask.originalText;
        await this.app.vault.modify(file, lines.join('\n'));
    }

    async toggleTask(task: TaskItem): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(task.path);
        if (!(file instanceof TFile)) return;

        const appWithPlugins = this.app as unknown as ObsidianAppWithPlugins;
        const tasksPlugin = appWithPlugins.plugins.plugins['obsidian-tasks-plugin'];
        
        if (tasksPlugin && tasksPlugin.apiV1 && typeof tasksPlugin.apiV1.executeToggleCommand === 'function') {
            try {
                await tasksPlugin.apiV1.executeToggleCommand(file, task.line);
                return; 
            } catch (e) {
                console.warn("调用 Tasks 插件 API 失败，降级为内置处理方案", e);
            }
        }

        const content = await this.app.vault.read(file);
        const lines = content.split('\n');
        let lineStr = lines[task.line];
        if (lineStr === undefined) return;

        const blockRefRegex = /(\s+\^[a-zA-Z0-9-]+)\s*$/;
        const blockRefMatch = lineStr.match(blockRefRegex);
        const blockRef = blockRefMatch ? blockRefMatch[1] : '';
        if (blockRef) {
            lineStr = lineStr.replace(blockRefRegex, '');
        }

        let newTaskStr: string | null = null;
        
        if (task.type === 'todo' && lineStr.includes('🔁')) {
            const recurrenceMatch = lineStr.match(/🔁\s*every\s+(\d+)?\s*(day|week|month|year)s?/i);
            if (recurrenceMatch) {
                const amountStr = recurrenceMatch[1] || '1';
                const amount = parseInt(amountStr, 10);
                const unitStr = (recurrenceMatch[2] || 'day').toLowerCase();
                
                let unit: 'day' | 'week' | 'month' | 'year' = 'day';
                if (unitStr === 'week') unit = 'week';
                if (unitStr === 'month') unit = 'month';
                if (unitStr === 'year') unit = 'year';

                newTaskStr = lineStr; 
                
                const dateRegex = /(📅|⏳|🛫)\s*(\d{4}-\d{2}-\d{2})/gu;
                newTaskStr = newTaskStr.replace(dateRegex, (match: string, icon: string, dateStr: string) => {
                    const newDate = window.moment(dateStr).add(amount, unit).format('YYYY-MM-DD');
                    return `${icon} ${newDate}`;
                });
                
                newTaskStr = newTaskStr.replace(/-\s\[[xX]\]/, '- [ ]');
                newTaskStr = newTaskStr.replace(/✅\s*\d{4}-\d{2}-\d{2}/u, '').trimEnd();
            } else {
                new Notice("该任务包含复杂重复规则，内置引擎暂时跳过新任务生成。建议检查 Tasks 插件状态。");
            }
        }

        if (task.type === 'todo') { 
            lineStr = lineStr.replace(/-\s\[\s\]/, '- [x]');
            if (!lineStr.match(/✅\s*\d{4}-\d{2}-\d{2}/u)) {
                lineStr += ` ✅ ${window.moment().format('YYYY-MM-DD')}`;
            }
        } else { 
            lineStr = lineStr.replace(/-\s\[x\]/i, '- [ ]');
            lineStr = lineStr.replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/u, '');
        }

        lines[task.line] = lineStr + blockRef;

        if (newTaskStr) {
            lines.splice(task.line + 1, 0, newTaskStr);
        }

        await this.app.vault.modify(file, lines.join('\n'));
    }

    async updateTaskMetadata(task: TaskItem, newDateStr: string | null, newPriority: number | string | null): Promise<void> {
        const finalPriority = typeof newPriority === 'number' ? newPriority : null;
        const file = this.app.vault.getAbstractFileByPath(task.path);
        if (!(file instanceof TFile)) return;

        const content = await this.app.vault.read(file);
        const lines = content.split('\n');
        let lineStr = lines[task.line];
        if (lineStr === undefined) return;

        const blockRefRegex = /(\s+\^[a-zA-Z0-9-]+)\s*$/;
        const blockRefMatch = lineStr.match(blockRefRegex);
        const blockRef = blockRefMatch ? blockRefMatch[1] : '';
        if (blockRef) {
            lineStr = lineStr.replace(blockRefRegex, ''); 
        }

        if (newDateStr) {
            const dateRegex = /((?:📅|⏳|🛫)\s*)\d{4}-\d{2}-\d{2}/u;
            if (dateRegex.test(lineStr)) {
                lineStr = lineStr.replace(dateRegex, `$1${newDateStr}`);
            } else {
                lineStr += ` 📅 ${newDateStr}`;
            }
        }

        if (finalPriority !== null) {
            const prioRegex = /(?:🔺|⏫|🔼|🔽|⏬)/gu;
            const iconMap: Record<number, string> = { 5: '🔺', 4: '⏫', 3: '🔼', 2: '', 1: '🔽', 0: '⏬' };
            const newIcon = iconMap[finalPriority] ?? '';
            
            lineStr = lineStr.replace(prioRegex, ''); 
            lineStr = lineStr.replace(/\s+/g, ' ').trimEnd(); 
            
            if (finalPriority !== 2) { 
                lineStr += ` ${newIcon}`;
            }
        }

        lines[task.line] = lineStr + blockRef;
        await this.app.vault.modify(file, lines.join('\n'));
    }

    async loadSettings(): Promise<void> {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<ICalendarSettings>);
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }
}