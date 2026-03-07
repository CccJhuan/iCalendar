import * as React from 'react';
import { useState, useMemo, useEffect } from 'react';
import { debounce } from 'obsidian';
import type { TaskItem } from './main';
import type ICalendarPlugin from './main';

interface DashboardProps {
    plugin: ICalendarPlugin;
}

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

    // 获取当前配置的密度类名
    const densityClass = `density-${plugin.settings.taskDensity}`;

    useEffect(() => {
        let isMounted = true;

        const loadData = async () => {
            setIsLoading(true);
            const data = await plugin.fetchTasksFromDataview();
            if (isMounted) {
                setTasks(data);
                setIsLoading(false);
            }
        };
        
        setTimeout(loadData, 300);

        const handleMetadataChange = async () => {
            if (!isMounted) return;
            const data = await plugin.fetchTasksFromDataview();
            setTasks(data);
        };
        
        let timeoutId: NodeJS.Timeout;
        const debouncedHandler = () => {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                handleMetadataChange();
            }, 1000);
        };
        
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const eventRef = plugin.app.metadataCache.on('dataview:metadata-change' as any, debouncedHandler);

        return () => {
            isMounted = false;
            clearTimeout(timeoutId);
            plugin.app.metadataCache.offref(eventRef);
        };
    }, [plugin]);

    const sortedTasks = useMemo(() => {
        return [...tasks].sort((a, b) => {
            if (a.type !== b.type) return a.type === 'done' ? 1 : -1;
            if (a.priority !== b.priority) return b.priority - a.priority;
            return a.fileName.localeCompare(b.fileName);
        });
    }, [tasks]);

    const handleDragStart = (e: React.DragEvent<HTMLDivElement>, task: TaskItem) => {
        e.dataTransfer.setData('application/json', JSON.stringify(task));
        e.dataTransfer.effectAllowed = 'move';
        (e.target as HTMLElement).style.opacity = '0.4';
    };

    const handleDragEnd = (e: React.DragEvent<HTMLDivElement>) => {
        (e.target as HTMLElement).style.opacity = '1';
    };

    const handleDrop = async (e: React.DragEvent<HTMLDivElement>, newDate: string | null, newPrio: number | null) => {
        e.preventDefault();
        const data = e.dataTransfer.getData('application/json');
        if (!data) return;
        try {
            const draggedTask: TaskItem = JSON.parse(data);
            setTasks(prev => prev.map(t => {
                if (t.path === draggedTask.path && t.line === draggedTask.line) {
                    return { ...t, date: newDate || t.date, priority: newPrio !== null ? newPrio : t.priority };
                }
                return t;
            }));
            await plugin.updateTaskMetadata(draggedTask, newDate, newPrio);
        } catch (err) {}
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

    // 获取 5 个档位的状态表情
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
                        onDragOver={e => { e.preventDefault(); (e.target as HTMLElement).classList.add('drag-over'); }}
                        onDragLeave={e => (e.target as HTMLElement).classList.remove('drag-over')}
                        onDrop={e => { (e.target as HTMLElement).classList.remove('drag-over'); handleDrop(e, null, level); }}
                    >
                        {prioInfo.icon && <span>{prioInfo.icon}</span>}
                        <span>{prioInfo.label}</span>
                    </div>
                );
            })}
        </div>
    );

    const renderDailyList = (dateStr: string) => {
        const dayTasks = sortedTasks.filter(t => t.date === dateStr);
        if (dayTasks.length === 0) return <div style={{textAlign: 'center', color: 'var(--text-sub)', padding: '40px', width: '100%'}}>☕️ 此日无计划任务</div>;

        const groups: Record<string, TaskItem[]> = {};
        dayTasks.forEach(t => {
            const key = groupMode === 'priority' ? String(t.priority) : t.fileName;
            if (!groups[key]) groups[key] = [];
            groups[key].push(t);
        });

        const groupKeys = Object.keys(groups).sort((a, b) => groupMode === 'priority' ? Number(b) - Number(a) : a.localeCompare(b));

        return (
            <div className="file-groups-container">
                {groupKeys.map(key => {
                    const groupTasks = groups[key] || [];
                    const firstTask = groupTasks[0];
                    if (!firstTask) return null;

                    const cardClass = groupMode === 'priority' ? `prio-group-${key}` : `group-type-${firstTask.colorIndex}`;
                    const headerText = groupMode === 'priority' ? (PRIORITY_MAP[Number(key)]?.label || key) : key;

                    return (
                        <div 
                            key={key} className={`file-group-card ${cardClass}`}
                            onDragOver={e => { if (groupMode === 'priority') { e.preventDefault(); (e.currentTarget as HTMLElement).classList.add('drop-zone-active'); } }}
                            onDragLeave={e => { if (groupMode === 'priority') { (e.currentTarget as HTMLElement).classList.remove('drop-zone-active'); } }}
                            onDrop={e => { if (groupMode === 'priority') { (e.currentTarget as HTMLElement).classList.remove('drop-zone-active'); handleDrop(e, null, Number(key)); } }}
                        >
                            <div className="file-group-header">{headerText}</div>
                            {groupTasks.map((t, idx) => (
                                <div key={`${t.path}-${t.line}-${idx}`} className={`ios-task-item ${t.type === 'done' ? 'checked' : ''}`} draggable onDragStart={e => handleDragStart(e, t)} onDragEnd={handleDragEnd}>
                                    <div className={`ios-checkbox ${t.type === 'done' ? 'checked' : 'unchecked'}`} onClick={(e) => { e.stopPropagation(); handleCheckboxClick(t); }}>✓</div>
                                    <div className="task-content-wrapper">
                                        <a className="internal-link-wrapper internal-link" data-href={t.path} href={t.path}>
                                            <div className="task-text">
                                                {groupMode !== 'priority' && PRIORITY_MAP[t.priority]?.icon && `${PRIORITY_MAP[t.priority]?.icon} `}{t.content}
                                            </div>
                                        </a>
                                        <div className="tag-container">
                                            {groupMode === 'priority' && <div className="task-tag file-tag">{t.fileName}</div>}
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
        
        const weekTasks = tasks.filter(t => t.date && window.moment(t.date).isBetween(startOfWeek, endOfWeek, 'day', '[]'));
        const total = weekTasks.length;
        const done = weekTasks.filter(t => t.type === 'done').length;
        const percent = total === 0 ? 0 : Math.round((done / total) * 100);
        const emoji = getPerformanceEmoji(percent);

        return (
            <div className="weekly-insights">
                <div className="insights-header">
                    <div className="insights-title">📊 本周整体效能追踪</div>
                    <div className="insights-stats">
                        {done} / {total} <span>({percent}%)</span> 
                        <span className="insights-emoji" title="效能状态">{emoji}</span>
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

            const dTasks = sortedTasks.filter(t => t.date === dateStr);
            const dTotal = dTasks.length;
            const dDone = dTasks.filter(t => t.type === 'done').length;
            const dPercent = dTotal === 0 ? 0 : Math.round((dDone / dTotal) * 100);

            const groups: Record<string, TaskItem[]> = {};
            dTasks.forEach(t => {
                const key = groupMode === 'priority' ? String(t.priority) : t.fileName;
                if (!groups[key]) groups[key] = [];
                groups[key].push(t);
            });
            const groupKeys = Object.keys(groups).sort((a, b) => groupMode === 'priority' ? Number(b) - Number(a) : a.localeCompare(b));

            cols.push(
                <div 
                    key={dateStr} className={`week-col ${isToday ? 'today' : ''} ${isPast ? 'past' : ''}`}
                    onDragOver={e => { e.preventDefault(); (e.currentTarget as HTMLElement).classList.add('drop-zone-active'); }}
                    onDragLeave={e => (e.currentTarget as HTMLElement).classList.remove('drop-zone-active')}
                    onDrop={e => { (e.currentTarget as HTMLElement).classList.remove('drop-zone-active'); handleDrop(e, dateStr, null); }}
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
                        {dTasks.length === 0 && <div style={{opacity: 0.3, textAlign:'center', marginTop:'10px', fontSize:'0.8em'}}>无任务</div>}
                        {groupKeys.map(key => {
                            const groupTasks = groups[key] || [];
                            const headerText = groupMode === 'priority' ? PRIORITY_MAP[Number(key)]?.label : key;
                            return (
                                <div key={key} className="week-file-group">
                                    <div className="week-file-header">{headerText}</div>
                                    {groupTasks.map((t, idx) => {
                                        const cardBorderClass = groupMode === 'priority' ? `priority-level-${t.priority}` : `accent-type-${t.colorIndex}`;
                                        return (
                                            <div key={`${t.path}-${t.line}-${idx}`} className={`mini-task ${t.type} ${cardBorderClass}`} draggable onDragStart={e => handleDragStart(e, t)} onDragEnd={handleDragEnd}>
                                                <a className="internal-link-wrapper internal-link" data-href={t.path} href={t.path}>
                                                    <div className="mini-task-content" style={{textDecoration: t.type === 'done' ? 'line-through' : 'none'}}>
                                                        {groupMode !== 'priority' && PRIORITY_MAP[t.priority]?.icon && `${PRIORITY_MAP[t.priority]?.icon} `}{t.content}
                                                    </div>
                                                </a>
                                                <div className="tag-container" style={{marginTop: '2px'}}>
                                                    {groupMode === 'priority' && <div className="task-tag file-tag">{t.fileName}</div>}
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

        const cells = [];
        for (let i = 0; i < startDay; i++) cells.push(<div key={`spacer-${i}`} className="calendar-cell spacer" />);

        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = currentDate.clone().date(day).format('YYYY-MM-DD');
            const dayTasks = sortedTasks.filter(t => t.date === dateStr);
            const taskCount = dayTasks.length;
            
            let heat = 0;
            if (taskCount > 0) heat = 1;
            if (taskCount > 2) heat = 2;
            if (taskCount > 4) heat = 3;
            if (taskCount > 7) heat = 4;

            cells.push(
                <div key={dateStr} className={`calendar-cell heat-${heat} ${dateStr === currentDate.format('YYYY-MM-DD') ? 'selected' : ''}`} onClick={() => setCurrentDate(window.moment(dateStr))}>
                    <div className="day-number">{day}</div>
                    {taskCount > 0 && <div className="task-count-badge">{taskCount}</div>}
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
                    {/* 🌟 补充热力图提示图例 */}
                    <div className="heatmap-legend">
                        <span>少</span>
                        <div className="calendar-cell heat-0"></div>
                        <div className="calendar-cell heat-1"></div>
                        <div className="calendar-cell heat-2"></div>
                        <div className="calendar-cell heat-3"></div>
                        <div className="calendar-cell heat-4"></div>
                        <span>多</span>
                    </div>
                </div>
                <div className="month-main-content">
                    {renderDailyList(currentDate.format('YYYY-MM-DD'))}
                </div>
            </div>
        );
    };

    if (isLoading) return (<div className={`task-dashboard-container ${densityClass}`} style={{justifyContent: 'center', alignItems: 'center'}}><h2 style={{color: 'var(--text-sub)', opacity: 0.7}}>🚀 正在引擎加速读取知识库...</h2></div>);

    return (
        <div className={`task-dashboard-container ${densityClass}`}>
            <div className="fixed-top-area">
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