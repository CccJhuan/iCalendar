/* eslint-disable obsidianmd/ui/sentence-case */
import { Plugin, ItemView, WorkspaceLeaf, TFile } from 'obsidian';
import { createRoot, Root } from 'react-dom/client';
import * as React from 'react';
import { ICalendarSettings, DEFAULT_SETTINGS, ICalendarSettingTab } from './settings';
import { Dashboard } from './icalendar';

export const VIEW_TYPE_ICALENDAR = "icalendar-view";

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
        tasks?: DataviewTask[];
        day?: {
            toISODate: () => string;
        };
    };
}

interface DataviewAPI {
    pages(query: string): DataviewPage[];
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

        this.addSettingTab(new ICalendarSettingTab(this.app, this));
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

    async toggleTask(task: TaskItem): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(task.path);
        if (!(file instanceof TFile)) return;

        const content = await this.app.vault.read(file);
        const lines = content.split('\n');
        let lineStr = lines[task.line];
        if (lineStr === undefined) return;

        if (task.type === 'todo') {
            lineStr = lineStr.replace(/-\s\[\s\]/, '- [x]');
            if (!lineStr.includes('✅')) lineStr += ` ✅ ${window.moment().format('YYYY-MM-DD')}`;
        } else {
            lineStr = lineStr.replace(/-\s\[[xX]\]/, '- [ ]');
            // 🌟 修复 trimRight 废弃报错
            lineStr = lineStr.replace(/✅\s*\d{4}-\d{2}-\d{2}/, '').trimEnd();
        }

        lines[task.line] = lineStr;
        await this.app.vault.modify(file, lines.join('\n'));
    }

    async updateTaskMetadata(task: TaskItem, newDateStr: string | null, newPriority: number | null): Promise<void> {
        const file = this.app.vault.getAbstractFileByPath(task.path);
        if (!(file instanceof TFile)) return;

        const content = await this.app.vault.read(file);
        const lines = content.split('\n');
        let lineStr = lines[task.line];
        if (lineStr === undefined) return;

        if (newDateStr) {
            // 🌟 再次使用非捕获组替代字符组
            const dateRegex = /((?:📅|⏳|🛫)\s*)\d{4}-\d{2}-\d{2}/u;
            if (dateRegex.test(lineStr)) {
                lineStr = lineStr.replace(dateRegex, `$1${newDateStr}`);
            } else {
                lineStr += ` 📅 ${newDateStr}`;
            }
        }

        if (newPriority !== null) {
            // 🌟 加入 /u 修饰符
            const prioRegex = /(?:🔺|⏫|🔼|🔽|⏬)/gu;
            const iconMap: Record<number, string> = { 5: '🔺', 4: '⏫', 3: '🔼', 2: '', 1: '🔽', 0: '⏬' };
            const newIcon = iconMap[newPriority] ?? '';
            
            lineStr = lineStr.replace(prioRegex, ''); 
            lineStr = lineStr.replace(/\s+/g, ' ').trimEnd(); 
            
            if (newPriority !== 2) { 
                lineStr += ` ${newIcon}`;
            }
        }

        lines[task.line] = lineStr;
        await this.app.vault.modify(file, lines.join('\n'));
    }

    async loadSettings(): Promise<void> {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<ICalendarSettings>);
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }
}