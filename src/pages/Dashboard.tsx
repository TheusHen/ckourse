import { useState, useMemo, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { usePageVisible } from "@/hooks/usePageVisible";
import {
  MagnifyingGlassIcon as MagnifyingGlass,
  PlusIcon as Plus,
  CaretUpDownIcon as CaretUpDown,
  PushPinIcon as PushPin,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { CourseCard } from "@/components/dashboard/CourseCard";
import { FeaturedCourse } from "@/components/dashboard/FeaturedCourse";
import { EmptyLibrary } from "@/components/dashboard/EmptyLibrary";
import { SearchInput } from "@/components/ui/search-input";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { Course, DashboardStats, CourseCategory, CourseStatus } from "@/types";
import { byLastWatched, getCourses, getDashboardStats, getProgressData, getAllSettings, setSetting } from "@/lib/store";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Menu, MenuContent, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";

type SortOption = "recent" | "progress" | "title" | "longest" | "shortest";

const builtinCategoryLabels: Record<CourseCategory | "all", string> = {
  all: "All",
  frontend: "Frontend",
  backend: "Backend",
  devops: "DevOps",
  database: "Database",
  design: "Design",
  other: "Other",
};

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Up late";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/** One encouraging, true sentence — never a guilt trip. */
function encouragement(stats: DashboardStats | null, inProgress: number): string {
  if (stats && stats.currentStreak >= 2) return `${stats.currentStreak} days in a row. Keep the thread going.`;
  if (stats && stats.currentStreak === 1) return "You learned something today.";
  if (inProgress > 0) return `${inProgress} ${inProgress === 1 ? "course" : "courses"} in progress.`;
  return "What will you learn today?";
}

/** The course most worth resuming: latest-watched unfinished one, else the first unfinished. */
function pickFeatured(courses: Course[]): Course | null {
  return byLastWatched(courses).find((c) => c.status !== "completed") ?? courses.find((c) => c.status !== "completed") ?? courses[0] ?? null;
}

function getCategoryLabel(cat: string): string {
  return builtinCategoryLabels[cat as CourseCategory | "all"] ?? cat;
}

const statusLabels: Record<CourseStatus | "all", string> = {
  all: "All",
  "in-progress": "In progress",
  "not-started": "Not started",
  completed: "Completed",
};

const sortLabels: Record<SortOption, string> = {
  recent: "Recently watched",
  progress: "Most progress",
  title: "Title",
  longest: "Longest course",
  shortest: "Shortest course",
};

interface DashboardProps {
  className?: string;
}

export function Dashboard({ className }: DashboardProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [courses, setCourses] = useState<Course[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [pinnedCourseId, setPinnedCourseId] = useState<number | null>(null);
  const [weeklyGoal, setWeeklyGoal] = useState(180);
  const [weeklyMinutes, setWeeklyMinutes] = useState(0);
  const [savedOnly, setSavedOnly] = useState(false);

  // Derive filter state from URL search params
  const search = searchParams.get("q") ?? "";
  const category = (searchParams.get("cat") ?? "all") as CourseCategory | "all";
  const status = (searchParams.get("status") ?? "all") as CourseStatus | "all";
  const sort = (searchParams.get("sort") ?? "recent") as SortOption;

  const updateParam = useCallback(
    (key: string, value: string, remove?: boolean) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (remove || !value || value === "all" || value === "recent") {
          next.delete(key);
        } else {
          next.set(key, value);
        }
        return next;
      }, { replace: true });
    },
    [setSearchParams],
  );

  const setSearch = useCallback((v: string) => updateParam("q", v), [updateParam]);
  const setCategory = useCallback((v: CourseCategory | "all") => updateParam("cat", v), [updateParam]);
  const setStatus = useCallback((v: CourseStatus | "all") => updateParam("status", v), [updateParam]);
  const setSort = useCallback((v: SortOption) => updateParam("sort", v), [updateParam]);

  const loadCourses = useCallback((showSpinner = false) => {
    if (showSpinner) setLoading(true);
    setLoadError(false);
    Promise.all([getCourses(), getDashboardStats(), getProgressData()])
      .then(([c, s, progress]) => {
        setCourses(c ?? []);
        setStats(s);
        const today = new Date().toISOString().slice(0, 10);
        const startDate = new Date();
        startDate.setUTCDate(startDate.getUTCDate() - ((startDate.getUTCDay() + 6) % 7));
        const start = startDate.toISOString().slice(0, 10);
        setWeeklyMinutes(Math.round(progress.activityDays.filter((d) => d.date >= start && d.date <= today).reduce((sum, d) => sum + d.watchSeconds, 0) / 60));
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadCourses(true);
  }, [loadCourses]);

  useEffect(() => {
    getAllSettings().then((settings) => {
      setPinnedCourseId(Number(settings.pinned_course_id) || null);
      setWeeklyGoal(settings.weekly_goal_minutes === undefined ? 180 : Math.max(0, Number(settings.weekly_goal_minutes) || 0));
    }).catch(() => {});
  }, []);

  // The library's old "saved only" filter is the Saved page now
  const legacyBookmarkFilter = searchParams.get("bm") === "1";
  useEffect(() => {
    if (legacyBookmarkFilter) navigate("/bookmarks", { replace: true });
  }, [legacyBookmarkFilter, navigate]);

  // Refresh data when page becomes visible again (keep-alive)
  // Silent refresh so returning to the page doesn't flash a spinner
  usePageVisible("/", () => loadCourses());

  const filteredCourses = useMemo(() => {
    let result = courses;

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.author.toLowerCase().includes(q)
      );
    }

    if (category !== "all") {
      result = result.filter((c) => c.category === category);
    }

    if (status !== "all") {
      result = result.filter((c) => c.status === status);
    }
    if (savedOnly) result = result.filter((c) => c.bookmarked);

    result = [...result].sort((a, b) => {
      switch (sort) {
        case "recent": {
          if (!a.lastWatched && !b.lastWatched) return 0;
          if (!a.lastWatched) return 1;
          if (!b.lastWatched) return -1;
          return new Date(b.lastWatched).getTime() - new Date(a.lastWatched).getTime();
        }
        case "progress": {
          const pA = a.totalLessons ? a.completedLessons / a.totalLessons : 0;
          const pB = b.totalLessons ? b.completedLessons / b.totalLessons : 0;
          return pB - pA;
        }
        case "title":
          return a.title.localeCompare(b.title);
        case "longest":
          if (!a.totalDurationMins) return 1;
          if (!b.totalDurationMins) return -1;
          return b.totalDurationMins - a.totalDurationMins;
        case "shortest":
          if (!a.totalDurationMins) return 1;
          if (!b.totalDurationMins) return -1;
          return a.totalDurationMins - b.totalDurationMins;
        default:
          return 0;
      }
    });

    return result;
  }, [courses, search, category, status, sort, savedOnly]);

  const availableCategories = useMemo(() => {
    const cats = new Set(courses.map((c) => c.category));
    return ["all" as const, ...Array.from(cats)] as (CourseCategory | "all")[];
  }, [courses]);

  const featured = useMemo(() => courses.find((c) => c.id === pinnedCourseId && c.status !== "completed") ?? pickFeatured(courses), [courses, pinnedCourseId]);

  const handleImport = () => {
    navigate("/import");
  };

  if (loading) {
    // Hold the space quietly; a spinner for a local database read is mostly noise
    return <div className={cn("min-h-[60vh]", className)} aria-busy="true" />;
  }

  if (loadError) {
    return (
      <div className={cn("px-10", className)}>
        <EmptyState
          icon={MagnifyingGlass}
          size="page"
          title="Your library didn't load"
          description="Nothing is lost — this is usually a hiccup reading the database."
          action={
            <Button variant="outline" size="sm" onClick={() => loadCourses(true)}>
              Try again
            </Button>
          }
        />
      </div>
    );
  }

  if (courses.length === 0) {
    return (
      <div className={cn("px-6 lg:px-10", className)}>
        <EmptyLibrary onImport={handleImport} />
      </div>
    );
  }

  const inProgress = courses.filter((c) => c.status === "in-progress").length;
  const continueCourses = byLastWatched(courses.filter((c) => c.status === "in-progress" && c.id !== featured?.id)).slice(0, 4);
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className={cn("mx-auto flex w-full max-w-[1400px] flex-col gap-12 px-6 pt-12 pb-20 lg:px-10", className)}>
      <header
        className="flex flex-wrap items-end justify-between gap-4"
      >
        <div>
          <p className="font-sans text-[13px] font-medium text-muted-foreground">{today}</p>
          <h1 className="mt-1 font-heading text-[34px] leading-tight font-semibold text-foreground">{greeting()}</h1>
          <p className="mt-1 font-sans text-[15px] text-muted-foreground">{encouragement(stats, inProgress)}</p>
        </div>
        <Button onClick={handleImport}>
          <Plus className="size-4" weight="bold" />
          Add course
        </Button>
      </header>

      {featured && (
        <section aria-label="Up next" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card px-5 py-4">
            <div><p className="text-sm font-semibold">This week</p><p className="text-xs text-muted-foreground">{weeklyMinutes} of {weeklyGoal} min watched · optional goal</p></div>
            <div className="flex items-center gap-2"><div className="h-2 w-32 overflow-hidden rounded-full bg-accent"><div className="h-full rounded-full bg-primary" style={{ width: `${weeklyGoal ? Math.min(100, weeklyMinutes / weeklyGoal * 100) : 0}%` }} /></div><select aria-label="Weekly study goal" value={weeklyGoal} onChange={(e) => { const value = Number(e.target.value); setWeeklyGoal(value); setSetting("weekly_goal_minutes", String(value)).catch(() => {}); }} className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs"><option value={0}>No goal</option><option value={60}>1 hour</option><option value={120}>2 hours</option><option value={180}>3 hours</option><option value={300}>5 hours</option></select></div>
          </div>
          <div className="relative"><FeaturedCourse course={featured} /><button type="button" title={pinnedCourseId === featured.id ? "Unpin main course" : "Pin as main course"} aria-label={pinnedCourseId === featured.id ? "Unpin main course" : "Pin as main course"} aria-pressed={pinnedCourseId === featured.id} onClick={() => { const next = pinnedCourseId === featured.id ? null : featured.id; setPinnedCourseId(next); setSetting("pinned_course_id", next == null ? "" : String(next)).catch(() => {}); }} className="absolute right-4 top-4 z-10 flex size-9 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur hover:bg-black/70"><PushPin className="size-4" weight={pinnedCourseId === featured.id ? "fill" : "bold"} /></button></div>
        </section>
      )}

      {continueCourses.length > 0 && <section aria-labelledby="continue-later-title" className="flex flex-col gap-5"><div className="flex items-baseline justify-between gap-4"><h2 id="continue-later-title" className="font-heading text-xl font-semibold">Continue later</h2><span className="text-xs text-muted-foreground">Your other courses in progress</span></div><div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-5">{continueCourses.map((course) => <CourseCard key={course.id} course={course} onBookmarkChange={loadCourses} />)}</div></section>}

      <section aria-labelledby="library-title" className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="library-title" className="mr-2 font-heading text-[22px] font-semibold text-foreground">
            Library
          </h2>
          <SegmentedControl
            aria-label="Filter by status"
            value={status}
            onChange={setStatus}
            options={(Object.keys(statusLabels) as (CourseStatus | "all")[]).map((s) => ({
              value: s,
              label: statusLabels[s],
            }))}
          />

          <Button variant={savedOnly ? "secondary" : "ghost"} size="sm" aria-pressed={savedOnly} onClick={() => setSavedOnly((value) => !value)}>Saved</Button>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {availableCategories.length > 2 && (
              <Menu>
                <MenuTrigger asChild>
                  <Button variant="ghost" size="sm" className={cn(category !== "all" && "bg-secondary text-foreground")}>
                    {category === "all" ? "All topics" : getCategoryLabel(category)}
                    <CaretUpDown className="size-3.5" />
                  </Button>
                </MenuTrigger>
                <MenuContent>
                  <MenuLabel>Topic</MenuLabel>
                  <MenuRadioGroup value={category} onValueChange={(v) => setCategory(v as CourseCategory | "all")}>
                    {availableCategories.map((cat) => (
                      <MenuRadioItem key={cat} value={cat}>
                        {cat === "all" ? "All topics" : getCategoryLabel(cat)}
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                </MenuContent>
              </Menu>
            )}

            <Menu>
              <MenuTrigger asChild>
                <Button variant="ghost" size="sm" aria-label={`Sort: ${sortLabels[sort]}`}>
                  {sortLabels[sort]}
                  <CaretUpDown className="size-3.5" />
                </Button>
              </MenuTrigger>
              <MenuContent>
                <MenuLabel>Sort by</MenuLabel>
                <MenuRadioGroup value={sort} onValueChange={(v) => setSort(v as SortOption)}>
                  {(Object.keys(sortLabels) as SortOption[]).map((s) => (
                    <MenuRadioItem key={s} value={s}>
                      {sortLabels[s]}
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
                <MenuSeparator />
                <MenuLabel>{courses.length} courses in your library</MenuLabel>
              </MenuContent>
            </Menu>

            <SearchInput value={search} onChange={setSearch} placeholder="Search library" className="w-full sm:w-56" />
          </div>
        </div>

        {filteredCourses.length > 0 ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(232px,1fr))] gap-x-6 gap-y-8">
            {filteredCourses.map((course) => (
              <div key={course.id}>
                <CourseCard course={course} onBookmarkChange={loadCourses} />
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={MagnifyingGlass}
            title="Nothing matches"
            description={search ? `No course matches "${search}" with these filters.` : "No courses match these filters."}
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearchParams({}, { replace: true });
                }}
              >
                Show everything
              </Button>
            }
          />
        )}
      </section>
    </div>
  );
}
