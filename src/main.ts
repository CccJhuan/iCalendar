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

export class ICalendarView extends ItemView {
    root: Root | null = null;
    plugin: ICalendarPlugin;

    constructor(leaf: WorkspaceLeaf, plugin: ICalendarPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() {
        return VIEW_TYPE_ICALENDAR;
    }

    getDisplayText() {
        return "iCalendar";
    }

    getIcon() {
        return "calendar-clock";
    }

    async onOpen() {
        const container = this.containerEl.children[1] as HTMLElement | undefined;
        if (!container) return;
        container.empty();
        container.addClass('icalendar-plugin-container');
        
        this.root = createRoot(container);
        
        // 🌟 核心修复：不再同步传递 tasks，也不在此处监听事件。全部交由 React 内部异步处理。
        this.root.render(
            React.createElement(Dashboard, { 
                plugin: this.plugin
            })
        );
    }

    async onClose() {
        if (this.root) {
            this.root.unmount();
        }
    }
}

export default class ICalendarPlugin extends Plugin {
    settings: ICalendarSettings;

    async onload() {
        await this.loadSettings();

        this.registerView(
            VIEW_TYPE_ICALENDAR,
            (leaf) => new ICalendarView(leaf, this)
        );

        this.addRibbonIcon('calendar-clock', 'Open iCalendar', () => {
            this.activateView();
        });

        this.addCommand({
            id: 'open-icalendar-view',
            name: 'Open iCalendar (打开 4K 看板)',
            callback: () => {
                this.activateView();
            }
        });

        this.addSettingTab(new ICalendarSettingTab(this.app, this));
    }

    async activateView() {
        const { workspace } = this.app;
        let leaf: WorkspaceLeaf | null = null;
        const leaves = workspace.getLeavesOfType(VIEW_TYPE_ICALENDAR);

        if (leaves.length > 0) {
            leaf = leaves[0]!;
        } else {
            leaf = workspace.getLeaf(true);
            if (leaf) {
                await leaf.setViewState({ type: VIEW_TYPE_ICALENDAR, active: true });
            }
        }
        if(leaf) workspace.revealLeaf(leaf);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getDataviewAPI(): any {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const customApp = this.app as any;
        return customApp.plugins?.plugins?.dataview?.api;
    }

    // 🌟 核心修复：改为异步函数，并释放主线程，极大地提升 Obsidian 启动性能
    async fetchTasksFromDataview(): Promise<TaskItem[]> {
        // 强制暂停 50 毫秒，将繁重计算推迟，防止卡死 UI
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
                    if (cMatch && cMatch[1]) taskDate = cMatch[1];
                    else if (t.completion) taskDate = window.moment(t.completion).format('YYYY-MM-DD');
                } else {
                    const dMatch = t.text.match(/[📅⏳🛫]\s*(\d{4}-\d{2}-\d{2})/);
                    if (dMatch && dMatch[1]) taskDate = dMatch[1];
                }

                if (!taskDate && fileDate) taskDate = fileDate;

                if (taskDate) {
                    const rawText = t.text as string;
                    let priorityLevel = 2; 
                    if (rawText.includes('🔺')) priorityLevel = 5;
                    else if (rawText.includes('⏫')) priorityLevel = 4;
                    else if (rawText.includes('🔼')) priorityLevel = 3;
                    else if (rawText.includes('🔽')) priorityLevel = 1;
                    else if (rawText.includes('⏬')) priorityLevel = 0;

                    const tags = rawText.match(/#[\w\u4e00-\u9fa5/]+/g) || [];
                    const cleanContent = rawText
                        .replace(/[✅📅⏳🛫]\s*\d{4}-\d{2}-\d{2}/g, '') 
                        .replace(/#[\w\u4e00-\u9fa5/]+/g, '')
                        .replace(/(?:🔺|⏫|🔼|🔽|⏬)/g, '') 
                        .trim();
                    
                    let hash = 0;
                    for (let i = 0; i < page.file.name.length; i++) hash += page.file.name.charCodeAt(i);
                    const colorIndex = (hash % 3) + 1;

                    allTasks.push({
                        content: cleanContent || "无标题任务",
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
            lineStr = lineStr.replace(/✅\s*\d{4}-\d{2}-\d{2}/, '').trimRight();
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
            const dateRegex = /([📅⏳🛫]\s*)\d{4}-\d{2}-\d{2}/;
            if (dateRegex.test(lineStr)) {
                lineStr = lineStr.replace(dateRegex, `$1${newDateStr}`);
            } else {
                lineStr += ` 📅 ${newDateStr}`;
            }
        }

        if (newPriority !== null) {
            const prioRegex = /(?:🔺|⏫|🔼|🔽|⏬)/g;
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

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}