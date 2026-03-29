import * as React from 'react';
import { useState, useMemo, useEffect } from 'react';
import type { TaskItem } from './main';
import type ICalendarPlugin from './main';

// 🌟 修复：定义严格的鸭子类型接口，彻底拒绝 any
interface FallbackNotice {
    messageEl: HTMLElement;
    hide: () => void;
}

interface ObsidianModule {
    Notice: new (msg: string, duration?: number) => FallbackNotice;
}

const getObsidian = (): ObsidianModule | undefined => {
    if (typeof window === 'undefined') return undefined;
    const globalWin = window as unknown as { require?: (module: string) => unknown };
    if (typeof globalWin.require !== 'function') return undefined;
    try {
        return globalWin.require('obsidian') as ObsidianModule;
    } catch (_) {
        return undefined; // 消除 e 未使用的报错
    }
};

const createNotice = (msg: string, duration?: number): FallbackNotice => {
    const obs = getObsidian();
    if (obs && typeof obs.Notice === 'function') {
        return new obs.Notice(msg, duration);
    }
    // 非 Obsidian 环境降级，移除 console.log 避开 no-console 报错
    const fallbackEl = document.createElement('div');
    return { messageEl: fallbackEl, hide: () => {} };
};

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

    // 🌟 新增：收纳箱相关状态
    const [quickAddText, setQuickAddText] = useState('');
    const [isAddingTask, setIsAddingTask] = useState(false);
    const [showInbox, setShowInbox] = useState(false);

    useEffect(() => {
        let isMounted = true;
        const loadData = async () => {
            try {
                const data = await plugin.fetchTasksFromDataview(); 
                if (isMounted) setTasks(data);
            } catch (err) {
                console.error("iCalendar 数据加载异常:", err);
            } finally {
                if (isMounted) setIsLoading(false);
            }
        };

        const initEngine = () => {
            const dv = plugin.getDataviewAPI();
            if (dv) void loadData(); 
            else window.setTimeout(() => { void loadData(); }, 1500);
        };

        initEngine();

        const refreshUI = async () => {
            const data = await plugin.getTasksFromCache(); 
            if (isMounted) setTasks(data);
        };

        const cache = plugin.app.metadataCache as unknown as DataviewMetadataCache;
        const eventRef = cache.on('dataview:metadata-change', (op, file) => {
            const dv = plugin.getDataviewAPI();
            if (!dv) return;
            
            // 🌟 修复：严谨的类型守卫 (Type Guard)，替代暴力的 (file as any).path
            if (!file || typeof file !== 'object') return;
            const fileObj = file as Record<string, unknown>;
            if (typeof fileObj.path !== 'string') return;
            
            const page = dv.page(fileObj.path);
            if (page) {
                plugin.updateFileCache(page);
                void refreshUI();
            }
        });

        void refreshUI(); 

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

    // 🌟 核心分流：分离收纳箱任务与日历任务
    // 收纳箱任务：路径匹配设置，且完全没有分配日期的 todo 任务
    const inboxTasks = useMemo(() => {
        const inboxPath = plugin.settings.inboxFilePath.endsWith('.md') 
            ? plugin.settings.inboxFilePath 
            : `${plugin.settings.inboxFilePath}.md`;
        return sortedTasks.filter(t => t.path === inboxPath && !t.date && t.type === 'todo');
    }, [sortedTasks, plugin.settings.inboxFilePath]);

    // 日历任务：排除了纯收纳箱任务的其余任务
    const calendarTasks = useMemo(() => {
        const inboxPath = plugin.settings.inboxFilePath.endsWith('.md') 
            ? plugin.settings.inboxFilePath 
            : `${plugin.settings.inboxFilePath}.md`;
        return sortedTasks.filter(t => !(t.path === inboxPath && !t.date));
    }, [sortedTasks, plugin.settings.inboxFilePath]);

    const allVisibleTasksTags = useMemo(() => {
        const startOfView = currentDate.clone().startOf(viewMode);
        const endOfView = currentDate.clone().endOf(viewMode);
        
        const currentViewTasks = calendarTasks.filter(t => 
            t.date && window.moment(t.date).isBetween(startOfView, endOfView, 'day', '[]')
        );
        
        const tagCountMap: Record<string, number> = {};
        currentViewTasks.forEach(t => {
            (t.tags || []).forEach(tag => {
                tagCountMap[tag] = (tagCountMap[tag] || 0) + 1;
            });
        });
        return Object.entries(tagCountMap).sort((a, b) => b[1] - a[1]); 
    }, [calendarTasks, currentDate, viewMode]);

    const memoizedFilteredTasks = useMemo(() => {
        return calendarTasks.filter(t => {
            if (!showCompleted && t.type === 'done') return false;
            
            if (filterEnabled && selectedTags.length > 0) {
                const taskTags = t.tags || [];
                if (filterType === 'any') {
                    if (!selectedTags.some(tag => taskTags.includes(tag))) return false;
                } else if (filterType === 'all') {
                    if (!selectedTags.every(tag => taskTags.includes(tag))) return false;
                } else if (filterType === 'none') {
                    if (selectedTags.some(tag => taskTags.includes(tag))) return false;
                }
            }
            return true;
        });
    }, [calendarTasks, showCompleted, filterEnabled, selectedTags, filterType]);

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

    // 🌟 新增：处理快速输入回车
    const handleQuickAdd = async () => {
        const text = quickAddText.trim();
        if (!text) return;
        setIsAddingTask(true);
        try {
            await plugin.appendTaskToInbox(text);
            setQuickAddText(''); // 清空输入框，Dataview的元数据监听会接管后续更新
            createNotice("✅ 已存入收纳箱");
        } catch (e) {
            console.error("添加任务失败:", e);
            createNotice("添加失败，请检查收纳箱文件路径是否有效");
        } finally {
            setIsAddingTask(false);
        }
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
            const draggedTask = JSON.parse(data) as unknown as TaskItem;
            const originalTaskState = { ...draggedTask };

            if (newPrio === 'done') {
                if (draggedTask.type === 'todo') {
                    setTasks(prev => prev.map(t => (t.path === draggedTask.path && t.line === draggedTask.line) ? { ...t, type: 'done' } : t));
                    await plugin.toggleTask(draggedTask);
                    showUndoNotice("任务已完成", originalTaskState);
                }
                return;
            }

            if (typeof newPrio === 'number' && draggedTask.type === 'done') {
                setTasks(prev => prev.map(t => (t.path === draggedTask.path && t.line === draggedTask.line) ? { ...t, type: 'todo', priority: newPrio } : t));
                await plugin.toggleTask(draggedTask); 
                await plugin.updateTaskMetadata(draggedTask, newDate, newPrio);
                return;
            }

            // 此处：无论是原生日历任务，还是从收纳箱拖出来的无日期任务，只要追加了日期属性，
            // 就会自动触发过滤逻辑的重置，从收纳箱进入日历流。物理行号无需位移，确保安全。
            setTasks(prev => prev.map(t => (t.path === draggedTask.path && t.line === draggedTask.line) 
                ? { ...t, date: newDate || t.date, priority: typeof newPrio === 'number' ? newPrio : t.priority } 
                : t));
            await plugin.updateTaskMetadata(draggedTask, newDate, newPrio);
            showUndoNotice("任务已更新", originalTaskState);

        } catch (err) {
            console.error("Drop sync failed:", err);
        }
    };

    const showUndoNotice = (message: string, originalState: TaskItem) => {
        const notice = createNotice("", 5000); 
        const container = notice.messageEl;
        
        // 🌟 修复：全面使用 Web 标准 DOM API，不再依赖 Obsidian 的 createEl 扩展
        // 完美规避了 no-inner-html 和 no-unsafe-member-access 报错
        if (typeof container.replaceChildren === 'function') {
            container.replaceChildren();
        } else {
            while (container.firstChild) container.removeChild(container.firstChild);
        }
        
        const textSpan = document.createElement('span');
        textSpan.textContent = `${message} `;
        container.appendChild(textSpan);

        const undoBtn = document.createElement('a');
        undoBtn.textContent = "撤销";
        undoBtn.className = "icalendar-undo-link";
        undoBtn.onclick = async () => {
            setTasks(prev => prev.map(t => (t.path === originalState.path && t.line === originalState.line) ? originalState : t));
            await plugin.revertTask(originalState);
            notice.hide();
            createNotice("已撤销修改");
        };
        
        container.appendChild(undoBtn);
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

        const groups: Record<string, TaskItem[]> = {};
        dayTasks.forEach(t => {
            let key: string;
            if (groupMode === 'priority') {
                key = t.type === 'done' ? 'done' : String(t.priority);
            } else {
                key = t.fileName;
            }

            if (!groups[key]) groups[key] = [];
            groups[key]?.push(t);
        });

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
                                void handleDrop(e, dateStr, isDoneGroup ? 'done' : (groupMode === 'priority' ? Number(key) : null)); 
                            }}
                        >
                            <div className="file-group-header">{headerText}</div>
                            
                            {groupTasks.map((t, idx) => (
                                <div 
                                    key={`${t.path}-${t.line}-${idx}`} 
                                    className={`ios-task-item ${t.type === 'done' ? 'checked' : ''}`} 
                                    draggable 
                                    onDragStart={e => handleDragStart(e, t)} 
                                    onDragEnd={handleDragEnd}
                                >
                                    <div 
                                        className={`ios-checkbox ${t.type === 'done' ? 'checked' : 'unchecked'}`} 
                                        onClick={(e) => { e.stopPropagation(); void handleCheckboxClick(t); }}
                                    >✓</div>
                                    <div className="task-content-wrapper">
                                        <a className="internal-link-wrapper internal-link" data-href={t.path} href={t.path}>
                                            <div className="task-text" style={{textDecoration: t.type === 'done' ? 'line-through' : 'none'}}>
                                                {!isDoneGroup && groupMode !== 'priority' && PRIORITY_MAP[t.priority]?.icon && `${PRIORITY_MAP[t.priority]?.icon} `}
                                                {t.content}
                                            </div>
                                        </a>
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
        
        const weekTasks = calendarTasks.filter(t => t.date && window.moment(t.date).isBetween(startOfWeek, endOfWeek, 'day', '[]'));
        const { percent, doneCount, totalCount, doneWeight, totalWeight } = calculateWeightedProgress(weekTasks);
        const emoji = getPerformanceEmoji(percent);

        return (
            <div className="weekly-insights">
                <div className="insights-header">
                    <div className="insights-title">📊 本周整体效能追踪</div>
                    <div className="insights-stats">
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

            const dTasksKPI = calendarTasks.filter(t => t.date === dateStr);
            const { percent: dPercent, doneCount: dDone, totalCount: dTotal } = calculateWeightedProgress(dTasksKPI);

            const dTasksFiltered = memoizedFilteredTasks.filter(t => t.date === dateStr);

            const groups: Record<string, TaskItem[]> = {};
            dTasksFiltered.forEach(t => {
                const key = (groupMode === 'priority' && t.type === 'done') ? 'done' : (groupMode === 'priority' ? String(t.priority) : t.fileName);
                if (!groups[key]) groups[key] = [];
                groups[key]?.push(t);
            });

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
                                                <div 
                                                    style={{position: 'absolute', left: '-6px', top: '8px', cursor: 'pointer', zIndex: 10}}
                                                    onClick={(e) => { e.stopPropagation(); void handleCheckboxClick(t); }}
                                                ></div>
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

        const monthTasks = calendarTasks.filter(t => t.date && window.moment(t.date).isSame(currentDate, 'month'));
        
        const dailyWeights = Array.from({length: daysInMonth}, (_, i) => {
            const dateStr = startOfMonth.clone().add(i, 'days').format('YYYY-MM-DD');
            const dTasks = monthTasks.filter(t => t.date === dateStr);
            return dTasks.filter(t => t.type === 'done').reduce((acc, t) => acc + (plugin.settings.priorityWeights[t.priority] ?? 1), 0);
        });

        const maxDailyWeight = dailyWeights.length > 0 ? Math.max(...dailyWeights, 1) : 1;

        const cells = [];
        for (let i = 0; i < startDay; i++) cells.push(<div key={`spacer-${i}`} className="calendar-cell spacer" />);

        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = currentDate.clone().date(day).format('YYYY-MM-DD');
            const dayTasks = monthTasks.filter(t => t.date === dateStr); 
            const taskCount = dayTasks.length;
            
            const doneWeight = dayTasks.filter(t => t.type === 'done').reduce((acc, t) => acc + (plugin.settings.priorityWeights[t.priority] ?? 1), 0);
            const normalizedWeight = Math.min(1, doneWeight / maxDailyWeight);
            
            let cellStyle: React.CSSProperties = {};
            let isDarkBg = false;
            
            if (doneWeight > 0) {
                const alpha = Math.max(0.15, normalizedWeight); 
                cellStyle.backgroundColor = `rgba(106, 142, 174, ${alpha})`;
                cellStyle.borderColor = 'transparent'; 
                
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

        return (
            <div className="month-layout-wrapper">
                <div className="month-sidebar">
                    <div className="calendar-grid">
                        {['日', '一', '二', '三', '四', '五', '六'].map(d => (<div key={d} className="calendar-day-header">{d}</div>))}
                        {cells}
                    </div>
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

    return (
        <div className={`task-dashboard-container ${densityClass}`}>
            
            {/* 🌟 悬浮收纳箱侧栏 */}
            <div className={`inbox-drawer ${showInbox ? 'open' : ''}`}>
                <div className="inbox-drawer-header">
                    <h3>📥 收纳箱</h3>
                    <button className="inbox-close-btn" onClick={() => setShowInbox(false)}>✖</button>
                </div>
                <div className="inbox-drawer-content">
                    {inboxTasks.length === 0 ? (
                        <div className="inbox-empty-state">目前没有待处理任务</div>
                    ) : (
                        inboxTasks.map((t, idx) => (
                            <div 
                                key={`inbox-${idx}`} 
                                className="mini-task accent-type-1" 
                                draggable 
                                onDragStart={e => handleDragStart(e, t)} 
                                onDragEnd={handleDragEnd}
                            >
                                <a className="internal-link-wrapper internal-link" data-href={t.path} href={t.path}>
                                    <div className="mini-task-content">
                                        {PRIORITY_MAP[t.priority]?.icon && `${PRIORITY_MAP[t.priority]?.icon} `}{t.content}
                                    </div>
                                </a>
                                <div className="tag-container" style={{marginTop: '2px'}}>
                                    {t.tags.map((tag, i) => <div key={i} className="task-tag">{tag}</div>)}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            <div className="fixed-top-area">
                
                {/* 🌟 新增：全局快速输入框 */}
                <div className="quick-add-bar">
                    <input 
                        className="quick-add-input"
                        type="text" 
                        placeholder="✨ 回车存入收纳箱... 拖拽分配至日历"
                        value={quickAddText}
                        onChange={e => setQuickAddText(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter' && !isAddingTask) void handleQuickAdd();
                        }}
                        disabled={isAddingTask}
                    />
                    <button className={`nav-btn inbox-toggle-btn ${showInbox ? 'active' : ''}`} onClick={() => setShowInbox(!showInbox)}>
                        📥 收纳箱 <span className="inbox-badge">{inboxTasks.length}</span>
                    </button>
                </div>

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
                        <div className="header-controls" style={{marginRight: '8px'}}>
                            <button className={`nav-btn ${!showCompleted ? 'active' : ''}`} onClick={() => setShowCompleted(!showCompleted)}>
                                {showCompleted ? '👁️ 隐已完成' : '🙈 显已完成'}
                            </button>
                            <button className={`nav-btn ${filterEnabled ? 'active' : ''}`} onClick={() => setFilterEnabled(!filterEnabled)}>
                                {filterEnabled ? '👁️ 正在筛选标签' : '🙈 开启标签筛选'}
                            </button>
                        </div>

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

                {viewMode !== 'month' && renderDock()}
            </div>

            <div className="view-content-area">
                {viewMode === 'day' && (
                    <div className="day-view-scrollable">
                        <div style={{ fontSize: '1.4em', fontWeight: 800, marginBottom: '16px', paddingLeft: '4px', color: 'var(--text-primary)' }}>{currentDate.format('MM.DD dddd')}</div>
                        {renderDailyList(currentDate.format('YYYY-MM-DD'))}
                    </div>
                )}
                
                {viewMode === 'week' && renderWeekCols()}
                {viewMode === 'month' && renderMonthView()}
            </div>
            
        </div>
    );
};