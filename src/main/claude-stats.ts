import fs from 'fs';
import path from 'path';
import os from 'os';

interface DailyActivity {
  date: string;
  messageCount: number;
  sessionCount: number;
  toolCallCount: number;
}

interface StatsCache {
  version: number;
  lastComputedDate: string;
  dailyActivity: DailyActivity[];
}

export interface ClaudeStats {
  today: DailyActivity | null;
  last7Days: {
    messageCount: number;
    sessionCount: number;
    toolCallCount: number;
  };
  last30Days: {
    messageCount: number;
    sessionCount: number;
    toolCallCount: number;
  };
  lastComputedDate: string | null;
}

export function getClaudeStats(): ClaudeStats {
  const statsPath = path.join(os.homedir(), '.claude', 'stats-cache.json');

  const emptyStats: ClaudeStats = {
    today: null,
    last7Days: { messageCount: 0, sessionCount: 0, toolCallCount: 0 },
    last30Days: { messageCount: 0, sessionCount: 0, toolCallCount: 0 },
    lastComputedDate: null,
  };

  try {
    if (!fs.existsSync(statsPath)) {
      return emptyStats;
    }

    const data = fs.readFileSync(statsPath, 'utf-8');
    const cache: StatsCache = JSON.parse(data);

    const today = new Date().toISOString().split('T')[0];
    const todayActivity = cache.dailyActivity.find(d => d.date === today) || null;

    // Calculate date ranges
    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const last7Days = { messageCount: 0, sessionCount: 0, toolCallCount: 0 };
    const last30Days = { messageCount: 0, sessionCount: 0, toolCallCount: 0 };

    for (const activity of cache.dailyActivity) {
      const activityDate = new Date(activity.date);

      if (activityDate >= sevenDaysAgo) {
        last7Days.messageCount += activity.messageCount;
        last7Days.sessionCount += activity.sessionCount;
        last7Days.toolCallCount += activity.toolCallCount;
      }

      if (activityDate >= thirtyDaysAgo) {
        last30Days.messageCount += activity.messageCount;
        last30Days.sessionCount += activity.sessionCount;
        last30Days.toolCallCount += activity.toolCallCount;
      }
    }

    return {
      today: todayActivity,
      last7Days,
      last30Days,
      lastComputedDate: cache.lastComputedDate,
    };
  } catch (err) {
    console.error('[claude-stats] Failed to read stats:', err);
    return emptyStats;
  }
}
