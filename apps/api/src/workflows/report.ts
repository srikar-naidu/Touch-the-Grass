import { z } from 'zod';
import { Challenge, AppEvent, Aggregates } from '../db/interface.js';
import { ModelProvider } from '../providers/interface.js';
import * as Sentry from '@sentry/node';

export interface WeeklyReportInput {
  userId: string;
  weekStart: string;
}

export interface WeeklyReportOutput {
  narrative: string;
  stats: {
    challengesIssued: number;
    challengesCompleted: number;
    challengesSkipped: number;
    completionRate: number;
    streakDays: number;
    totalScreenSeconds: number;
    avgScreenSeconds: number;
    avgMoodDelta: number;
    topCategory: string;
    hardestCompleted: number;
  };
  highlights: string[];
}

function computeStats(challenges: Challenge[], events: AppEvent[]) {
  const issued = challenges.length;
  const completed = challenges.filter(c => c.status === 'completed').length;
  const skipped = challenges.filter(c => c.status === 'skipped').length;
  const failed = challenges.filter(c => c.status === 'failed').length;
  const completionRate = issued === 0 ? 0 : completed / Math.max(1, issued);

  const completedList = challenges.filter(c => c.status === 'completed');
  const sortedByDate = [...challenges]
    .filter(c => c.status === 'completed' || c.status === 'issued')
    .sort((a, b) => a.issuedAt.getTime() - b.issuedAt.getTime());

  let streak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 0; i < 14; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toDateString();
    const hasCompleted = completedList.some(c => {
      const cd = new Date(c.completedAt || c.issuedAt);
      return cd.toDateString() === key;
    });
    const hasIssued = challenges.some(c => c.issuedAt.toDateString() === key);
    if (hasCompleted) streak++;
    else if (i === 0) continue;
    else if (hasIssued) break;
  }

  const screenSecondsArr = challenges
    .map(c => c.screenSeconds)
    .filter((s): s is number => typeof s === 'number');
  const totalScreenSeconds = screenSecondsArr.reduce((a, b) => a + b, 0);
  const avgScreenSeconds = screenSecondsArr.length
    ? totalScreenSeconds / screenSecondsArr.length
    : 0;

  const reflections = challenges
    .map(c => c.reflection)
    .filter(r => r && typeof r.moodBefore === 'number' && typeof r.moodAfter === 'number');
  const avgMoodDelta = reflections.length
    ? reflections.reduce((sum, r) => sum + ((r!.moodAfter! - r!.moodBefore!)), 0) / reflections.length
    : 0;

  const categoryCounts: Record<string, number> = {};
  for (const c of completedList) {
    categoryCounts[c.category] = (categoryCounts[c.category] || 0) + 1;
  }
  const topEntry = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0];
  const topCategory = topEntry ? topEntry[0] : 'nature';

  const hardestCompleted = Math.max(0, ...completedList.map(c => c.difficulty));

  return {
    challengesIssued: issued,
    challengesCompleted: completed,
    challengesSkipped: skipped,
    challengesFailed: failed,
    completionRate,
    streakDays: streak,
    totalScreenSeconds,
    avgScreenSeconds,
    avgMoodDelta,
    topCategory,
    hardestCompleted,
  };
}

export async function runWeeklyReport(
  input: WeeklyReportInput,
  provider: ModelProvider,
  deps: {
    getChallenges: (userId: string, days: number) => Promise<Challenge[]>;
    getAggregates: (userId: string, period: string) => Promise<Aggregates>;
    getHistory: (userId: string, limit: number) => Promise<AppEvent[]>;
  },
): Promise<WeeklyReportOutput> {
  return Sentry.startSpan({ name: 'weekly-report-workflow', op: 'workflow' }, async (span) => {
    const challenges = await deps.getChallenges(input.userId, 7);
    const events = await deps.getHistory(input.userId, 100);
    const stats = computeStats(challenges, events);

    span?.setAttribute('challengeCount', challenges.length);
    span?.setAttribute('completionRate', stats.completionRate);

    const completedDescriptions = challenges
      .filter(c => c.status === 'completed')
      .map(c => `- ${c.title} (difficulty ${c.difficulty}, category: ${c.category}) — ${c.reflection?.summary || c.description.slice(0, 80)}`)
      .join('\n');

    const systemPrompt = `You are writing the user's weekly report for the Touch Grass outdoor challenge app.
Your tone is warm, encouraging, and conversational — like a supportive friend.
Include:
1. A brief opening greeting.
2. The completion stats ("you completed X of Y challenges this week").
3. Screen time context: contrast screen seconds vs. time spent outside.
4. Call out 1-2 specific challenges if there are any highlights.
5. One specific, actionable suggestion for next week.
6. An encouraging closing line.
Do NOT use bullet points in the narrative. Write 4-6 smooth paragraphs.
Also return a "highlights" array with 3-5 short achievement bullet strings (max 100 chars each).
Respond ONLY with valid JSON: { "narrative": "...", "highlights": ["...", "..."] }`;

    const userPrompt = `Week: starting ${input.weekStart}
User stats:
- Challenges issued: ${stats.challengesIssued}
- Challenges completed: ${stats.challengesCompleted}
- Challenges skipped: ${stats.challengesSkipped}
- Completion rate: ${Math.round(stats.completionRate * 100)}%
- Current streak: ${stats.streakDays} days
- Total app screen time this week: ${Math.round(stats.totalScreenSeconds)} seconds (${Math.round(stats.totalScreenSeconds / 60)} minutes)
- Average screen time per session: ${Math.round(stats.avgScreenSeconds)} seconds
- Average mood delta (after-before): ${stats.avgMoodDelta.toFixed(2)}
- Top category this week: ${stats.topCategory}
- Hardest challenge completed: difficulty ${stats.hardestCompleted}

Completed challenges this week:
${completedDescriptions || '(none yet)'}`;

    let narrative: string;
    let highlights: string[];

    try {
      const ReportSchema = z.object({
        narrative: z.string().min(50).max(2000),
        highlights: z.array(z.string().max(150)).min(1).max(8),
      });
      const res = await provider.generateText({
        systemPrompt,
        userPrompt,
        schema: ReportSchema,
        maxTokens: 800,
        temperature: 0.7,
      });
      const parsed = res.parsed ? ReportSchema.parse(res.parsed) : null;
      narrative = parsed?.narrative || '';
      highlights = parsed?.highlights || [];
    } catch {
      narrative = `Here's your weekly Touch Grass report. You completed ${stats.challengesCompleted} of ${stats.challengesIssued} challenges this week — keep it up! Your current streak sits at ${stats.streakDays} days. You spent ${Math.round(stats.totalScreenSeconds / 60)} minutes on the app this week, which means most of your time was spent actually outside where it counts. ${stats.topCategory ? `Your most active category was ${stats.topCategory}. ` : ''}Keep moving in the direction of more outside time, and remember: even one small step out the door is a win.`;
      highlights = [
        `${stats.challengesCompleted}/${stats.challengesIssued} challenges completed this week`,
        `Current streak: ${stats.streakDays} days`,
        `Top category: ${stats.topCategory || '—'}`,
      ];
    }

    if (!narrative) {
      narrative = `Great effort this week! Take a look at your stats above and keep building the habit of going outside. Small daily steps add up fast.`;
    }

    return {
      narrative,
      stats: {
        challengesIssued: stats.challengesIssued,
        challengesCompleted: stats.challengesCompleted,
        challengesSkipped: stats.challengesSkipped,
        completionRate: stats.completionRate,
        streakDays: stats.streakDays,
        totalScreenSeconds: stats.totalScreenSeconds,
        avgScreenSeconds: stats.avgScreenSeconds,
        avgMoodDelta: stats.avgMoodDelta,
        topCategory: stats.topCategory,
        hardestCompleted: stats.hardestCompleted,
      },
      highlights,
    };
  });
}
