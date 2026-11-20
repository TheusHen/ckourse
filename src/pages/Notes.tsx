import { useState, useEffect, useCallback, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { usePageVisible } from "@/hooks/usePageVisible";
import {
  NotepadIcon as Notepad,
  MagnifyingGlassIcon as MagnifyingGlass,
  CaretUpDownIcon as CaretUpDown,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { SearchInput } from "@/components/ui/search-input";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Menu, MenuContent, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "@/components/ui/menu";
import type { NoteWithCourse } from "@/types";
import { getAllNotes, updateNote, deleteNote, setNoteTags } from "@/lib/store";
import { NoteEditor } from "@/components/course-detail/NoteEditor";
import { courseColor } from "@/lib/color";
import { firstTimestamp, noteText } from "@/lib/notes";
import { NoteCard } from "@/components/notes/NoteCard";
import { RevisitNote } from "@/components/notes/RevisitNote";
import { CourseCover } from "@/components/dashboard/CourseCover";

type SortMode = "recent" | "course";
type NoteView = "all" | "timestamped" | "untimestamped";

interface NotesProps {
  className?: string;
}

interface NoteGroup {
  key: string;
  label: string;
  /** Set for course groups, so the heading can show the course's cover */
  course?: { title: string; accentColor: string };
  notes: NoteWithCourse[];
}

const DAY = 24 * 60 * 60 * 1000;

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Bucket like Apple Notes: what you wrote today stays distinct from the archive. */
function timeBucket(iso: string): string {
  const today = startOfDay(new Date());
  const day = startOfDay(new Date(iso));
  if (day >= today) return "Today";
  if (day >= today - DAY) return "Yesterday";
  if (day >= today - 6 * DAY) return "Previous 7 days";
  if (day >= today - 29 * DAY) return "Previous 30 days";
  return "Earlier";
}

function relativeTime(iso: string): string {
  const d = new Date(iso);
  const bucket = timeBucket(iso);
  if (bucket === "Today" || bucket === "Yesterday") {
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  if (bucket === "Previous 7 days") return d.toLocaleDateString(undefined, { weekday: "long" });
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: sameYear ? undefined : "numeric" });
}

export function Notes({ className }: NotesProps) {
  const [notes, setNotes] = useState<NoteWithCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get("q") ?? "";
  const [courseFilter, setCourseFilter] = useState<number | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const [noteView, setNoteView] = useState<NoteView>("all");
  const [activeTag, setActiveTag] = useState<string | null>(null);

  const setSearch = useCallback((value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set("q", value);
      else next.delete("q");
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const reload = useCallback(() => {
    return getAllNotes().then(setNotes);
  }, []);

  useEffect(() => {
    reload().finally(() => setLoading(false));
  }, [reload]);

  usePageVisible("/notes", reload);

  const courses = useMemo(() => {
    const map = new Map<number, { id: number; title: string; accentColor: string; count: number }>();
    for (const n of notes) {
      const existing = map.get(n.courseId);
      if (existing) {
        existing.count++;
      } else {
        map.set(n.courseId, { id: n.courseId, title: n.courseTitle, accentColor: n.accentColor, count: 1 });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.title.localeCompare(b.title));
  }, [notes]);

  const tags = useMemo(() => Array.from(new Set(notes.flatMap((n) => n.tags))).sort((a, b) => a.localeCompare(b)), [notes]);

  // Search text per note, parsed out of the HTML once per load rather than on every keystroke
  const searchText = useMemo(
    () => new Map(notes.map((n) => [n.id, `${noteText(n.content)}\n${n.lessonTitle}\n${n.courseTitle}`.toLowerCase()])),
    [notes],
  );

  const groups = useMemo<NoteGroup[]>(() => {
    let result = notes;
    if (courseFilter !== null) result = result.filter((n) => n.courseId === courseFilter);
    if (activeTag) result = result.filter((n) => n.tags.includes(activeTag));
    if (noteView === "timestamped") result = result.filter((n) => firstTimestamp(n.content) !== null);
    if (noteView === "untimestamped") result = result.filter((n) => firstTimestamp(n.content) === null);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((n) => searchText.get(n.id)?.includes(q));
    }
    const byRecent = [...result].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    const out: NoteGroup[] = [];
    const index = new Map<string, NoteGroup>();
    for (const n of byRecent) {
      const key = sortMode === "recent" ? timeBucket(n.updatedAt) : String(n.courseId);
      let g = index.get(key);
      if (!g) {
        g =
          sortMode === "recent"
            ? { key, label: key, notes: [] }
            : { key, label: n.courseTitle, course: { title: n.courseTitle, accentColor: n.accentColor }, notes: [] };
        index.set(key, g);
        out.push(g);
      }
      g.notes.push(n);
    }
    if (sortMode === "course") out.sort((a, b) => a.label.localeCompare(b.label));
    return out;
  }, [notes, searchText, courseFilter, search, sortMode, noteView, activeTag]);

  const handleEdit = useCallback(
    async (noteId: number, content: string) => {
      await updateNote(noteId, content);
      setEditingNoteId(null);
      await reload();
    },
    [reload],
  );

  const handleDelete = useCallback(
    async (noteId: number) => {
      await deleteNote(noteId);
      setEditingNoteId(null);
      await reload();
    },
    [reload],
  );

  const handleSetTags = useCallback(async (noteId: number, nextTags: string[]) => {
    await setNoteTags(noteId, nextTags);
    await reload();
  }, [reload]);

  const header = (subtitle: string) => (
    <header>
      <h1 className="font-heading text-[34px] leading-tight font-semibold text-foreground">Notes</h1>
      <p className="mt-1 font-sans text-[15px] text-muted-foreground">{subtitle}</p>
    </header>
  );

  const shell = "mx-auto flex w-full max-w-[1400px] flex-col gap-8 px-6 pt-12 pb-20 lg:px-10";

  if (loading) {
    return <div className={cn("min-h-[60vh]", className)} aria-busy="true" />;
  }

  if (notes.length === 0) {
    return (
      <div className={cn(shell, className)}>
        {header("Thoughts you write while watching land here.")}
        <EmptyState
          className="border-0"
          size="page"
          icon={Notepad}
          title="Nothing written yet"
          description="Open any lesson and jot something down. Type @ to pin the moment in the video, so you can jump straight back to it."
          action={
            <Button asChild variant="outline">
              <Link to="/">Go to your library</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const activeCourse = courses.find((c) => c.id === courseFilter);
  const shown = groups.reduce((n, g) => n + g.notes.length, 0);

  return (
    <div className={cn(shell, className)}>
      {header(
        `${notes.length} ${notes.length === 1 ? "note" : "notes"} across ${courses.length} ${courses.length === 1 ? "course" : "courses"}.`,
      )}

      {notes.length >= 3 && (
        <div>
          <RevisitNote notes={notes} />
        </div>
      )}

      <div
        className="flex flex-wrap items-center gap-3"
      >
        <SegmentedControl
          aria-label="Group notes by"
          value={sortMode}
          onChange={setSortMode}
          options={[
            { value: "recent", label: "Recent" },
            { value: "course", label: "By course" },
          ]}
        />

        <SegmentedControl aria-label="Filter notes by timestamp" value={noteView} onChange={setNoteView} size="sm" options={[
          { value: "all", label: "All notes" }, { value: "timestamped", label: "With moment" }, { value: "untimestamped", label: "Without moment" },
        ]} />

        {courses.length > 1 && (
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost" size="sm" className={cn("max-w-72", activeCourse && "bg-secondary text-foreground")}>
                {activeCourse && (
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: courseColor(activeCourse.accentColor) }}
                  />
                )}
                <span className="truncate">{activeCourse ? activeCourse.title : "All courses"}</span>
                <CaretUpDown className="size-3.5" />
              </Button>
            </MenuTrigger>
            <MenuContent align="start" className="max-w-80">
              <MenuLabel>Show notes from</MenuLabel>
              <MenuRadioGroup
                value={courseFilter === null ? "all" : String(courseFilter)}
                onValueChange={(v) => setCourseFilter(v === "all" ? null : Number(v))}
              >
                <MenuRadioItem value="all">
                  All courses
                  <span className="ml-auto pl-4 text-xs text-muted-foreground tabular-nums">{notes.length}</span>
                </MenuRadioItem>
                {courses.map((c) => (
                  <MenuRadioItem key={c.id} value={String(c.id)}>
                    <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: courseColor(c.accentColor) }} />
                    <span className="truncate">{c.title}</span>
                    <span className="ml-auto pl-4 text-xs text-muted-foreground tabular-nums">{c.count}</span>
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuContent>
          </Menu>
        )}

        <SearchInput value={search} onChange={setSearch} placeholder="Search notes" className="ml-auto w-full sm:w-64" />
      </div>

      {tags.length > 0 && <div className="flex flex-wrap items-center gap-2" aria-label="Filter notes by tag"><Button size="xs" variant={activeTag === null ? "secondary" : "ghost"} onClick={() => setActiveTag(null)}>All tags</Button>{tags.map((tag) => <Button key={tag} size="xs" variant={activeTag === tag ? "secondary" : "ghost"} onClick={() => setActiveTag(activeTag === tag ? null : tag)}>#{tag}</Button>)}</div>}

      {shown === 0 ? (
        <EmptyState
          className="border-0"
          icon={MagnifyingGlass}
          title="No notes match"
          description={search ? `Nothing you've written mentions "${search}".` : "No notes for this course yet."}
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSearch("");
                setCourseFilter(null);
              }}
            >
              Show all notes
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-10">
          {groups.map((group) => (
            <section key={group.key} aria-label={group.label} className="flex flex-col gap-3">
              <h2 className="flex items-center gap-2.5 px-1 font-heading text-[17px] font-semibold text-foreground">
                {group.course && (
                  <CourseCover
                    title={group.course.title}
                    accentColor={group.course.accentColor}
                    showTitle={false}
                    className="h-5 w-8 shrink-0 rounded-[5px]"
                  />
                )}
                <span className="truncate">{group.label}</span>
                <span className="font-sans text-[13px] font-normal text-muted-foreground tabular-nums">
                  {group.notes.length}
                </span>
              </h2>
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] items-stretch gap-4">
                {group.notes.map((note) => {
                  return (
                    <li
                      key={note.id}
                      className={cn(editingNoteId === note.id && "col-span-full")}
                    >
                      {editingNoteId === note.id ? (
                        <div className="rounded-2xl border border-border bg-card p-3 shadow-pop">
                          <NoteEditor
                            videoTime={0}
                            initialContent={note.content}
                            onSubmit={(content) => handleEdit(note.id, content)}
                            onCancel={() => setEditingNoteId(null)}
                          />
                        </div>
                      ) : (
                        <NoteCard
                          note={note}
                          showCourse={sortMode === "recent"}
                          time={relativeTime(note.updatedAt)}
                          highlight={search}
                          onStartEdit={() => setEditingNoteId(note.id)}
                          onDelete={() => handleDelete(note.id)}
                          onSetTags={(next) => handleSetTags(note.id, next)}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
