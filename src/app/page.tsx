"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addDays,
  addMonths,
  endOfMonth,
  format,
  startOfMonth,
  startOfWeek,
  subMonths
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
  type Team,
  type Person
} from "../lib/api";

type ViewMode = "week" | "month";
type ScopeMode = "team" | "all";
type Task = any;

const TASK_SIZES = ["hourly", "half_day", "full_day", "custom"] as const;
const STATUSES = ["planned", "in_progress", "done", "cancelled"] as const;

function iso(d: Date) { return d.toISOString(); }
function dtLocalToIso(v: string) { return new Date(v).toISOString(); }
function isoToDtLocal(isoStr: string) {
  const d = new Date(isoStr);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function sameDay(a: Date, b: Date) { return a.toDateString() === b.toDateString(); }

export default function Page() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState("");

  const [scope, setScope] = useState<ScopeMode>("team");
  const [viewMode, setViewMode] = useState<ViewMode>("week");

  const [peopleAll, setPeopleAll] = useState<Person[]>([]);
  const [peopleForTeam, setPeopleForTeam] = useState<Person[]>([]);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [availability, setAvailability] = useStateny[]>([]);

  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [monthAnchor, setMonthAnchor] = useState<Date>(() => startOfMonth(new Date()));

  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState("");

  const [personFilter, setPersonFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);

  const [fTeamId, setFTeamId] = useState("");
  const [fTitle, setFTitle] = useState("");
  const [fStart, setFStart] = useState("");
  const [fEnd, setFEnd] = useState("");
  const [fSize, setFSize] = useState<(typeof TASK_SIZES)[number]>("hourly");
  const [fStatus, setFStatus] = useState<(typeof STATUSES)[number]>("planned");
  const [fNotes, setFNotes] = useState("");
  const [fAssignees, setFAssignees] = useState<string[]>([]);
  const [peopleForFormTeam, setPeopleForFormTeam] = useState<Person[]>([]);

  const [conflicts, setConflicts] = useState<Record<string, any[]>>({});
  const [checkingConflicts, setCheckingConflicts] = useState(false);

  const teamNameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const t of teams) m[t.id] = t.name;
    return m;
  }, [teams]);

  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const monthStart = useMemo(() => startOfMonth(monthAnchor), [monthAnchor]);
  const monthGridStart = useMemo(() => startOfWeek(monthStart, { weekStartsOn: 1 }), [monthStart]);
  const monthCells = useMemo(() => Array.from({ length: 42 }, (_, i) => addDays(monthGridStart, i)), [monthGridStart]);

  const windowStart = useMemo(() => (viewMode === "week" ? weekStart : monthGridStart), [viewMode, weekStart, monthGridStart]);
  const windowEnd = useMemo(() => (viewMode === "week" ? weekEnd : addDays(monthGridStart, 42)), [viewMode, weekEnd, monthGridStart]);

  const peopleOptionsForFilter = useMemo(() => (scope === "all" ? peopleAll : peopleForTeam), [scope, peopleAll, peopleForTeam]);

  // Initial load
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

  // Selected team people
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
      const ids = scope === "all" ? teams.map(t => t.id) : [teamId];

      const tsk =
        scope === "all"
          ? await fetchTasksForTeams(ids, iso(windowStart), iso(windowEnd))
          : await fetchTasksForTeam(teamId, iso(windowStart), iso(windowEnd));

      setTasks(tsk);

      if (scope === "team") {
        const avail = await getAvailability(teamId, iso(windowStart), iso(windowEnd));
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

  useEffect(() => {
    if (!teamId) return;
    if (scope === "all" && teams.length === 0) return;
    loadWindow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, scope, viewMode, weekStart, monthAnchor, teams.length]);

  const filteredTasks = useMemo(() => {
    return (tasks ?? []).filter(t => {
      const statusOk = statusFilter === "all" ? true : t.status === statusFilter;
      const personOk =
        personFilter === "all"
          ? true
          : (t.assignees ?? []).some((a: any) => a.person_id === personFilter);
      return statusOk && personOk;
    });
  }, [tasks, personFilter, statusFilter]);

  function tasksForDay(d: Date) {
    return filteredTasks
      .filter(t => sameDay(new Date(t.start_at), d))
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
    const orderedTeamIds = Object.keys(groups).sort((a, b) => (teamNameById[a] ?? a).localeCompare(teamNameById[b] ?? b));
    return orderedTeamIds.map(tid => ({ teamId: tid, teamName: teamNameById[tid] ?? tid, tasks: groups[tid] }));
  }

  async function syncPeopleForFormTeam(tid: string) {
    try {
      const ppl = await fetchPeopleForTeam(tid);
      setPeopleForFormTeam(ppl);
    } catch {
      setPeopleForFormTeam([]);
    }
  }

  function openCreate(prefillDay?: Date) {
    setEditing(null);
    setConflicts({});
    setFAssignees([]);
    setFNotes("");
    setFTitle("");

    const chosenTeam = teamId;
    setFTeamId(chosenTeam);
    syncPeopleForFormTeam(chosenTeam);

    const start = prefillDay ? new Date(prefillDay) : new Date(windowStart);
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

    const tid = task.team_id ?? teamId;
    setFTeamId(tid);
    syncPeopleForFormTeam(tid);

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

    await checkConflicts();

    try {
      if (editing) {
        await updateTask(editing.id, {
          title: fTitle.trim(),
          start_at: startISO,
          end_at: endISO,
          task_size: fSize,
          status: fStatus,
          notes: fNotes,
          assigneeIds: fAssignees
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
          assigneeIds: fAssignees
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
    <div className="container">
      <div className="topbar">
        <div className="brand">
          <h1>VT Multi-Team Scheduler</h1>
          <div className="sub">
            Overview + team calendars •{" "}
            <a
  href="#"
  onClick={(e) => {
    e.preventDefault();
    window.location.href = "./admin/?v=" + Date.now();
  }}
>
  Admin (people/teams)
</a>
          </div>
        </div>

        <div className="nav">
          <span className="pill">{loading ? "Loading…" : "Ready"}</span>
          <button className="btn primary" onClick={() => openCreate()}>
            + New task
          </button>
        </div>
      </div>

      {banner && <div className="banner">{banner}</div>}

      <div className="card">
        <div className="card-body">
          <div className="row">
            <label className="label" style={{ minWidth: 220 }}>
              Team
              <select className="select" value={teamId} onChange={e => setTeamId(e.target.value)}>
                {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>

            <label className="label" style={{ minWidth: 180 }}>
              Scope
              <select className="select" value={scope} onChange={e => setScope(e.target.value as ScopeMode)}>
                <option value="team">Selected team</option>
                <option value="all">All teams</option>
              </select>
            </label>

            <label className="label" style={{ minWidth: 160 }}>
              View
              <select className="select" value={viewMode} onChange={e => setViewMode(e.target.value as ViewMode)}>
                <option value="week">Week</option>
                <option value="month">Month</option>
              </select>
            </label>

            <div className="row" style={{ marginTop: 18 }}>
              <button className="btn" onClick={goPrev}>◀</button>
              <button className="btn" onClick={goToday}>Today</button>
              <button className="btn" onClick={goNext}>▶</button>
              <span className="pill" style={{ marginLeft: 6 }}>{headerLabel}</span>
            </div>
          </div>

          <div className="row" style={{ marginTop: 10 }}>
            <label className="label" style={{ minWidth: 260 }}>
              Filter person
              <select className="select" value={personFilter} onChange={e => setPersonFilter(e.target.value)}>
                <option value="all">All</option>
                {peopleOptionsForFilter.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>

            <label className="label" style={{ minWidth: 200 }}>
              Filter status
              <select className="select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                <option value="all">All</option>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          </div>
        </div>
      </div>

      <div className="grid grid-2" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="card-header">
            <h2>{scope === "all" ? "Overall calendar (all teams)" : "Team calendar"}</h2>
            <span className="small">Click day to add • click task to edit</span>
          </div>
          <div className="card-body">
            {viewMode === "week" ? (
              <div className="dayGrid">
                {weekDays.map(d => {
                  if (scope === "team") {
                    const dayTasks = tasksForDay(d);
                    return (
                      <div key={d.toISOString()} className="dayCol">
                        <div className="dayTop">
                          <button className="dayBtn" onClick={() => openCreate(d)}>{format(d, "EEE dd")}</button>
                          <span className="count">{dayTasks.length}</span>
                        </div>
                        {dayTasks.map(t => <TaskCard key={t.id} task={t} onClick={() => openEdit(t)} />)}
                        {dayTasks.length === 0 && <div className="small">No tasks</div>}
                      </div>
                    );
                  }

                  const groups = groupedTasksForDay(d);
                  const total = groups.reduce((acc, g) => acc + g.tasks.length, 0);
                  return (
                    <div key={d.toISOString()} className="dayCol">
                      <div className="dayTop">
                        <button className="dayBtn" onClick={() => openCreate(d)}>{format(d, "EEE dd")}</button>
                        <span className="count">{total}</span>
                      </div>

                      {groups.map(g => (
                        <div key={g.teamId} style={{ marginBottom: 10 }}>
                          <div className="small" style={{ fontWeight: 900, marginBottom: 6 }}>{g.teamName}</div>
                          {g.tasks.map(t => <TaskCard key={t.id} task={t} onClick={() => openEdit(t)} />)}
                        </div>
                      ))}

                      {total === 0 && <div className="small">No tasks</div>}
                    </div>
                  );
                })}
              </div>
            ) : (
              <>
                <div className="dayGrid" style={{ marginBottom: 8 }}>
                  {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d => (
                    <div key={d} className="small" style={{ fontWeight: 900, paddingLeft: 6 }}>{d}</div>
                  ))}
                </div>

                <div className="dayGrid">
                  {monthCells.map((d, idx) => {
                    const inMonth = d.getMonth() === monthStart.getMonth();
                    const list = tasksForDay(d);

                    if (scope === "team") {
                      const maxShow = 4;
                      return (
                        <div key={`${d.toISOString()}_${idx}`} className="dayCol" style={{ opacity: inMonth ? 1 : 0.55, minHeight: 160 }}>
                          <div className="dayTop">
                            <button className="dayBtn" onClick={() => openCreate(d)}>{format(d, "d")}</button>
                            <span className="count">{list.length}</span>
                          </div>
                          {list.slice(0, maxShow).map(t => <TaskCard key={t.id} task={t} compact onClick={() => openEdit(t)} />)}
                          {list.length > maxShow && <div className="small">+{list.length - maxShow} more</div>}
                          {list.length === 0 && <div className="small">—</div>}
                        </div>
                      );
                    }

                    const groups = groupedTasksForDay(d);
                    const total = groups.reduce((acc, g) => acc + g.tasks.length, 0);
                    const maxTeamsShow = 3;
                    const maxPerTeam = 2;

                    return (
                      <div key={`${d.toISOString()}_${idx}`} className="dayCol" style={{ opacity: inMonth ? 1 : 0.55, minHeight: 160 }}>
                        <div className="dayTop">
                          <button className="dayBtn" onClick={() => openCreate(d)}>{format(d, "d")}</button>
                          <span className="count">{total}</span>
                        </div>

                        {groups.slice(0, maxTeamsShow).map(g => (
                          <div key={g.teamId} style={{ marginBottom: 8 }}>
                            <div className="small" style={{ fontWeight: 900, marginBottom: 4 }}>{g.teamName}</div>
                            {g.tasks.slice(0, maxPerTeam).map(t => (
                              <TaskCard key={t.id} task={t} compact onClick={() => openEdit(t)} />
                            ))}
                            {g.tasks.length > maxPerTeam && <div className="small">+{g.tasks.length - maxPerTeam}</div>}
                          </div>
                        ))}

                        {groups.length > maxTeamsShow && <div className="small">+{groups.length - maxTeamsShow} teams</div>}
                        {total === 0 && <div className="small">—</div>}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2>{scope === "team" ? "Availability" : "Overview tips"}</h2>
          </div>
          <div className="card-body">
            {scope === "team" ? (
              <>
                <div className="small" style={{ marginBottom: 10 }}>
                  “Who’s free” is calculated for the selected team in the current window.
                </div>
                {availability.map((a: any) => (
                  <div key={a.person_id} className="task" style={{ cursor: "default" }}>
                    <div className="taskTitle">{a.name}</div>
                    <div className="taskMeta">
                      Scheduled: <b>{Number(a.scheduled_hours).toFixed(2)}h</b> • Daily cap: {a.daily_capacity_hours}h
                    </div>
                  </div>
                ))}
                {availability.length === 0 && <div className="small">No people found for this team.</div>}
              </>
            ) : (
              <div className="small" style={{ lineHeight: 1.5 }}>
                You’re viewing <b>All teams</b>.
                <div className="hr" />
                Use filters (person/status) to narrow down.  
                For capacity (“who’s free”), switch scope back to <b>Selected team</b>.
              </div>
            )}
          </div>
        </div>
      </div>

      {modalOpen && (
        <div className="modalBack" onClick={() => setModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modalTop">
              <div>
                <h3>{editing ? "Edit task" : "New task"}</h3>
                <div className="small">Times use your browser timezone.</div>
              </div>
              <button className="btn ghost" onClick={() => setModalOpen(false)}>✕</button>
            </div>

            <div className="hr" />

            <div className="grid" style={{ gridTemplateColumns: "2fr 1fr" }}>
              <div className="grid" style={{ gap: 10 }}>
                <label className="label">
                  Team
                  <select
                    className="select"
                    value={fTeamId}
                    onChange={async (e) => {
                      const id = e.target.value;
                      setFTeamId(id);
                      setFAssignees([]);
                      setConflicts({});
                      await syncPeopleForFormTeam(id);
                    }}
                    disabled={!!editing}
                    title={editing ? "Team is fixed for existing tasks." : "Choose which team owns this task."}
                  >
                    {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </label>

                <label className="label">
                  Task name
                  <input className="input" value={fTitle} onChange={e => setFTitle(e.target.value)} />
                </label>

                <div className="row">
                  <label className="label" style={{ minWidth: 220 }}>
                    Start
                    <input className="input" type="datetime-local" value={fStart} onChange={e => setFStart(e.target.value)} />
                  </label>
                  <label className="label" style={{ minWidth: 220 }}>
                    End
                    <input className="input" type="datetime-local" value={fEnd} onChange={e => setFEnd(e.target.value)} />
                  </label>
                </div>

                <div className="row">
                  <button className="btn" onClick={() => applyPreset("hourly")}>1h</button>
                  <button className="btn" onClick={() => applyPreset("half_day")}>Half-day</button>
                  <button className="btn" onClick={() => applyPreset("full_day")}>Full-day</button>
                  <button className="btn" onClick={() => setFSize("custom")}>Custom</button>
                </div>

                <div className="row">
                  <label className="label" style={{ minWidth: 200 }}>
                    Task size
                    <select className="select" value={fSize} onChange={e => setFSize(e.target.value as any)}>
                      {TASK_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>

                  <label className="label" style={{ minWidth: 200 }}>
                    Status
                    <select className="select" value={fStatus} onChange={e => setFStatus(e.target.value as any)}>
                      {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                </div>

                <label className="label">
                  Notes
                  <textarea className="textarea" value={fNotes} onChange={e => setFNotes(e.target.value)} />
                </label>
              </div>

              <div className="grid" style={{ gap: 10 }}>
                <div className="small" style={{ fontWeight: 900 }}>Assignees (team members)</div>

                <div className="card" style={{ padding: 10, maxHeight: 300, overflow: "auto" }}>
                  {peopleForFormTeam.map(p => {
                    const checked = fAssignees.includes(p.id);
                    return (
                      <label key={p.id} className="small" style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 0" }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) setFAssignees(prev => [...prev, p.id]);
                            else setFAssignees(prev => prev.filter(x => x !== p.id));
                          }}
                        />
                        {p.name}
                      </label>
                    );
                  })}
                  {peopleForFormTeam.length === 0 && (
                    <div className="small">
                      No members found for this team. Manage in <a href="./admin/">Admin</a>.
                    </div>
                  )}
                </div>

                <button className="btn" onClick={checkConflicts} disabled={checkingConflicts}>
                  {checkingConflicts ? "Checking…" : "Check conflicts"}
                </button>

                {Object.keys(conflicts).length > 0 && (
                  <div className="banner" style={{ borderColor: "rgba(255,77,109,0.35)" }}>
                    <div style={{ fontWeight: 900, marginBottom: 6 }}>Potential conflicts</div>
                    {Object.entries(conflicts).map(([pid, list]) => {
                      const personName = peopleAll.find(p => p.id === pid)?.name ?? pid;
                      return (
                        <div key={pid} style={{ marginBottom: 10 }}>
                          <div style={{ fontWeight: 900 }}>{personName}</div>
                          <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>
                            {(list as any[]).slice(0, 6).map((x, i) => (
                              <li key={i} className="small">
                                {x.title} ({format(new Date(x.start_at), "dd MMM HH:mm")}–{format(new Date(x.end_at), "HH:mm")})
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                    <div className="small">Warning only — save is allowed.</div>
                  </div>
                )}

                <div className="row" style={{ justifyContent: "flex-end" }}>
                  {editing && (
                    <button className="btn danger" onClick={() => onDelete(editing.id)}>
                      Delete
                    </button>
                  )}
                  <button className="btn" onClick={() => setModalOpen(false)}>Cancel</button>
                  <button className="btn primary" onClick={onSave}>Save</button>
                </div>

                <div className="small">
                  If conflict checking shows nothing, your optional RPC <code>get_person_tasks_in_window</code> may not exist yet.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TaskCard({ task, onClick, compact }: { task: any; onClick: () => void; compact?: boolean }) {
  const start = new Date(task.start_at);
  const end = new Date(task.end_at);
  const who = (task.assignees ?? []).map((a: any) => a.name).join(", ");

  return (
    <div className="task" onClick={onClick} title="Click to edit">
      <div className="taskTitle">{task.title}</div>
      <div className="taskMeta">
        {compact
          ? `${format(start, "HH:mm")} • ${task.status}`
          : `${format(start, "HH:mm")}–${format(end, "HH:mm")} • ${task.task_size} • ${task.status}`}
      </div>
      {!compact && <div className="taskMeta">{who || "Unassigned"}</div>}
    </div>
  );
}
