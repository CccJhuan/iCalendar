import * as React from 'react';
import { useState, useMemo, useEffect } from 'react';
// 🌟 修复：必须显式导入 TFile，否则 TS 会将其误认为 DOM 的 File
import { TFile, Notice } from 'obsidian';
import type { TaskItem } from './main';
import type ICalendarPlugin from './main';

interface DashboardProps {
    plugin: ICalendarPlugin;
}
type DataviewMetadataCache = {
    on(name: string, callback: (...args: unknown[]) => void): unknown;
    offref(ref: unknown): void;
};

const PRIORITY_MAP: Record<number, { label: string, classId: number, icon: string }> = {
    5: { label: '最高', classId: 5, icon: '🔺' },
    4: { label: '高', classId: 4, icon: '⏫' },
    3: { label: '中', classId: 3, icon: '🔼' },
    2: { label: '普通', classId: 2, icon: '' },
    1: { label: '低', classId: 1, icon: '🔽' },
    0: { label: '最低', classId: 0, icon: '⏬' }
};

export const Dashboard: React.FC<DashboardProps> = ({ plugin }) => {
    const [viewMode, setViewMode] = useState<'month' | 'week' | 'day'>(plugin.settings.defaultView);
    const [groupMode, setGroupMode] = useState<'file' | 'priority'>(plugin.settings.defaultGroup);
    const [currentDate, setCurrentDate] = useState(window.moment());
    
    const [tasks, setTasks] = useState<TaskItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const densityClass = `density-${plugin.settings.taskDensity}`;

    const [showCompleted, setShowCompleted] = useState(true);
    const [filterEnabled, setFilterEnabled] = useState(false);
    const [selectedTags, setSelectedTags] = useState<string[]>([]); 
    const [filterType, setFilterType] = useState<'any' | 'none' | 'all'>('any');


    useEffect(() => {
        let isMounted = true;
        const loadData = async () => {
            try {
                // 根据你目前使用的架构获取数据
                // (如果你没改架构，就是 fetchTasksFromDataview；如果改了就是 getTasksFromCache)
                const data = await plugin.fetchTasksFromDataview(); 
                if (isMounted) {
                    setTasks(data);
                }
            } catch (err) {
                console.error("iCalendar 数据加载异常:", err);
            } finally {
                // 🌟 核心修复：无论成功还是失败，强制切断加载状态
                if (isMounted) {
                    setIsLoading(false);
                }
            }
        };
        // 🌟 核心修复：处理 Obsidian 启动时 Dataview 加载的时差问题
        const initEngine = () => {
            const dv = plugin.getDataviewAPI();
            if (dv) {
                void loadData(); // Dataview 已就绪，直接加载
            } else {
                // Dataview 未就绪，给予 1.5 秒的缓冲时间后强制执行
                // 即使最后没取到 dv，finally 也会确保页面显示“无任务”而不是无限加载
                window.setTimeout(() => {
                    void loadData();
                }, 1500);
            }
        };

        initEngine();

        const refreshUI = async () => {
            const data = await plugin.getTasksFromCache(); // 从 Map 展平，O(n) 操作
            if (isMounted) setTasks(data);
        };
        const cache = plugin.app.metadataCache as unknown as DataviewMetadataCache;
        // 🌟 增量监听：Dataview 告诉我们哪个文件变了
        const eventRef =cache.on('dataview:metadata-change', (op, file) => {
            const dv = plugin.getDataviewAPI();
            if (!dv) return;
            if (!(file instanceof TFile)) {
                return;
            }
            const page = dv.page(file.path);
            if (page) {
                plugin.updateFileCache(page);
                void refreshUI();
            }
        });

        void refreshUI(); // 初始加载

        return () => {
            isMounted = false;
            cache.offref(eventRef);
        };
    }, [plugin]);

    const sortedTasks = useMemo(() => {
        return [...tasks].sort((a, b) => {
            if (a.type !== b.type) return a.type === 'done' ? 1 : -1;
            if (a.priority !== b.priority) return b.priority - a.priority;
            return a.fileName.localeCompare(b.fileName);
        });
    }, [tasks]);
    const allVisibleTasksTags = useMemo(() => {
        const startOfView = currentDate.clone().startOf(viewMode);
        const endOfView = currentDate.clone().endOf(viewMode);
        
        const currentViewTasks = sortedTasks.filter(t => 
            t.date && window.moment(t.date).isBetween(startOfView, endOfView, 'day', '[]')
        );
        
        const tagCountMap: Record<string, number> = {};
        currentViewTasks.forEach(t => {
            (t.tags || []).forEach(tag => {
                tagCountMap[tag] = (tagCountMap[tag] || 0) + 1;
            });
        });
        return Object.entries(tagCountMap).sort((a, b) => b[1] - a[1]); 
    }, [sortedTasks, currentDate, viewMode]);

    // --- 🌟 核心引擎：超級过滤管道仅用于 UI 列表渲染 ---
    const memoizedFilteredTasks = useMemo(() => {
        return sortedTasks.filter(t => {
            // 1. 已完成任务过滤 (保持现有逻辑)
            if (!showCompleted && t.type === 'done') return false;
            
            // 2. 🌟 标签筛选 (多选逻辑优化)
            if (filterEnabled && selectedTags.length > 0) {
                const taskTags = t.tags || [];
                
                if (filterType === 'any') {
                    // has ANY of: 任务包含选中标签中的任意一个
                    if (!selectedTags.some(tag => taskTags.includes(tag))) return false;
                } else if (filterType === 'all') {
                    // has ALL of (参考参考图B): 任务必须包含所有选中的标签
                    if (!selectedTags.every(tag => taskTags.includes(tag))) return false;
                } else if (filterType === 'none') {
                    // has NONE of: 任务不能包含选中标签中的任何一个
                    if (selectedTags.some(tag => taskTags.includes(tag))) return false;
                }
            }
            return true;
        });
    }, [sortedTasks, showCompleted, filterEnabled, selectedTags, filterType]);


    // 🌟 核心引擎 2：权重计算器抽离
    // 传入任务数组，返回基于权重的完成率百分比
    const calculateWeightedProgress = (targetTasks: TaskItem[]) => {
        const totalWeight = targetTasks.reduce((acc, t) => acc + (plugin.settings.priorityWeights[t.priority] ?? 1), 0);
        if (totalWeight === 0) return { totalWeight, doneWeight: 0, percent: 0, doneCount: 0, totalCount: 0 };
        
        const doneTasks = targetTasks.filter(t => t.type === 'done');
        const doneWeight = doneTasks.reduce((acc, t) => acc + (plugin.settings.priorityWeights[t.priority] ?? 1), 0);
        
        return {
            totalWeight,
            doneWeight,
            percent: Math.round((doneWeight / totalWeight) * 100),
            doneCount: doneTasks.length,
            totalCount: targetTasks.length
        };
    };


    const handleDragStart = (e: React.DragEvent<HTMLDivElement>, task: TaskItem) => {
        e.dataTransfer.setData('application/json', JSON.stringify(task));
        e.dataTransfer.effectAllowed = 'move';
        (e.currentTarget as HTMLElement).addClass('dragging');
    };

    const handleDragEnd = (e: React.DragEvent<HTMLDivElement>) => {
        (e.currentTarget as HTMLElement).removeClass('dragging');
    };

    const handleDrop = async (e: React.DragEvent<HTMLDivElement>, newDate: string | null, newPrio: number | string | null) => {
        e.preventDefault();
        const data = e.dataTransfer.getData('application/json');
        if (!data) return;
        try {
            // 🌟 核心修复 2：使用 unknown 安全过渡 JSON.parse 的隐式 any 返回值
            const draggedTask = JSON.parse(data) as unknown as TaskItem;
            const originalTaskState = { ...draggedTask };
            // --- 场景 1: 拖入“已完成”分组 ---
            if (newPrio === 'done') {
                if (draggedTask.type === 'todo') {
                    setTasks(prev => prev.map(t => (t.path === draggedTask.path && t.line === draggedTask.line) ? { ...t, type: 'done' } : t));
                    await plugin.toggleTask(draggedTask);
                    showUndoNotice("任务已完成", originalTaskState);
                }
                return;
            }

            // --- 场景 2: 将“已完成”任务拖回普通优先级（激活任务） ---
            if (typeof newPrio === 'number' && draggedTask.type === 'done') {
                // 1. 乐观更新 UI（状态转为 todo，优先级设为新值）
                setTasks(prev => prev.map(t => (t.path === draggedTask.path && t.line === draggedTask.line) ? { ...t, type: 'todo', priority: newPrio } : t));
                // 2. 写入文件：先取消复选框
                await plugin.toggleTask(draggedTask); 
                // 3. 写入文件：更新优先级图标 [🌟 关键位置 A]
                await plugin.updateTaskMetadata(draggedTask, newDate, newPrio);
                return; // 场景 2 结束
            }

            // --- 场景 3: 标准元数据修改（修改日期或修改优先级） ---
            // 1. 乐观更新 UI

            // 2. 写入文件同步 [🌟 关键位置 B]
            // 这里会处理正向的日期变更或优先级图标替换
            // 修改日期或优先级场景
            setTasks(prev => prev.map(t => (t.path === draggedTask.path && t.line === draggedTask.line) 
                ? { ...t, date: newDate || t.date, priority: typeof newPrio === 'number' ? newPrio : t.priority } 
                : t));
            await plugin.updateTaskMetadata(draggedTask, newDate, newPrio);
            showUndoNotice("任务已更新", originalTaskState);

        } catch (err) {
            console.error("Drop sync failed:", err);
        }
        
    };
    // 🌟 核心：显示带撤销按钮的通知
    const showUndoNotice = (message: string, originalState: TaskItem) => {
        const notice = new Notice("", 5000); // 5秒消失
        const container = notice.messageEl;
        container.empty();
        
        container.createEl('span', { text: `${message} ` });
        const undoBtn = container.createEl('a', { 
            text: "撤销", 
            cls: "icalendar-undo-link" // 可以在 CSS 中定义样式
        });

        undoBtn.onclick = async () => {
            // 1. UI 回滚
            setTasks(prev => prev.map(t => (t.path === originalState.path && t.line === originalState.line) ? originalState : t));
            
            // 2. 文件回滚：根据原始状态重新写入
            // 注意：这里需要根据 originalState 的 type 和 priority 还原
            await plugin.revertTask(originalState);
            
            notice.hide();
            new Notice("已撤销修改");
        };
    };
    const handleCheckboxClick = async (task: TaskItem) => {
        setTasks(prev => prev.map(t => {
            if(t.path === task.path && t.line === task.line) {
                return { ...t, type: t.type === 'todo' ? 'done' : 'todo' };
            }
            return t;
        }));
        await plugin.toggleTask(task);
    };

    const getPerformanceEmoji = (percent: number) => {
        if (percent === 0) return '😴';
        if (percent <= 20) return '🥱';
        if (percent <= 40) return '🚶';
        if (percent <= 60) return '🏃';
        if (percent <= 80) return '🔥';
        return '👑';
    };

    const renderDock = () => (
        <div className="priority-dock">
            <div className="dock-label">🎯 拖入修改优先：</div>
            {[5, 4, 3, 2, 1, 0].map(level => {
                const prioInfo = PRIORITY_MAP[level];
                if (!prioInfo) return null;
                return (
                    <div 
                        key={level} className="dock-item"
                        style={{ color: `var(--priority-${level > 3 ? 'high' : (level === 3 ? 'med' : (level === 2 ? 'primary' : 'low'))})` }}
                        onDragOver={e => { e.preventDefault(); (e.currentTarget as HTMLElement).addClass('drag-over'); }}
                        onDragLeave={e => (e.currentTarget as HTMLElement).removeClass('drag-over')}
                        onDrop={e => { (e.currentTarget as HTMLElement).removeClass('drag-over'); void handleDrop(e, null, level); }}
                    >
                        {prioInfo.icon && <span>{prioInfo.icon}</span>}
                        <span>{prioInfo.label}</span>
                    </div>
                );
            })}
        </div>
    );

    const renderDailyList = (dateStr: string) => {
        const dayTasks = memoizedFilteredTasks.filter(t => t.date === dateStr);
        if (dayTasks.length === 0) return <div style={{textAlign: 'center', color: 'var(--text-sub)', padding: '40px', width: '100%'}}>☕️ 此日无计划任务</div>;

        // --- 1. 重新定义分组逻辑 ---
        const groups: Record<string, TaskItem[]> = {};
        dayTasks.forEach(t => {
            // 🌟 核心修改：在“优先”模式下，完成的任务强制归入 'done' 分组
            let key: string;
            if (groupMode === 'priority') {
                key = t.type === 'done' ? 'done' : String(t.priority);
            } else {
                key = t.fileName;
            }

            if (!groups[key]) groups[key] = [];
            groups[key]?.push(t);
        });

        // --- 2. 重新定义排序逻辑 ---
        const groupKeys = Object.keys(groups).sort((a, b) => {
            if (groupMode === 'priority') {
                if (a === 'done') return 1;
                if (b === 'done') return -1;
                return Number(b) - Number(a);
            }
            return a.localeCompare(b);
        });

        return (
            <div className="file-groups-container">
                {groupKeys.map(key => {
                    const groupTasks = groups[key] || [];
                    const firstTask = groupTasks[0];
                    if (!firstTask) return null;

                    // 1. 动态样式与头部文本计算
                    const isDoneGroup = key === 'done';
                    const cardClass = groupMode === 'priority' 
                        ? (isDoneGroup ? 'prio-group-done' : `prio-group-${key}`) 
                        : `group-type-${firstTask.colorIndex}`;
                    
                    const headerText = groupMode === 'priority' 
                        ? (isDoneGroup ? '✅ 已完成' : (PRIORITY_MAP[Number(key)]?.label || key)) 
                        : key;

                    return (
                        <div 
                            key={key} 
                            className={`file-group-card ${cardClass}`}
                            onDragOver={e => { e.preventDefault(); (e.currentTarget as HTMLElement).addClass('drop-zone-active'); }}
                            onDragLeave={e => (e.currentTarget as HTMLElement).removeClass('drop-zone-active')}
                            onDrop={e => { 
                                (e.currentTarget as HTMLElement).removeClass('drop-zone-active'); 
                                // 拖拽放下时，传递当前日期和新的优先级（或 'done' 状态）
                                void handleDrop(e, dateStr, isDoneGroup ? 'done' : (groupMode === 'priority' ? Number(key) : null)); 
                            }}
                        >
                            <div className="file-group-header">{headerText}</div>
                            
                            {/* 2. 遍历渲染该分组下的每一个具体任务 */}
                            {groupTasks.map((t, idx) => (
                                <div 
                                    key={`${t.path}-${t.line}-${idx}`} 
                                    className={`ios-task-item ${t.type === 'done' ? 'checked' : ''}`} 
                                    draggable 
                                    onDragStart={e => handleDragStart(e, t)} 
                                    onDragEnd={handleDragEnd}
                                >
                                    {/* 🌟 独立的复选框点击热区 */}
                                    <div 
                                        className={`ios-checkbox ${t.type === 'done' ? 'checked' : 'unchecked'}`} 
                                        onClick={(e) => { e.stopPropagation(); void handleCheckboxClick(t); }}
                                    >
                                        ✓
                                    </div>
                                    
                                    <div className="task-content-wrapper">
                                        {/* 任务文本与链接 */}
                                        <a className="internal-link-wrapper internal-link" data-href={t.path} href={t.path}>
                                            <div className="task-text" style={{textDecoration: t.type === 'done' ? 'line-through' : 'none'}}>
                                                {/* 如果不是优先模式或已完成组，显示优先级图标 */}
                                                {!isDoneGroup && groupMode !== 'priority' && PRIORITY_MAP[t.priority]?.icon && `${PRIORITY_MAP[t.priority]?.icon} `}
                                                {t.content}
                                            </div>
                                        </a>
                                        
                                        {/* 任务标签信息 */}
                                        <div className="tag-container">
                                            {(groupMode === 'priority' || isDoneGroup) && <div className="task-tag file-tag">{t.fileName}</div>}
                                            {t.tags.map((tag, i) => <div key={i} className="task-tag">{tag}</div>)}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    );
                })}
            </div>
        );
    };

    const renderWeeklyInsights = () => {
        const startOfWeek = currentDate.clone().startOf('week');
        const endOfWeek = currentDate.clone().endOf('week');
        
        const weekTasks = sortedTasks.filter(t => t.date && window.moment(t.date).isBetween(startOfWeek, endOfWeek, 'day', '[]'));
        const { percent, doneCount, totalCount, doneWeight, totalWeight } = calculateWeightedProgress(weekTasks);
        const emoji = getPerformanceEmoji(percent);

        return (
            <div className="weekly-insights">
                <div className="insights-header">
                    <div className="insights-title">📊 本周整体效能追踪</div>
                    <div className="insights-stats">
                        {/* 视觉上展示进度百分比，附带权重分数提示 */}
                        {percent}% <span title={`权重得分: ${doneWeight} / ${totalWeight}`}>({doneCount}/{totalCount}件)</span> 
                        <span className="insights-emoji">{emoji}</span>
                    </div>
                </div>
                <div className="progress-container">
                    <div className={`progress-fill ${percent === 100 ? 'complete' : ''}`} style={{ width: `${percent}%` }} />
                </div>
            </div>
        );
    };

    const renderWeekCols = () => {
        const startOfWeek = currentDate.clone().startOf('week');
        const cols = [];
        for (let i = 0; i < 7; i++) {
            const dayDate = startOfWeek.clone().add(i, 'days');
            const dateStr = dayDate.format('YYYY-MM-DD');
            const isToday = dateStr === window.moment().format('YYYY-MM-DD');
            const isPast = dayDate.isBefore(window.moment(), 'day');

            // 🌟 核心分流 1：KPI 数据流（不受标签筛选影响，使用 sortedTasks）
            const dTasksKPI = sortedTasks.filter(t => t.date === dateStr);
            const { percent: dPercent, doneCount: dDone, totalCount: dTotal } = calculateWeightedProgress(dTasksKPI);

            // 🌟 核心分流 2：UI 渲染流（受标签筛选影响，使用 memoizedFilteredTasks）
            const dTasksFiltered = memoizedFilteredTasks.filter(t => t.date === dateStr);

            const groups: Record<string, TaskItem[]> = {};
            dTasksFiltered.forEach(t => {
                const key = (groupMode === 'priority' && t.type === 'done') ? 'done' : (groupMode === 'priority' ? String(t.priority) : t.fileName);
                if (!groups[key]) groups[key] = [];
                groups[key]?.push(t);
            });

            // 🌟 确保 groupKeys 存在
            const groupKeys = Object.keys(groups).sort((a, b) => {
                if (groupMode === 'priority') {
                    if (a === 'done') return 1;
                    if (b === 'done') return -1;
                    return Number(b) - Number(a);
                }
                return a.localeCompare(b);
            });
            cols.push(
                <div 
                    key={dateStr} className={`week-col ${isToday ? 'today' : ''} ${isPast ? 'past' : ''}`}
                    onDragOver={e => { e.preventDefault(); (e.currentTarget as HTMLElement).addClass('drop-zone-active'); }}
                    onDragLeave={e => (e.currentTarget as HTMLElement).removeClass('drop-zone-active')}
                    onDrop={e => { (e.currentTarget as HTMLElement).removeClass('drop-zone-active'); void handleDrop(e, dateStr, null); }}
                >
                    <div className="week-col-header" onClick={() => { setCurrentDate(dayDate); setViewMode('day'); }}>
                        <div className="week-col-date-row">
                            <span>{dayDate.format('M.D ddd')}</span>
                            {/* 进度条使用 KPI 数据 */}
                            {dTotal > 0 && <span className="day-stats">{dDone}/{dTotal}</span>}
                        </div>
                        {dTotal > 0 && (
                            <div className="progress-container" style={{height: '4px', marginTop: '6px'}}>
                                <div className={`progress-fill ${dPercent === 100 ? 'complete' : ''}`} style={{width: `${dPercent}%`}} />
                            </div>
                        )}
                    </div>
                    
                    <div className="week-col-tasks">
                        {dTasksFiltered.length === 0 && <div style={{opacity: 0.3, textAlign:'center', marginTop:'10px', fontSize:'0.8em'}}>无任务</div>}
                        
                        {/* 🌟 遍历 groupKeys 渲染 UI 列表 */}
                        {groupKeys.map(key => {
                            const groupTasks = groups[key] || [];
                            const isDoneGroup = key === 'done';
                            const headerText = groupMode === 'priority' ? (isDoneGroup ? '✅ 已完成' : PRIORITY_MAP[Number(key)]?.label) : key;
                            
                            return (
                                <div key={key} className={`week-file-group ${isDoneGroup ? 'prio-group-done' : ''}`}>
                                    <div className="week-file-header">{headerText}</div>
                                    {groupTasks.map((t, idx) => {
                                        const cardBorderClass = groupMode === 'priority' 
                                            ? (isDoneGroup ? 'prio-group-done' : `priority-level-${t.priority}`) 
                                            : `accent-type-${t.colorIndex}`;
                                        
                                        return (
                                            <div key={`${t.path}-${t.line}-${idx}`} className={`mini-task ${t.type} ${cardBorderClass}`} draggable onDragStart={e => handleDragStart(e, t)} onDragEnd={handleDragEnd}>
                                                {/* 🌟 这里的点击事件触发 handleCheckboxClick */}
                                                <div 
                                                    style={{position: 'absolute', left: '-6px', top: '8px', cursor: 'pointer', zIndex: 10}}
                                                    onClick={(e) => { e.stopPropagation(); void handleCheckboxClick(t); }}
                                                >
                                                    {/* 如果周视图需要复选框可以放这里，如果不需要，通过双击或者右键调用，你原本的代码用的是 a 标签跳转，未提供显式 checkbox，如果你希望点击任务本身完成，可以绑定在 mini-task-content 上 */}
                                                </div>
                                                <a className="internal-link-wrapper internal-link" data-href={t.path} href={t.path}>
                                                    <div className="mini-task-content" style={{textDecoration: t.type === 'done' ? 'line-through' : 'none'}}>
                                                        {!isDoneGroup && groupMode !== 'priority' && PRIORITY_MAP[t.priority]?.icon && `${PRIORITY_MAP[t.priority]?.icon} `}{t.content}
                                                    </div>
                                                </a>
                                                <div className="tag-container" style={{marginTop: '2px'}}>
                                                    {(groupMode === 'priority' || isDoneGroup) && <div className="task-tag file-tag">{t.fileName}</div>}
                                                    {t.tags.map((tag, i) => <div key={i} className="task-tag">{tag}</div>)}
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            );
                        })}
                    </div>
                </div>
            );
        }
        
        return (
            <div className="week-view-container">
                {renderWeeklyInsights()}
                <div className="week-view">{cols}</div>
            </div>
        );
    };

    const renderMonthView = () => {
        const startOfMonth = currentDate.clone().startOf('month');
        const daysInMonth = currentDate.daysInMonth();
        const startDay = startOfMonth.day(); 

        // 1. 获取该月内所有任务的数据池（注意使用 sortedTasks 而不是 filteredTasks）
        const monthTasks = sortedTasks.filter(t => t.date && window.moment(t.date).isSame(currentDate, 'month'));
        
        // 2. 计算该月内“每日完成权重得分”的数组，用于寻找当月峰值
        const dailyWeights = Array.from({length: daysInMonth}, (_, i) => {
            const dateStr = startOfMonth.clone().add(i, 'days').format('YYYY-MM-DD');
            const dTasks = monthTasks.filter(t => t.date === dateStr);
            return dTasks.filter(t => t.type === 'done').reduce((acc, t) => acc + (plugin.settings.priorityWeights[t.priority] ?? 1), 0);
        });

        // 3. 确立该月的最高得分（封顶值），最少为 1 以防除以 0
        const maxDailyWeight = dailyWeights.length > 0 ? Math.max(...dailyWeights, 1) : 1;

        const cells = [];
        // 填充月初空白格
        for (let i = 0; i < startDay; i++) cells.push(<div key={`spacer-${i}`} className="calendar-cell spacer" />);

        // 4. 生成包含动态色彩的真实日期格
        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = currentDate.clone().date(day).format('YYYY-MM-DD');
            // 注意这里渲染详情也要使用未被标签过滤的 monthTasks，如果你希望月视图点开的右侧受标签影响，这里可以换成 memoizedFilteredTasks
            const dayTasks = monthTasks.filter(t => t.date === dateStr); 
            const taskCount = dayTasks.length;
            
            // 计算当日得分
            const doneWeight = dayTasks.filter(t => t.type === 'done').reduce((acc, t) => acc + (plugin.settings.priorityWeights[t.priority] ?? 1), 0);
            
            // 归一化得分 (0.0 到 1.0)
            const normalizedWeight = Math.min(1, doneWeight / maxDailyWeight);
            
            // 计算动态背景色：使用你的主色调 --morandi-1 (RGB: 106, 142, 174)，根据权重调节透明度
            let cellStyle: React.CSSProperties = {};
            let isDarkBg = false;
            
            if (doneWeight > 0) {
                const alpha = Math.max(0.15, normalizedWeight); // 即使完成极少，也给个底色 0.15
                cellStyle.backgroundColor = `rgba(106, 142, 174, ${alpha})`;
                cellStyle.borderColor = 'transparent'; // 覆盖原有的灰边框
                
                // 如果颜色太深，文字变成白色保证可读性
                if (alpha > 0.6) {
                    cellStyle.color = 'white';
                    isDarkBg = true;
                }
            }

            cells.push(
                <div 
                    key={dateStr} 
                    className={`calendar-cell ${dateStr === currentDate.format('YYYY-MM-DD') ? 'selected' : ''}`} 
                    style={cellStyle}
                    title={`${dateStr}: 效能得分 ${doneWeight} / 共 ${taskCount} 件`}
                    onClick={() => setCurrentDate(window.moment(dateStr))}
                >
                    <div className="day-number" style={isDarkBg ? { color: 'white' } : {}}>{day}</div>
                    {taskCount > 0 && <div className="task-count-badge" style={isDarkBg ? { color: 'white', opacity: 1 } : {}}>{taskCount}</div>}
                </div>
            );
        }

        // 🌟 5. 完全保留你原有的返回值结构，仅更新图例
        return (
            <div className="month-layout-wrapper">
                <div className="month-sidebar">
                    <div className="calendar-grid">
                        {['日', '一', '二', '三', '四', '五', '六'].map(d => (<div key={d} className="calendar-day-header">{d}</div>))}
                        {cells}
                    </div>
                    {/* 更新底部图例以匹配新的渐变色体系 */}
                    <div className="heatmap-legend">
                        <span>少</span>
                        <div className="calendar-cell" style={{backgroundColor: 'rgba(106, 142, 174, 0.15)', borderColor: 'transparent'}}></div>
                        <div className="calendar-cell" style={{backgroundColor: 'rgba(106, 142, 174, 0.4)', borderColor: 'transparent'}}></div>
                        <div className="calendar-cell" style={{backgroundColor: 'rgba(106, 142, 174, 0.7)', borderColor: 'transparent'}}></div>
                        <div className="calendar-cell" style={{backgroundColor: 'rgba(106, 142, 174, 1.0)', borderColor: 'transparent'}}></div>
                        <span>多</span>
                    </div>
                </div>
                <div className="month-main-content">
                    {/* 右侧详情列表渲染 */}
                    {renderDailyList(currentDate.format('YYYY-MM-DD'))}
                </div>
            </div>
        );
    };

    if (isLoading) {
        return (
            <div className={`task-dashboard-container ${densityClass}`} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%', height: '100%' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <h2 style={{ color: 'var(--text-sub)', opacity: 0.7, margin: 0, textAlign: 'center' }}>🚀 引擎正在加载...</h2>
                    <div style={{ marginTop: '12px', color: 'var(--text-muted)', fontSize: '0.85em' }}>正在同步本地数据图谱</div>
                </div>
            </div>
        );
    }

    // 🌟 这是整个看板的全局 UI 框架
    return (
        <div className={`task-dashboard-container ${densityClass}`}>
            
            {/* === 1. 顶部固定控制区 === */}
            <div className="fixed-top-area">
                
                {/* 1.1 顶层导航 Header */}
                <div className="dashboard-header">
                    <div className="header-controls">
                        <button className="nav-btn" onClick={() => setCurrentDate(prev => prev.clone().subtract(1, viewMode === 'month' ? 'month' : (viewMode === 'week' ? 'week' : 'day')))}>❮</button>
                        <button className="nav-btn" onClick={() => setCurrentDate(prev => prev.clone().add(1, viewMode === 'month' ? 'month' : (viewMode === 'week' ? 'week' : 'day')))}>❯</button>
                        <button className="nav-btn" onClick={() => setCurrentDate(window.moment())}>今</button>
                        <div className="dashboard-title" style={{marginLeft:'12px'}}>
                            {viewMode === 'month' ? currentDate.format('YYYY.MM') : (viewMode === 'week' ? `${currentDate.clone().startOf('week').format('MM.DD')} - ${currentDate.clone().endOf('week').format('MM.DD')}` : currentDate.format('MM.DD dddd'))}
                        </div>
                    </div>
                    
                    <div className="right-controls">
                        {/* 筛选与显示控制 */}
                        <div className="header-controls" style={{marginRight: '8px'}}>
                            <button className={`nav-btn ${!showCompleted ? 'active' : ''}`} onClick={() => setShowCompleted(!showCompleted)}>
                                {showCompleted ? '👁️ 隐已完成' : '🙈 显已完成'}
                            </button>
                            <button className={`nav-btn ${filterEnabled ? 'active' : ''}`} onClick={() => setFilterEnabled(!filterEnabled)}>
                                {filterEnabled ? '👁️ 正在筛选标签' : '🙈 开启标签筛选'}
                            </button>
                        </div>

                        {/* 分组与视图切换 */}
                        {viewMode !== 'month' && (
                            <div className="group-switcher">
                                <button className={`group-btn ${groupMode === 'file' ? 'active' : ''}`} onClick={() => setGroupMode('file')}>📁 项目</button>
                                <button className={`group-btn ${groupMode === 'priority' ? 'active' : ''}`} onClick={() => setGroupMode('priority')}>🔥 优先</button>
                            </div>
                        )}
                        <div className="view-switcher">
                            <button className={`view-btn ${viewMode === 'month' ? 'active' : ''}`} onClick={() => setViewMode('month')}>月</button>
                            <button className={`view-btn ${viewMode === 'week' ? 'active' : ''}`} onClick={() => setViewMode('week')}>周</button>
                            <button className={`view-btn ${viewMode === 'day' ? 'active' : ''}`} onClick={() => setViewMode('day')}>日</button>
                        </div>
                    </div>
                </div>

                {/* 1.2 标签筛选展开面板 (Filter Panel) */}
                {filterEnabled && (
                    <div className="icalendar-filter-panel" style={{ padding: '12px', borderRadius: '8px', background: 'rgba(0,0,0,0.05)', border: '1px solid var(--ios-border)', marginTop: '8px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            <div style={{ fontSize: '0.9em', fontWeight: 'bold', color: 'var(--text-primary)' }}>标签筛选 (当前视图)</div>
                            
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '0.8em' }}>
                                <select 
                                    value={filterType} 
                                    onChange={e => setFilterType(e.target.value as 'any' | 'none' | 'all')}
                                    style={{ background: 'var(--background-primary)', border: '1px solid var(--ios-border)', borderRadius: '4px', padding: '2px 6px', color: 'var(--text-normal)' }}
                                >
                                    <option value="any">包含任意一个</option>
                                    <option value="all">必须包含所有</option>
                                    <option value="none">排除选中标签</option>
                                </select>
                                {selectedTags.length > 0 && <button className="icalendar-link-btn" onClick={() => setSelectedTags([])}>清除 ({selectedTags.length})</button>}
                            </div>
                        </div>

                        <div className="icalendar-tag-cloud" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', maxHeight: '120px', overflowY: 'auto' }}>
                            {allVisibleTasksTags.length === 0 && <div style={{ opacity: 0.5, fontSize: '0.9em', padding: '4px' }}>当前视图无标签。</div>}
                            {allVisibleTasksTags.map(([tag, count]) => {
                                const isSelected = selectedTags.includes(tag);
                                return (
                                    <div 
                                        key={tag} 
                                        className={`icalendar-tag-bubble ${isSelected ? 'active' : ''}`}
                                        onClick={() => setSelectedTags(prev => isSelected ? prev.filter(t => t !== tag) : [...prev, tag])}
                                        style={{
                                            cursor: 'pointer', padding: '4px 10px',
                                            background: isSelected ? 'var(--text-accent)' : 'var(--background-modifier-form-field)',
                                            color: isSelected ? 'white' : 'var(--text-sub)',
                                            borderRadius: '16px', fontSize: '0.85em', display: 'flex', alignItems: 'center', gap: '4px',
                                            border: isSelected ? 'none' : '1px solid transparent'
                                        }}
                                    >
                                        {isSelected && <span style={{marginRight: '2px'}}>✅</span>}
                                        {tag} <span style={{ opacity: 0.6, fontSize: '0.9em' }}>({count})</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* 1.3 拖拽 Dock */}
                {viewMode !== 'month' && renderDock()}
                
            </div>

            {/* === 2. 下方滚动数据视图区 === */}
            <div className="view-content-area">
                {viewMode === 'day' && (
                    <div className="day-view-scrollable">
                        <div style={{ fontSize: '1.4em', fontWeight: 800, marginBottom: '16px', paddingLeft: '4px', color: 'var(--text-primary)' }}>{currentDate.format('MM.DD dddd')}</div>
                        {/* 🌟 日视图内容在这里被调用 */}
                        {renderDailyList(currentDate.format('YYYY-MM-DD'))}
                    </div>
                )}
                
                {/* 🌟 周视图内容被调用 */}
                {viewMode === 'week' && renderWeekCols()}
                
                {/* 🌟 月视图内容被调用 */}
                {viewMode === 'month' && renderMonthView()}
            </div>
            
        </div>
    );
};