export interface CalendarTaskLike {
    date: string | null;
    type: 'todo' | 'done' | 'cancelled';
    priority: number;
    tags: string[];
}

export interface WeightedProgress {
    totalWeight: number;
    doneWeight: number;
    percent: number;
    doneCount: number;
    totalCount: number;
}

export interface TagFragment {
    start: number;
    end: number;
    query: string;
}

export interface MonthPreview<T> {
    tasks: T[];
    remainingCount: number;
}

export interface MoveTarget {
    date: string | null;
    priority: number | 'done' | null;
}

export function normalizeTag(tag: string): string | null {
    const cleaned = tag.trim().replace(/^#+/, '');
    if (!cleaned) return null;
    return `#${cleaned}`;
}

export function normalizeTagList(value: string | string[]): string[] {
    const rawTags = Array.isArray(value) ? value : value.split(/[\s,，]+/u);
    const seen = new Set<string>();
    const result: string[] = [];

    rawTags.forEach(rawTag => {
        const tag = normalizeTag(rawTag);
        if (!tag) return;
        const key = tag.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        result.push(tag);
    });

    return result;
}

export function filterVisibleTasks<T extends { type: CalendarTaskLike['type'] }>(tasks: T[], showCompleted: boolean): T[] {
    if (showCompleted) return tasks;
    return tasks.filter(task => task.type !== 'done' && task.type !== 'cancelled');
}

export function calculateWeightedProgress<T extends { type: CalendarTaskLike['type']; priority: number }>(
    tasks: T[],
    priorityWeights: Record<number, number>
): WeightedProgress {
    const activeTasks = tasks.filter(task => task.type !== 'cancelled');
    const totalWeight = activeTasks.reduce((total, task) => total + (priorityWeights[task.priority] ?? 1), 0);
    if (totalWeight === 0) return { totalWeight, doneWeight: 0, percent: 0, doneCount: 0, totalCount: 0 };

    const doneTasks = activeTasks.filter(task => task.type === 'done');
    const doneWeight = doneTasks.reduce((total, task) => total + (priorityWeights[task.priority] ?? 1), 0);

    return {
        totalWeight,
        doneWeight,
        percent: Math.round((doneWeight / totalWeight) * 100),
        doneCount: doneTasks.length,
        totalCount: activeTasks.length
    };
}

export function isDdlTask(task: Pick<CalendarTaskLike, 'tags'>, ddlTags: string[]): boolean {
    if (ddlTags.length === 0) return false;
    const normalizedDdlTags = new Set(ddlTags.map(tag => tag.toLowerCase()));
    return task.tags.some(tag => normalizedDdlTags.has(tag.toLowerCase()));
}

export function sortMonthTasksForDisplay<T extends CalendarTaskLike>(tasks: T[], ddlTags: string[]): T[] {
    return tasks
        .map((task, index) => ({ task, index, isDdl: isDdlTask(task, ddlTags) }))
        .sort((a, b) => {
            if (a.isDdl !== b.isDdl) return a.isDdl ? -1 : 1;
            return a.index - b.index;
        })
        .map(item => item.task);
}

export function getMobileMonthPreview<T extends CalendarTaskLike>(tasks: T[], ddlTags: string[], limit = 2): MonthPreview<T> {
    const safeLimit = Math.max(0, Math.floor(limit));
    const sortedTasks = sortMonthTasksForDisplay(tasks, ddlTags);

    return {
        tasks: sortedTasks.slice(0, safeLimit),
        remainingCount: Math.max(0, sortedTasks.length - safeLimit)
    };
}

export function parseMoveTarget(dateValue: string | null, priorityValue: string | null): MoveTarget | null {
    const date = dateValue || null;
    let priority: MoveTarget['priority'] = null;

    if (priorityValue === 'done') {
        priority = 'done';
    } else if (priorityValue !== null && priorityValue.trim() !== '') {
        const parsed = Number(priorityValue);
        if (!Number.isInteger(parsed)) return null;
        priority = parsed;
    }

    if (!date && priority === null) return null;
    return { date, priority };
}

export function getTagFragment(value: string, cursor: number): TagFragment | null {
    const safeCursor = Math.max(0, Math.min(cursor, value.length));
    const beforeCursor = value.slice(0, safeCursor);
    const match = beforeCursor.match(/(^|\s)(#[^\s#]*)$/u);
    if (!match || match.index === undefined) return null;

    const prefixLength = match[1]?.length ?? 0;
    const start = match.index + prefixLength;
    return {
        start,
        end: safeCursor,
        query: value.slice(start, safeCursor)
    };
}

export function completeTagAtCursor(value: string, cursor: number, tag: string): { value: string; cursor: number } {
    const fragment = getTagFragment(value, cursor);
    const normalizedTag = normalizeTag(tag);
    if (!fragment || !normalizedTag) return { value, cursor };

    const before = value.slice(0, fragment.start);
    const after = value.slice(fragment.end);
    const needsSpace = after.length === 0 || !/^\s/u.test(after);
    const inserted = `${normalizedTag}${needsSpace ? ' ' : ''}`;
    const nextValue = `${before}${inserted}${after}`;

    return {
        value: nextValue,
        cursor: before.length + inserted.length
    };
}

export function filterTagSuggestions(value: string, cursor: number, tags: string[], limit: number): string[] {
    const fragment = getTagFragment(value, cursor);
    if (!fragment) return [];

    const needle = fragment.query.replace(/^#/u, '').toLowerCase();
    const seen = new Set<string>();
    const result: string[] = [];

    for (const rawTag of tags) {
        const tag = normalizeTag(rawTag);
        if (!tag) continue;
        const key = tag.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);

        const tagText = key.replace(/^#/u, '');
        if (needle && !tagText.includes(needle)) continue;

        result.push(tag);
        if (result.length >= limit) break;
    }

    return result;
}

export function groupTasksByDate<T extends { date: string | null }>(tasks: T[]): Map<string, T[]> {
    const grouped = new Map<string, T[]>();

    tasks.forEach(task => {
        if (!task.date) return;
        const existing = grouped.get(task.date);
        if (existing) existing.push(task);
        else grouped.set(task.date, [task]);
    });

    return grouped;
}
