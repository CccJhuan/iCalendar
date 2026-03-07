 
import { App, PluginSettingTab, Setting } from 'obsidian';
import type ICalendarPlugin from './main';

export interface ICalendarSettings {
    defaultView: 'month' | 'week' | 'day';
    defaultGroup: 'file' | 'priority';
    taskDensity: 'standard' | 'compact';
}

export const DEFAULT_SETTINGS: ICalendarSettings = {
    defaultView: 'week',
    defaultGroup: 'priority',
    taskDensity: 'standard'
}

export class ICalendarSettingTab extends PluginSettingTab {
    plugin: ICalendarPlugin;

    constructor(app: App, plugin: ICalendarPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        // 🌟 核心修复：使用官方推荐的 setHeading()，取代 createEl('h2')
        ;

        new Setting(containerEl)
            .setName('默认视图')
            .setDesc('打开看板时的默认视图模式')
            .addDropdown(drop => drop
                .addOption('month', '月视图')
                .addOption('week', '周视图')
                .addOption('day', '日视图')
                .setValue(this.plugin.settings.defaultView)
                .onChange(async (value) => {
                    this.plugin.settings.defaultView = value as 'month' | 'week' | 'day';
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName('默认分组模式 (非月视图)')
            .setDesc('周/日视图下的默认任务归类方式')
            .addDropdown(drop => drop
                .addOption('file', '按文件/项目')
                .addOption('priority', '按优先级')
                .setValue(this.plugin.settings.defaultGroup)
                .onChange(async (value) => {
                    this.plugin.settings.defaultGroup = value as 'file' | 'priority';
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName('任务显示密度')
            .setDesc('调整周视图/日视图中单个任务卡片的大小与信息密度')
            .addDropdown(drop => drop
                .addOption('standard', '标准 (舒适阅读)')
                .addOption('compact', '紧凑 (高信息密度)')
                .setValue(this.plugin.settings.taskDensity)
                .onChange(async (value) => {
                    this.plugin.settings.taskDensity = value as 'standard' | 'compact';
                    await this.plugin.saveSettings();
                })
            );
    }
}