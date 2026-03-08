 
import { App, PluginSettingTab, Setting } from 'obsidian';
import type ICalendarPlugin from './main';

export interface ICalendarSettings {
    defaultView: 'month' | 'week' | 'day';
    defaultGroup: 'file' | 'priority';
    taskDensity: 'standard' | 'compact';
    priorityWeights: Record<number, number>;
}

export const DEFAULT_SETTINGS: ICalendarSettings = {
    defaultView: 'week',
    defaultGroup: 'priority',
    taskDensity: 'standard',
    priorityWeights: { 5: 1, 4: 1, 3: 1, 2: 1, 1: 1, 0: 1 }
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
        
            new Setting(containerEl).setName("效能权重配置").setHeading();
            const prioLabels: Record<number, string> = { 5: '最高优先级 (🔺)', 4: '高优先级 (⏫)', 3: '中优先级 (🔼)', 2: '普通优先级', 1: '低优先级 (🔽)', 0: '最低优先级 (⏬)' };
            
            [5, 4, 3, 2, 1, 0].forEach(level => {
                new Setting(containerEl)
                    .setName(prioLabels[level] ?? '未知优先级')
                    .setDesc(`计算进度条时，该优先级任务代表的权重分值`)
                    .addText(text => text
                        .setValue(String(this.plugin.settings.priorityWeights[level] ?? 1))
                        .onChange(async (value) => {
                            const num = parseFloat(value);
                            if (!isNaN(num) && num > 0) {
                                this.plugin.settings.priorityWeights[level] = num;
                                await this.plugin.saveSettings();
                            }
                        })
                    );
            });
    }
}