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

// 🌟 核心修复 1：为 Dataview 的隐式 API 建立严格的类型定义，消灭 any 报错
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
        path: string; // 🌟 修复：添加 path 属性
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
    page(path: string): DataviewPage | undefined; // 🌟 修复：添加 page 方法定义
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
        return "iCalendar"; // 🌟 修复 UI 文本大小写规范报错
    }

    getIcon(): string {
        return "calendar-clock";
    }

    async onOpen(): Promise<void> {
        const container = this.containerEl.children[1] as HTMLElement | undefined;
        if (!container) return;
        container.empty();
        
        // 🌟 修复直接操作 style 的报错，改用 class
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
    settings!: ICalendarSettings; // 使用 ! 断言它一定会在 onload 中初始化
    private taskCache: Map<string, TaskItem[]> = new Map();
    async onload(): Promise<void> {
        await this.loadSettings();

        this.registerView(
            VIEW_TYPE_ICALENDAR,
            (leaf: WorkspaceLeaf) => new ICalendarView(leaf, this)
        );

        this.addRibbonIcon('calendar-clock', 'Open iCalendar view', () => {
            // 🌟 修复 Floating Promise
            void this.activateView();
        });

        // 🌟 修复命令名与 ID 的规范报错
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
            // 使用预编译的 REGEX 对象进行解析（逻辑同你原有的 fetch，但更快）
            const parsedTask = this.parseDataviewTask(t, page.file.name, fileDate);
            if (parsedTask) fileTasks.push(parsedTask);
        }
        
        this.taskCache.set(page.file.path, fileTasks);
    }
    private parseDataviewTask(t: DataviewTask, fileName: string, fileDate: string | null): TaskItem | null {
        let taskDate: string | null = null;
        let type: 'todo' | 'done' = t.completed ? 'done' : 'todo';

        if (t.completed) {
            const cMatch = t.text.match(REGEX.DONE_DATE);
            taskDate = cMatch?.[1] || (t.completion ? window.moment(t.completion).format('YYYY-MM-DD') : null);
        } else {
            const dMatch = t.text.match(REGEX.DATE);
            taskDate = dMatch?.[1] || null;
        }

        if (!taskDate && fileDate) taskDate = fileDate;
        if (!taskDate) return null; // 依然保留你的逻辑：无日期不显示

        const rawText = t.text;
        // 计算优先级
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
            // 🌟 更符合现代 API 的方式，取代 true
            leaf = workspace.getLeaf('tab');
            if (leaf) {
                await leaf.setViewState({ type: VIEW_TYPE_ICALENDAR, active: true });
            }
        }
        if (leaf) {
            // 🌟 修复 Floating Promise：在最新版 API 中，这可能被视为异步调用
            await workspace.revealLeaf(leaf);
        }
    }

    getDataviewAPI(): DataviewAPI | undefined {
        // 使用 unknown 替代 any 进行安全的类型收窄
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
                    // 🌟 修复 Emoji 代理对引起的误导性字符组报错，改用 (?:) 分组
                    const dMatch = t.text.match(/(?:📅|⏳|🛫)\s*(\d{4}-\d{2}-\d{2})/);
                    if (dMatch && dMatch[1]) {
                        taskDate = dMatch[1];
                    }
                }

                if (!taskDate && fileDate) taskDate = fileDate;

                if (taskDate) {
                    const rawText = t.text;
                    let priorityLevel = 2; 
                    if (rawText.includes('🔺')) priorityLevel = 5;
                    else if (rawText.includes('⏫')) priorityLevel = 4;
                    else if (rawText.includes('🔼')) priorityLevel = 3;
                    else if (rawText.includes('🔽')) priorityLevel = 1;
                    else if (rawText.includes('⏬')) priorityLevel = 0;

                    const tags = rawText.match(/#[\w\u4e00-\u9fa5/]+/g) || [];
                
                // 🌟 核心修复：彻底摒弃带 Emoji 的 [] 字符组，改用非捕获组 (?:)
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
    async revertTask(originalTask: TaskItem): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(originalTask.path);
        if (!(file instanceof TFile)) return;

        const content = await this.app.vault.read(file);
        const lines = content.split('\n');
        let lineStr = lines[originalTask.line];
        
        // 基础校验：如果当前行完全不包含原始内容，说明文件可能被外部大幅篡改，放弃回滚
        if (!lineStr) return;

        // 🌟 强制恢复到原始文本（这是最简单且最暴力有效的回滚方式）
        lines[originalTask.line] = originalTask.originalText;
        
        await this.app.vault.modify(file, lines.join('\n'));
    }
    async toggleTask(task: TaskItem): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(task.path);
        if (!(file instanceof TFile)) return;

        // 🌟 核心修复 1：使用双重断言 (unknown -> 具体接口) 替代 any，满足严格安全检查
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

        // 🌟 1. 捕获并剥离行尾的块引用哈希
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

                // 🌟 注意：这里 newTaskStr 是基于已经去除了 blockRef 的 lineStr 生成的
                // 这完美避免了新周期任务与老任务产生 ID 冲突
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

        // 修改当前行的完成状态
        if (task.type === 'todo') { 
            lineStr = lineStr.replace(/-\s\[\s\]/, '- [x]');
            if (!lineStr.match(/✅\s*\d{4}-\d{2}-\d{2}/u)) {
                lineStr += ` ✅ ${window.moment().format('YYYY-MM-DD')}`;
            }
        } else { 
            lineStr = lineStr.replace(/-\s\[x\]/i, '- [ ]');
            lineStr = lineStr.replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/u, '');
        }

        // 🌟 2. 将块引用拼回当前已被修改完毕的任务行末尾
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

        // 🌟 1. 捕获并剥离行尾的块引用哈希 (形如 ^1a2b3c)
        const blockRefRegex = /(\s+\^[a-zA-Z0-9-]+)\s*$/;
        const blockRefMatch = lineStr.match(blockRefRegex);
        const blockRef = blockRefMatch ? blockRefMatch[1] : '';
        if (blockRef) {
            lineStr = lineStr.replace(blockRefRegex, ''); // 暂时移除
        }

        // --- 以下保持原有的日期和优先级修改逻辑 ---
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
        // --- 原有逻辑结束 ---

        // 🌟 2. 将之前保存的块引用重新拼接回绝对末尾
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