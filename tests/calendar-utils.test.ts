import test from 'node:test';
import assert from 'node:assert/strict';
import {
    calculateWeightedProgress,
    completeTagAtCursor,
    filterTagSuggestions,
    filterVisibleTasks,
    getTagFragment,
    groupTasksByDate,
    normalizeTagList,
    sortMonthTasksForDisplay,
    type CalendarTaskLike
} from '../src/calendar-utils.js';

const weights = { 5: 2, 4: 1, 3: 1, 2: 1, 1: 1, 0: 1 };

test('detects the active hash tag fragment before the cursor', () => {
    assert.deepEqual(getTagFragment('整理资料 #dea', 4), null);
    assert.deepEqual(getTagFragment('整理资料 #dea', 9), { start: 5, end: 9, query: '#dea' });
});

test('completes the active hash tag and preserves surrounding task text', () => {
    assert.deepEqual(
        completeTagAtCursor('整理资料 #dea 明天处理', 9, '#deadline'),
        { value: '整理资料 #deadline 明天处理', cursor: 14 }
    );
});

test('filters tag suggestions from the active hash fragment', () => {
    assert.deepEqual(
        filterTagSuggestions('整理资料 #dea', 9, ['#work', '#deadline', '#demo', '#project/a'], 5),
        ['#deadline']
    );

    assert.deepEqual(
        filterTagSuggestions('整理资料 #', 6, ['#work', '#deadline', '#demo'], 2),
        ['#work', '#deadline']
    );
});

test('filters hidden completed tasks without changing progress inputs', () => {
    const tasks: CalendarTaskLike[] = [
        { date: '2026-06-06', type: 'todo', priority: 2, tags: [] },
        { date: '2026-06-06', type: 'done', priority: 5, tags: [] }
    ];

    assert.equal(filterVisibleTasks(tasks, false).length, 1);
    assert.deepEqual(calculateWeightedProgress(tasks, weights), {
        totalWeight: 3,
        doneWeight: 2,
        percent: 67,
        doneCount: 1,
        totalCount: 2
    });
});

test('normalizes DDL tag settings and sorts matching month tasks first', () => {
    const tasks: CalendarTaskLike[] = [
        { date: '2026-06-06', type: 'todo', priority: 2, tags: ['#work'] },
        { date: '2026-06-06', type: 'todo', priority: 2, tags: ['#deadline'] },
        { date: '2026-06-06', type: 'done', priority: 2, tags: ['#DDL'] }
    ];

    const ddlTags = normalizeTagList('deadline, #DDL  #milestone');
    assert.deepEqual(ddlTags, ['#deadline', '#DDL', '#milestone']);
    assert.deepEqual(sortMonthTasksForDisplay(tasks, ddlTags).map(task => task.tags[0]), ['#deadline', '#DDL', '#work']);
});

test('groups dated tasks by date and skips undated tasks', () => {
    const tasks: CalendarTaskLike[] = [
        { date: '2026-06-06', type: 'todo', priority: 2, tags: [] },
        { date: null, type: 'todo', priority: 2, tags: [] },
        { date: '2026-06-06', type: 'done', priority: 2, tags: [] },
        { date: '2026-06-07', type: 'todo', priority: 2, tags: [] }
    ];

    const grouped = groupTasksByDate(tasks);
    assert.equal(grouped.get('2026-06-06')?.length, 2);
    assert.equal(grouped.get('2026-06-07')?.length, 1);
    assert.equal(grouped.has(''), false);
});
