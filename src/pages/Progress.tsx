import { useState, useEffect, useMemo, useCallback, type ReactNode } from "react";
import { usePageVisible } from "@/hooks/usePageVisible";
import {
  ChartBarIcon as ChartBar,
  FireIcon as Fire,
  TrophyIcon as Trophy,
  ClockIcon as Clock,
  CheckCircleIcon as CheckCircle,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ProgressBar } from "@/components/ui/ProgressBar";
import type { ActivityDetail, ProgressData } from "@/types";
import { getActivityDetails, getProgressData } from "@/lib/store";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Link } from "react-router-dom";
import { LevelSummary } from "@/components/progress/LevelSummary";
import { ActivityHeatmap } from "@/components/progress/ActivityHeatmap";
import { TopicBars } from "@/components/progress/TopicBars";
import { CourseProgressList } from "@/components/progress/CourseProgressList";

function formatHours(mins: number): { value: string; unit: string } {
  if (mins < 60) return { value: String(mins), unit: mins === 1 ? "minute" : "minutes" };
  const h = mins / 60;
  return { value: h < 10 ? h.toFixed(1).replace(/\.0$/, "") : String(Math.round(h)), unit: "hours" };
}

interface FigureProps {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  unit?: string;
  detail?: string;
  children?: ReactNode;
}

/** A headline number: big, sans, tabular — the number is the content, the icon is a hint. */
function Figure({ icon, label, value, unit, detail, children }: FigureProps) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className="flex items-center gap-1.5 font-sans text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="flex items-baseline gap-1.5">
        <span className="font-heading text-[30px] leading-none font-semibold tabular-nums text-foreground">{value}</span>
        {unit && <span className="font-sans text-sm text-muted-foreground">{unit}</span>}
      </span>
      <span className="flex h-4 items-center">
        {children ?? (detail && <span className="truncate font-sans text-xs text-muted-foreground tabular-nums">{detail}</span>)}
      </span>
    </div>
  );
}

/** The last seven days, oldest first, today last: a streak you can see, not just count. */
function WeekStrip({ days }: { days: boolean[] }) {
  const today = new Date();
  return (
    <ol className="flex gap-1" aria-label="Learning in the last seven days">
      {days.map((active, i) => {
        const date = new Date(today);
        date.setDate(today.getDate() - (days.length - 1 - i));
        const day = date.toLocaleDateString(undefined, { weekday: "long" });
        return (
          <li
            key={i}
            title={`${day}${active ? " · learned" : ""}`}
            aria-label={`${day}${active ? ", learned" : ""}`}
            className={cn("h-2 w-4 rounded-full", active ? "bg-primary" : "bg-accent")}
          />
        );
      })}
    </ol>
  );
}

function SectionHeading({ id, title, detail }: { id?: string; title: string; detail?: ReactNode }) {
  return (
    <div className="mb-5 flex items-baseline justify-between gap-4">
      <h2 id={id} className="font-heading text-xl font-semibold text-foreground">{title}</h2>
      {detail && <span className="font-sans text-xs text-muted-foreground">{detail}</span>}
    </div>
  );
}

/** One honest sentence about the whole journey so far. */
function summary(data: ProgressData): string {
  const { completedLessons, totalWatchTimeMins } = data.stats;
  if (completedLessons === 0) return "Finish your first lesson and this page starts to fill in.";
  const hours = Math.round(totalWatchTimeMins / 60);
  const time = hours >= 1 ? `${hours} ${hours === 1 ? "hour" : "hours"}` : `${totalWatchTimeMins} minutes`;
  return `${completedLessons} ${completedLessons === 1 ? "lesson" : "lessons"} and ${time} of learning so far.`;
}

interface ProgressProps {
  className?: string;
}

export function Progress({ className }: ProgressProps) {
  const [data, setData] = useState<ProgressData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [period, setPeriod] = useState<"7" | "30" | "365" | "all">("30");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dayDetails, setDayDetails] = useState<ActivityDetail[]>([]);
  const [detailsLoading, setDetailsLoading] = useState(false);

  const reload = useCallback(() => {
    getProgressData()
      .then((d) => {
        setData(d);
        setLoadError(false);
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  usePageVisible("/progress", reload);

  const activityDates = useMemo(() => new Set(data?.activityDays.map((d) => d.date) ?? []), [data]);

  const periodStats = useMemo(() => {
    if (!data) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = period === "all" ? null : Number(period);
    const start = days == null ? null : new Date(today.getTime() - (days - 1) * 86_400_000);
    const previousStart = days == null ? null : new Date(today.getTime() - days * 2 * 86_400_000 + 86_400_000);
    const current = data.activityDays.filter((d) => {
      if (!start) return true;
      return new Date(`${d.date}T00:00:00`).getTime() >= start.getTime() && new Date(`${d.date}T00:00:00`).getTime() <= today.getTime();
    });
    const previous = days == null ? [] : data.activityDays.filter((d) => {
      const date = new Date(`${d.date}T00:00:00`).getTime();
      return previousStart != null && date >= previousStart.getTime() && date < start!.getTime();
    });
    const seconds = (rows: typeof data.activityDays) => rows.reduce((sum, day) => sum + day.watchSeconds, 0);
    const currentSeconds = seconds(current);
    const previousSeconds = seconds(previous);
    const activeDays = current.filter((d) => d.watchSeconds > 0).length;
    const previousActiveDays = previous.filter((d) => d.watchSeconds > 0).length;
    const percent = (a: number, b: number) => b === 0 ? (a > 0 ? null : 0) : Math.round(((a - b) / b) * 100);
    const spanDays = days ?? (current.length ? Math.max(1, Math.ceil((today.getTime() - new Date(`${current[0].date}T00:00:00`).getTime()) / 86_400_000) + 1) : 7);
    return { currentSeconds, previousSeconds, activeDays, previousActiveDays, watchChange: percent(currentSeconds, previousSeconds), dayChange: percent(activeDays, previousActiveDays), recentWeeklyMinutes: currentSeconds / 60 / Math.max(1, spanDays / 7), averageMinutesPerActiveDay: activeDays ? currentSeconds / 60 / activeDays : 0 };
  }, [data, period]);

  const selectDate = useCallback((date: string) => {
    setSelectedDate(date);
    setDetailsLoading(true);
    getActivityDetails(date).then(setDayDetails).catch(() => setDayDetails([])).finally(() => setDetailsLoading(false));
  }, []);

  const container = "mx-auto w-full max-w-[1400px] px-6 pt-12 pb-20 lg:px-10";

  if (loading) {
    // Local read: hold the space rather than flashing a spinner
    return <div className={cn("min-h-[60vh]", className)} aria-busy="true" />;
  }

  if (loadError || !data) {
    return (
      <div className={cn(container, className)}>
        <EmptyState
          icon={ChartBar}
          size="page"
          title="Your progress didn't load"
          description="Nothing is lost — this is usually a hiccup reading the database."
          action={
            <Button variant="outline" size="sm" onClick={() => { setLoading(true); reload(); }}>
              Try again
            </Button>
          }
        />
      </div>
    );
  }

  const { stats } = data;
  const overallPct = stats.totalLessons > 0 ? Math.round((stats.completedLessons / stats.totalLessons) * 100) : 0;
  const watch = formatHours(stats.totalWatchTimeMins);

  return (
    <div className={cn(container, "flex flex-col gap-14", className)}>
      <header>
        <h1 className="font-heading text-[34px] leading-tight font-semibold text-foreground">Progress</h1>
        <p className="mt-1 font-sans text-[15px] text-muted-foreground">{summary(data)}</p>
      </header>

      <section aria-label="Level and totals" className="rounded-3xl border border-border bg-card shadow-card">
        <LevelSummary stats={stats} className="p-8" />
        <div className="grid grid-cols-2 gap-8 border-t border-border px-8 py-7 lg:grid-cols-4 lg:[&>*+*]:border-l lg:[&>*+*]:border-border lg:[&>*+*]:pl-8">
          <Figure
            icon={<Fire weight="fill" className="size-3.5 text-warning" />}
            label="Current streak"
            value={stats.currentStreak}
            unit={stats.currentStreak === 1 ? "day" : "days"}
          >
            {stats.weekActivity.length > 0 && <WeekStrip days={stats.weekActivity} />}
          </Figure>
          <Figure
            icon={<Trophy className="size-3.5" />}
            label="Longest streak"
            value={data.longestStreak}
            unit={data.longestStreak === 1 ? "day" : "days"}
            detail={data.longestStreak > 0 && stats.currentStreak >= data.longestStreak ? "You're on it now" : "Your best run"}
          />
          <Figure
            icon={<Clock className="size-3.5" />}
            label="Time learning"
            value={watch.value}
            unit={watch.unit}
            detail={
              stats.completedLessons > 0
                ? `About ${Math.max(1, Math.round(stats.totalWatchTimeMins / stats.completedLessons))} min a lesson`
                : undefined
            }
          />
          <Figure
            icon={<CheckCircle className="size-3.5" />}
            label="Lessons done"
            value={stats.completedLessons}
            unit={`of ${stats.totalLessons}`}
          >
            <span className="flex w-full items-center gap-2.5">
              <ProgressBar value={overallPct} label="Lessons done" className="h-1 flex-1" />
              <span className="shrink-0 font-sans text-xs font-medium tabular-nums text-foreground">{overallPct}%</span>
            </span>
          </Figure>
        </div>
      </section>

      <section aria-labelledby="activity-title">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <h2 id="activity-title" className="font-heading text-xl font-semibold text-foreground">Activity</h2>
          <SegmentedControl aria-label="Progress period" value={period} onChange={setPeriod} options={[
            { value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "365", label: "12 months" }, { value: "all", label: "All time" },
          ]} />
        </div>
        {periodStats && <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-border bg-card p-4"><p className="text-xs text-muted-foreground">Time watched</p><p className="mt-1 text-xl font-semibold tabular-nums">{Math.round(periodStats.currentSeconds / 60)} min</p><p className="text-xs text-muted-foreground">{periodStats.watchChange == null ? "No previous period data" : `${periodStats.watchChange >= 0 ? "+" : ""}${periodStats.watchChange}% vs previous period`}</p></div>
          <div className="rounded-2xl border border-border bg-card p-4"><p className="text-xs text-muted-foreground">Active days</p><p className="mt-1 text-xl font-semibold tabular-nums">{periodStats.activeDays}</p><p className="text-xs text-muted-foreground">{periodStats.dayChange == null ? "No previous period data" : `${periodStats.dayChange >= 0 ? "+" : ""}${periodStats.dayChange}% vs previous period`}</p></div>
          <div className="rounded-2xl border border-border bg-card p-4"><p className="text-xs text-muted-foreground">Average per active day</p><p className="mt-1 text-xl font-semibold tabular-nums">{Math.round(periodStats.averageMinutesPerActiveDay)} min</p><p className="text-xs text-muted-foreground">Playback days only</p></div>
          <div className="rounded-2xl border border-border bg-card p-4"><p className="text-xs text-muted-foreground">Recent pace</p><p className="mt-1 text-xl font-semibold tabular-nums">{Math.round(periodStats.recentWeeklyMinutes)} min/week</p><p className="text-xs text-muted-foreground">Based on tracked playback time</p></div>
        </div>}
        <ActivityHeatmap activityDates={activityDates} selectedDate={selectedDate} onSelectDate={selectDate} />
        {selectedDate && <div className="mt-4 rounded-2xl border border-border bg-card p-5" aria-live="polite">
          <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">{new Date(`${selectedDate}T00:00:00`).toLocaleDateString(undefined, { dateStyle: "full" })}</h3><Button size="sm" variant="ghost" onClick={() => setSelectedDate(null)}>Close</Button></div>
          {detailsLoading ? <p className="mt-3 text-sm text-muted-foreground">Loading activity…</p> : dayDetails.length ? <ul className="mt-3 divide-y divide-border">{dayDetails.map((item) => <li key={item.lessonId} className="flex items-center justify-between gap-4 py-2 text-sm"><Link className="min-w-0 truncate hover:underline" to={`/course/${item.courseId}`}>{item.courseTitle} · {item.lessonTitle}</Link><span className="shrink-0 tabular-nums text-muted-foreground">{Math.round(item.watchSeconds / 60)} min</span></li>)}</ul> : <p className="mt-3 text-sm text-muted-foreground">No playback details were recorded for this day. Manually completed lessons may still count as an activity day.</p>}
        </div>}
      </section>

      {data.courses.length > 0 && (
        <div className="grid gap-14 xl:grid-cols-[minmax(0,1fr)_360px] xl:gap-16">
          <section aria-labelledby="courses-title">
            <SectionHeading
              id="courses-title"
              title="Courses"
              detail={`${stats.inProgressCourses} in progress · ${stats.completedCourses} completed`}
            />
            <CourseProgressList courses={data.courses} weeklyMinutes={periodStats?.recentWeeklyMinutes ?? 0} />
          </section>

          {data.categories.length > 0 && (
            <section aria-labelledby="topics-title">
              <SectionHeading id="topics-title" title="Topics" />
              <TopicBars categories={data.categories} className="pt-3" />
            </section>
          )}
        </div>
      )}
    </div>
  );
}
