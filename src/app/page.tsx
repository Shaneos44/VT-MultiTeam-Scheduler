"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addDays,
  addMonths,
  endOfMonth,
  format,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";

import {
  createTask,
  deleteTask,
  fetchAllPeople,
  fetchPeopleForTeam,
  fetchTasksForTeam,
  fetchTasksForTeams,
  fetchTeams,
  getAvailability,
  getPersonTasksInWindow,
  updateTask,
} from "../lib/api";

type Team = { id: string; name: string };
type Person = { id: string; name: string; daily_capacity_hours: number };
type Task = any;

type ViewMode = "week" | "month";
type ScopeMode = "team" | "all";

const TASK_SIZES = ["hourly", "half_day", "full_day", "custom"] as const;
const STATUSES = ["planned", "in_progress", "done", "cancelled"] as const;

function iso(d: Date) {
  return d.toISOString();
}

// datetime-local helpers
function dtLocalToIso(v: string) {
  const d = new Date(v);
  return d.toISOString();
}
function isoToDtLocal(isoStr: string) {
  const d = new Date(isoStr);
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function sameDay(a: Date, b: Date) {
  return a.toDateString() === b.toDateString();
}

export default function Page() {
  // Core data
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState<string>("");

  // Scope + view
  const [scope, setScope] = useState<ScopeMode>("team");
  const [viewMode, setViewMode] = useState<ViewMode>("week");

  // People list for filters + admin use
  const [peopleAll, setPeopleAll] = useState<Person[]>([]);
  // People list for the currently selected team (for filter convenience)
  const [peopleForTeam, setPeopleForTeam] = useState<Person[]>([]);

  // Tasks for the current window (team or all teams)
  const [tasks, setTasks] = useState<Task[]>([]);
  const [availability, setAvailability] = useState<any[]>([]);

  // Date anchors
  const [weekStart, setWeekStart] = useState<Date>(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 })
  );
  const [monthAnchor, setMonthAnchor] = useState<Date>(() =>
    startOfMonth(new Date())
  );

  // UI
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState<string>("");

  // Filters
  const [personFilter, setPersonFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);

  // Form fields
  const [fTeamId, setFTeamId] = useState<string>(""); // important for "All teams" creates
  const [fTitle, setFTitle] = useState("");
  const [fStart, setFStart] = useState("");
  const [fEnd, setFEnd] = useState("");
  const [fSize, setFSize] = useState<(typeof TASK_SIZES)[number]>("hourly");
  const [fStatus, setFStatus] = useState<(typeof STATUSES)[number]>("planned");
  const [fNotes, setFNotes] = useState("");
  const [fAssignees, setFAssignees] = useState<string[]>([]);

  // For assignee selector, show members of the chosen team
  const [peopleForFormTeam, setPeopleForFormTeam] = useState<Person[]>([]);

  // Conflicts (optional)
  const [conflicts, setConflicts] = useState<Record<string, any[]>>({});
  const [checkingConflicts, setCheckingConflicts] = useState(false);

  // Windows
  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  const monthStart = useMemo(() => startOfMonth(monthAnchor), [monthAnchor]);
  const monthGridStart = useMemo(
    () => startOfWeek(monthStart, { weekStartsOn: 1 }),
    [monthStart]
  );
  const monthCells = useMemo(
    () => Array.from({ length: 42 }, (_, i) => addDays(monthGridStart, i)),
    [monthGridStart]
  );

  const currentWindow = useMemo(() => {
    if (viewMode === "week") {
      return { start: weekStart, end: weekEnd };
    }
    return { start: monthGridStart, end: addDays(monthGridStart, 42) };
  }, [viewMode, weekStart, weekEnd, monthGridStart]);

  const teamNameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const t of teams) m[t.id] = t.name;
    return m;
  }, [teams]);

  const peopleOptionsForFilter = useMemo<Person[]>(() => {
    return scope === "all" ? peopleAll : peopleForTeam;
  }, [scope, peopleAll, peopleForTeam]);

  // Load base: teams + all people
  useEffect(() => {
    (async () => {
      try {
        const [ts, ps] = await Promise.all([fetchTeams(), fetchAllPeople()]);
        setTeams(ts);
        setPeopleAll(ps);
        if (ts[0]) setTeamId(ts[0].id);
      } catch (e: any) {
        setBanner(e?.message ?? String(e));
      }
    })();
  }, []);

  // Keep team people list updated
  useEffect(() => {
    if (!teamId) return;
    (async () => {
      try {
        const ppl = await fetchPeopleForTeam(teamId);
        setPeopleForTeam(ppl);
      } catch (e: any) {
        setBanner(e?.message ?? String(e));
      }
    })();
  }, [teamId]);

  async function loadWindow() {
    if (!teamId) return;
    setLoading(true);
    setBanner("");

    try {
      // tasks
      const ids = scope === "all" ? teams.map((t) => t.id) : [teamId];

      const tsk =
        scope === "all"
          ? await fetchTasksForTeams(ids, iso(currentWindow.start), iso(currentWindow.end))
          : await fetchTasksForTeam(teamId, iso(currentWindow.start), iso(currentWindow.end));

      setTasks(tsk);

      // availability panel (only meaningful for a single team scope)
      if (scope === "team") {
        const avail = await getAvailability(teamId, iso(currentWindow.start), iso(currentWindow.end));
        setAvailability(avail);
      } else {
        setAvailability([]);
      }
    } catch (e: any) {
      setBanner(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  // Reload when scope/view/window/team/teams list changes
  useEffect(() => {
    if (!teamId) return;
    if (scope === "all" && teams.length === 0) return;
    loadWindow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, scope, viewMode, weekStart, monthAnchor, teams.length]);

  // Filtered tasks
  const filteredTasks = useMemo(() => {
    return (tasks ?? []).filter((t) => {
      const statusOk = statusFilter === "all" ? true : t.status === statusFilter;
      const personOk =
        personFilter === "all"
          ? true
          : (t.assignees ?? []).some((a: any) => a.person_id === personFilter);
      return statusOk && personOk;
    });
  }, [tasks, personFilter, statusFilter]);

  // Day helper
  function tasksForDay(d: Date) {
    return filteredTasks
      .filter((t) => sameDay(new Date(t.start_at), d))
      .sort((a, b) => +new Date(a.start_at) - +new Date(b.start_at));
  }

  function groupedTasksForDay(d: Date) {
    const list = tasksForDay(d);
    const groups: Record<string, Task[]> = {};
    for (const t of list) {
      const tid = t.team_id ?? "unknown";
      if (!groups[tid]) groups[tid] = [];
      groups[tid].push(t);
    }
    const orderedTeamIds = Object.keys(groups).sort((a, b) => {
      const an = teamNameById[a] ?? a;
      const bn = teamNameById[b] ?? b;
      return an.localeCompare(bn);
    });
    return orderedTeamIds.map((tid) => ({ teamId: tid, teamName: teamNameById[tid] ?? tid, tasks: groups[tid] }));
  }

  // Modal helpers
  async function syncPeopleForFormTeam(team_id: string) {
    try {
      const ppl = await fetchPeopleForTeam(team_id);
      setPeopleForFormTeam(ppl);
    } catch {
      setPeopleForFormTeam([]);
    }
  }

  function openCreate(prefillDay?: Date) {
    setEditing(null);
    setConflicts({});
    setFTitle("");
    setFNotes("");
    setFAssignees([]);

    const chosenTeam = teamId;
    setFTeamId(chosenTeam);
    // fetch assignees list for chosen team
    syncPeopleForFormTeam(chosenTeam);

    const start = prefillDay ? new Date(prefillDay) : new Date(viewMode === "week" ? weekStart : monthAnchor);
    start.setHours(9, 0, 0, 0);
    const end = new Date(start);
    end.setHours(10, 0, 0, 0);

    setFStart(isoToDtLocal(start.toISOString()));
    setFEnd(isoToDtLocal(end.toISOString()));
    setFSize("hourly");
    setFStatus("planned");
    setModalOpen(true);
  }

  function openEdit(task: Task) {
    setEditing(task);
    setConflicts({});
    setFTitle(task.title ?? "");
    setFStart(isoToDtLocal(task.start_at));
    setFEnd(isoToDtLocal(task.end_at));
    setFSize((task.task_size ?? "custom") as any);
    setFStatus((task.status ?? "planned") as any);
    setFNotes(task.notes ?? "");
    setFAssignees((task.assignees ?? []).map((a: any) => a.person_id));

    const tId = task.team_id ?? teamId;
    setFTeamId(tId);
    syncPeopleForFormTeam(tId);

    setModalOpen(true);
  }

  function applyPreset(size: (typeof TASK_SIZES)[number]) {
    setFSize(size);
    if (!fStart) return;
    const start = new Date(fStart);
    const end = new Date(start);
    if (size === "hourly") end.setHours(end.getHours() + 1);
    if (size === "half_day") end.setHours(end.getHours() + 4);
    if (size === "full_day") end.setHours(end.getHours() + 8);
    if (size !== "custom") setFEnd(isoToDtLocal(end.toISOString()));
  }

  async function checkConflicts() {
    setCheckingConflicts(true);
    try {
      const ws = dtLocalToIso(fStart);
      const we = dtLocalToIso(fEnd);
      const results: Record<string, any[]> = {};

      for (const pid of fAssignees) {
        const list = await getPersonTasksInWindow(pid, ws, we);
        if (!list) continue;

        const filtered = list.filter((x: any) => x.task_id !== editing?.id);
        if (filtered.length) results[pid] = filtered;
      }
      setConflicts(results);
    } finally {
      setCheckingConflicts(false);
    }
  }

  async function onSave() {
    setBanner("");
    if (!fTeamId) return setBanner("Team is required.");
    if (!fTitle.trim()) return setBanner("Task title is required.");
    if (!fStart || !fEnd) return setBanner("Start and End are required.");

    const startISO = dtLocalToIso(fStart);
    const endISO = dtLocalToIso(fEnd);
    if (new Date(endISO) <= new Date(startISO)) return setBanner("End must be after Start.");

    // conflict check (warn only)
    await checkConflicts();

    try {
      if (editing) {
        // NOTE: updateTask currently doesn't change team_id (keeps tasks stable)
        await updateTask(editing.id, {
          title: fTitle.trim(),
          start_at: startISO,
          end_at: endISO,
          task_size: fSize,
          status: fStatus,
          notes: fNotes,
          assigneeIds: fAssignees,
        });
      } else {
        await createTask({
          title: fTitle.trim(),
          team_id: fTeamId,
          start_at: startISO,
          end_at: endISO,
          task_size: fSize,
          status: fStatus,
          notes: fNotes,
          assigneeIds: fAssignees,
        });
      }

      setModalOpen(false);
      await loadWindow();
    } catch (e: any) {
      setBanner(e?.message ?? String(e));
    }
  }

  async function onDelete(taskId: string) {
    if (!confirm("Delete this task?")) return;
    setBanner("");
    try {
      await deleteTask(taskId);
      setModalOpen(false);
      await loadWindow();
    } catch (e: any) {
      setBanner(e?.message ?? String(e));
    }
  }

  // Navigation controls
  function goPrev() {
    if (viewMode === "week") setWeekStart(addDays(weekStart, -7));
    else setMonthAnchor(subMonths(monthAnchor, 1));
  }
  function goNext() {
    if (viewMode === "week") setWeekStart(addDays(weekStart, 7));
    else setMonthAnchor(addMonths(monthAnchor, 1));
  }
  function goToday() {
    const now = new Date();
    setWeekStart(startOfWeek(now, { weekStartsOn: 1 }));
    setMonthAnchor(startOfMonth(now));
  }

  const headerLabel =
    viewMode === "week"
      ? `${format(weekStart, "dd MMM yyyy")} – ${format(addDays(weekStart, 6), "dd MMM yyyy")}`
      : format(monthAnchor, "MMMM yyyy");

  return (
    <main style={{ padding: 16, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0 }}>VT Multi-Team Scheduler</h1>
            <span style={{ color: "#666", fontSize: 13 }}>(GitHub Pages UI + Supabase)</span>
          </div>
          <div style={{ marginTop: 6, fontSize: 13, color: "#666" }}>
            Admin: <a href="./admin/">manage people + team membership</a>
          </div>
        </div>

        <div style={{ alignSelf: "center", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {loading && <span style={{ color: "#666", fontSize: 13 }}>Loading…</span>}
          <button onClick={() => openCreate()} style={{ fontWeight: 900 }}>
            + New task
          </button>
        </div>
      </div>

      {banner && (
        <div style={{ marginTop: 12, padding: 10, border: "1px solid #f3d1d1", background: "#fff5f5", borderRadius: 12 }}>
          <b>Note:</b> {banner}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
        <label>
          Team:&nbsp;
          <select
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            disabled={teams.length === 0}
            title="Used for 'Selected team' scope and default team in New Task"
          >
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          Scope:&nbsp;
          <select value={scope} onChange={(e) => setScope(e.target.value as ScopeMode)}>
            <option value="team">Selected team</option>
            <option value="all">All teams</option>
          </select>
        </label>

        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          View:&nbsp;
          <select value={viewMode} onChange={(e) => setViewMode(e.target.value as ViewMode)}>
            <option value="week">Week</option>
            <option value="month">Month</option>
          </select>
        </label>

        <button onClick={goPrev}>◀</button>
        <button onClick={goToday}>Today</button>
        <button onClick={goNext}>▶</button>

        <div style={{ fontWeight: 900 }}>{headerLabel}</div>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
        <label style={{ fontSize: 13, color: "#444" }}>
          Filter person:&nbsp;
          <select value={personFilter} onChange={(e) => setPersonFilter(e.target.value)}>
            <option value="all">All</option>
            {peopleOptionsForFilter.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <label style={{ fontSize: 13, color: "#444" }}>
          Filter status:&nbsp;
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14, marginTop: 14 }}>
        {/* Schedule */}
        <section style={{ border: "1px solid #ddd", borderRadius: 16, padding: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <h2 style={{ fontSize: 16, fontWeight: 900, margin: 0 }}>
              {scope === "all" ? "Overview (all teams)" : "Schedule"}
            </h2>
            <span style={{ fontSize: 12, color: "#666" }}>
              Click day header to add • click a task to edit
            </span>
          </div>

          {viewMode === "week" ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8, marginTop: 10 }}>
              {weekDays.map((d) => {
                if (scope === "team") {
                  const dayTasks = tasksForDay(d);
                  return (
                    <div key={d.toISOString()} style={cardCol}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <button onClick={() => openCreate(d)} style={dayHeaderBtn} title="Add task on this day">
                          {format(d, "EEE dd")}
                        </button>
                        <span style={{ fontSize: 12, color: "#666" }}>{dayTasks.length}</span>
                      </div>

                      {dayTasks.map((t) => (
                        <TaskPill key={t.id} task={t} onClick={() => openEdit(t)} />
                      ))}

                      {dayTasks.length === 0 && <div style={{ color: "#777", fontSize: 13 }}>No tasks</div>}
                    </div>
                  );
                }

                // All teams: grouped
                const groups = groupedTasksForDay(d);
                const total = groups.reduce((acc, g) => acc + g.tasks.length, 0);

                return (
                  <div key={d.toISOString()} style={cardCol}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <button onClick={() => openCreate(d)} style={dayHeaderBtn} title="Add task on this day">
                        {format(d, "EEE dd")}
                      </button>
                      <span style={{ fontSize: 12, color: "#666" }}>{total}</span>
                    </div>

                    {groups.map((g) => (
                      <div key={g.teamId} style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 12, fontWeight: 900, color: "#666", marginBottom: 6 }}>
                          {g.teamName}
                        </div>
                        {g.tasks.map((t) => (
                          <TaskPill key={t.id} task={t} onClick={() => openEdit(t)} />
                        ))}
                      </div>
                    ))}

                    {total === 0 && <div style={{ color: "#777", fontSize: 13 }}>No tasks</div>}
                  </div>
                );
              })}
            </div>
          ) : (
            <>
              {/* Month header */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8, marginTop: 10 }}>
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                  <div key={d} style={{ fontSize: 12, fontWeight: 900, color: "#666", paddingLeft: 4 }}>
                    {d}
                  </div>
                ))}
              </div>

              {/* Month grid */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8, marginTop: 8 }}>
                {monthCells.map((d, idx) => {
                  const inMonth = d.getMonth() === monthStart.getMonth();
                  const list = tasksForDay(d);

                  if (scope === "team") {
                    const maxShow = 4;
                    return (
                      <div
                        key={`${d.toISOString()}_${idx}`}
                        style={{ ...cardCol, minHeight: 160, opacity: inMonth ? 1 : 0.55 }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                          <button onClick={() => openCreate(d)} style={dayHeaderBtn} title="Add task on this day">
                            {format(d, "d")}
                          </button>
                          <span style={{ fontSize: 12, color: "#666" }}>{list.length}</span>
                        </div>

                        {list.slice(0, maxShow).map((t) => (
                          <TaskPill key={t.id} task={t} onClick={() => openEdit(t)} compact />
                        ))}

                        {list.length > maxShow && (
                          <div style={{ fontSize: 12, color: "#666" }}>+{list.length - maxShow} more</div>
                        )}

                        {list.length === 0 && <div style={{ color: "#777", fontSize: 12 }}>—</div>}
                      </div>
                    );
                  }

                  // All teams: show up to N per team for readability
                  const groups = groupedTasksForDay(d);
                  const total = groups.reduce((acc, g) => acc + g.tasks.length, 0);
                  const maxTeamsShow = 3;
                  const maxPerTeam = 2;

                  return (
                    <div
                      key={`${d.toISOString()}_${idx}`}
                      style={{ ...cardCol, minHeight: 160, opacity: inMonth ? 1 : 0.55 }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <button onClick={() => openCreate(d)} style={dayHeaderBtn} title="Add task on this day">
                          {format(d, "d")}
                        </button>
                        <span style={{ fontSize: 12, color: "#666" }}>{total}</span>
                      </div>

                      {groups.slice(0, maxTeamsShow).map((g) => (
                        <div key={g.teamId} style={{ marginBottom: 8 }}>
                          <div style={{ fontSize: 11, fontWeight: 900, color: "#666", marginBottom: 4 }}>
                            {g.teamName}
                          </div>
                          {g.tasks.slice(0, maxPerTeam).map((t) => (
                            <TaskPill key={t.id} task={t} onClick={() => openEdit(t)} compact />
                          ))}
                          {g.tasks.length > maxPerTeam && (
                            <div style={{ fontSize: 11, color: "#666" }}>+{g.tasks.length - maxPerTeam}</div>
                          )}
                        </div>
                      ))}

                      {groups.length > maxTeamsShow && (
                        <div style={{ fontSize: 12, color: "#666" }}>
                          +{groups.length - maxTeamsShow} teams
                        </div>
                      )}

                      {total === 0 && <div style={{ color: "#777", fontSize: 12 }}>—</div>}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>

        {/* Sidebar */}
        <section style={{ border: "1px solid #ddd", borderRadius: 16, padding: 12 }}>
          <h2 style={{ fontSize: 16, fontWeight: 900, margin: 0 }}>
            {scope === "team" ? "Who’s free" : "Overview notes"}
          </h2>

          {scope === "team" ? (
            <>
              <div style={{ fontSize: 13, color: "#666", marginTop: 6, marginBottom: 10 }}>
                Sorted by least scheduled hours in the current window.
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {availability.map((a: any) => (
                  <div key={a.person_id} style={{ border: "1px solid #eee", borderRadius: 14, padding: 10 }}>
                    <div style={{ fontWeight: 900 }}>{a.name}</div>
                    <div style={{ fontSize: 13 }}>
                      Scheduled: <b>{Number(a.scheduled_hours).toFixed(2)}h</b> • Daily cap: {a.daily_capacity_hours}h
                    </div>
                  </div>
                ))}
                {availability.length === 0 && (
                  <div style={{ color: "#777", fontSize: 13 }}>No people found for this team.</div>
                )}
              </div>
            </>
          ) : (
            <div style={{ marginTop: 10, fontSize: 13, color: "#666", lineHeight: 1.4 }}>
              You’re in <b>All teams</b> scope.
              <ul style={{ marginTop: 8 }}>
                <li>Tasks are grouped by team inside each day.</li>
                <li>Use filters to narrow by person/status.</li>
                <li>For capacity (“who’s free”), switch scope back to <b>Selected team</b>.</li>
              </ul>
            </div>
          )}
        </section>
      </div>

      {/* Modal */}
      {modalOpen && (
        <div onClick={() => setModalOpen(false)} style={modalBackdrop}>
          <div onClick={(e) => e.stopPropagation()} style={modalCard}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
              <div>
                <div style={{ fontWeight: 900, fontSize: 16 }}>
                  {editing ? "Edit task" : "New task"}
                </div>
                <div style={{ color: "#666", fontSize: 12 }}>
                  Times render in your browser timezone.
                </div>
              </div>
              <button onClick={() => setModalOpen(false)}>✕</button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, marginTop: 12 }}>
              {/* Left */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <label style={{ fontSize: 13 }}>
                  Team
                  <select
                    value={fTeamId}
                    onChange={async (e) => {
                      const id = e.target.value;
                      setFTeamId(id);
                      setFAssignees([]);
                      setConflicts({});
                      await syncPeopleForFormTeam(id);
                    }}
                    style={inputStyle as any}
                    disabled={!!editing} // keep team fixed on edit (safe default)
                    title={editing ? "Team is fixed for existing tasks." : "Choose which team owns this task."}
                  >
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label style={{ fontSize: 13 }}>
                  Task name
                  <input value={fTitle} onChange={(e) => setFTitle(e.target.value)} style={inputStyle} />
                </label>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <label style={{ fontSize: 13 }}>
                    Start
                    <input
                      type="datetime-local"
                      value={fStart}
                      onChange={(e) => setFStart(e.target.value)}
                      style={inputStyle}
                    />
                  </label>
                  <label style={{ fontSize: 13 }}>
                    End
                    <input
                      type="datetime-local"
                      value={fEnd}
                      onChange={(e) => setFEnd(e.target.value)}
                      style={inputStyle}
                    />
                  </label>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button onClick={() => applyPreset("hourly")}>1h</button>
                  <button onClick={() => applyPreset("half_day")}>Half-day</button>
                  <button onClick={() => applyPreset("full_day")}>Full-day</button>
                  <button onClick={() => setFSize("custom")}>Custom</button>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <label style={{ fontSize: 13 }}>
                    Task size
                    <select value={fSize} onChange={(e) => setFSize(e.target.value as any)} style={inputStyle as any}>
                      {TASK_SIZES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label style={{ fontSize: 13 }}>
                    Status
                    <select value={fStatus} onChange={(e) => setFStatus(e.target.value as any)} style={inputStyle as any}>
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label style={{ fontSize: 13 }}>
                  Notes
                  <textarea
                    value={fNotes}
                    onChange={(e) => setFNotes(e.target.value)}
                    style={{ ...inputStyle, minHeight: 90 }}
                  />
                </label>
              </div>

              {/* Right */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontWeight: 900, fontSize: 13 }}>Assignees (team members)</div>

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    maxHeight: 260,
                    overflow: "auto",
                    border: "1px solid #eee",
                    borderRadius: 12,
                    padding: 10,
                  }}
                >
                  {peopleForFormTeam.map((p) => {
                    const checked = fAssignees.includes(p.id);
                    return (
                      <label key={p.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) setFAssignees((prev) => [...prev, p.id]);
                            else setFAssignees((prev) => prev.filter((x) => x !== p.id));
                          }}
                        />
                        <span>{p.name}</span>
                      </label>
                    );
                  })}
                  {peopleForFormTeam.length === 0 && (
                    <div style={{ fontSize: 13, color: "#777" }}>
                      No members found for this team. Add/assign people in <a href="./admin/">Admin</a>.
                    </div>
                  )}
                </div>

                <button onClick={checkConflicts} disabled={checkingConflicts}>
                  {checkingConflicts ? "Checking…" : "Check conflicts"}
                </button>

                {Object.keys(conflicts).length > 0 && (
                  <div style={{ border: "1px solid #f3d1d1", background: "#fff5f5", borderRadius: 12, padding: 10 }}>
                    <div style={{ fontWeight: 900, fontSize: 13, marginBottom: 6 }}>Potential conflicts</div>
                    {Object.entries(conflicts).map(([pid, list]) => {
                      const personName = peopleAll.find((p) => p.id === pid)?.name ?? pid;
                      return (
                        <div key={pid} style={{ marginBottom: 8 }}>
                          <div style={{ fontWeight: 900, fontSize: 13 }}>{personName}</div>
                          <ul style={{ margin: "6px 0 0 18px", padding: 0, fontSize: 12, color: "#555" }}>
                            {(list as any[]).slice(0, 6).map((x, i) => (
                              <li key={i}>
                                {x.title} ({format(new Date(x.start_at), "dd MMM HH:mm")}–{format(new Date(x.end_at), "HH:mm")})
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                    <div style={{ fontSize: 12, color: "#666" }}>Warning only (save is allowed).</div>
                  </div>
                )}

                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
                  {editing && (
                    <button onClick={() => onDelete(editing.id)} style={{ borderColor: "#f3d1d1" }}>
                      Delete
                    </button>
                  )}
                  <button onClick={() => setModalOpen(false)}>Cancel</button>
                  <button onClick={onSave} style={{ fontWeight: 900 }}>
                    Save
                  </button>
                </div>
              </div>
            </div>

            <div style={{ marginTop: 10, color: "#666", fontSize: 12 }}>
              If conflict checking shows nothing, your optional RPC <code>get_person_tasks_in_window</code> may not exist yet — app still works.
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function TaskPill({ task, onClick, compact }: { task: any; onClick: () => void; compact?: boolean }) {
  const start = new Date(task.start_at);
  const end = new Date(task.end_at);

  const who = (task.assignees ?? []).map((a: any) => a.name).join(", ");
  const subtitle = compact
    ? `${format(start, "HH:mm")}`
    : `${format(start, "HH:mm")}–${format(end, "HH:mm")} • ${task.task_size} • ${task.status}`;

  return (
    <div
      onClick={onClick}
      style={{
        border: "1px solid #ddd",
        borderRadius: 12,
        padding: compact ? "6px 8px" : "10px",
        marginBottom: 8,
        cursor: "pointer",
      }}
      title="Click to edit"
    >
      <div
        style={{
          fontWeight: 900,
          fontSize: compact ? 12 : 13,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {task.title}
      </div>
      <div style={{ fontSize: 12, color: "#555", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {subtitle}
      </div>
      {!compact && (
        <div style={{ fontSize: 12, color: "#555", marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {who || "Unassigned"}
        </div>
      )}
    </div>
  );
}

const cardCol: React.CSSProperties = {
  border: "1px solid #eee",
  borderRadius: 16,
  padding: 8,
  minHeight: 190,
};

const dayHeaderBtn: React.CSSProperties = {
  fontWeight: 900,
  border: "none",
  background: "transparent",
  padding: 0,
  cursor: "pointer",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 10px",
  borderRadius: 12,
  border: "1px solid #ddd",
  outline: "none",
  marginTop: 6,
  fontSize: 14,
};

const modalBackdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.35)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
};

const modalCard: React.CSSProperties = {
  width: "min(980px, 100%)",
  background: "white",
  borderRadius: 18,
  border: "1px solid #ddd",
  padding: 14,
};
