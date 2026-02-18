"use client";

import { useEffect, useMemo, useState } from "react";
import { addDays, format, startOfWeek } from "date-fns";
import {
  createTask,
  deleteTask,
  fetchPeopleForTeam,
  fetchTasksForTeam,
  fetchTeams,
  getAvailability,
  getPersonTasksInWindow,
  updateTask
} from "../lib/api";

type Team = { id: string; name: string };
type Person = { id: string; name: string; daily_capacity_hours: number };
type Task = any;

function iso(d: Date) { return d.toISOString(); }

// Converts <input type="datetime-local"> value to ISO in browser local timezone
function dtLocalToIso(v: string) {
  // v like "2026-02-18T09:00"
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

const TASK_SIZES = ["hourly", "half_day", "full_day", "custom"] as const;
const STATUSES = ["planned", "in_progress", "done", "cancelled"] as const;

export default function Page() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState<string>("");

  const [people, setPeople] = useState<Person[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [availability, setAvailability] = useState<any[]>([]);
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date(), { weekStartsOn: 1 })); // Monday
  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState<string>("");

  // Filters
  const [personFilter, setPersonFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);

  // Form fields
  const [fTitle, setFTitle] = useState("");
  const [fStart, setFStart] = useState("");
  const [fEnd, setFEnd] = useState("");
  const [fSize, setFSize] = useState<(typeof TASK_SIZES)[number]>("hourly");
  const [fStatus, setFStatus] = useState<(typeof STATUSES)[number]>("planned");
  const [fNotes, setFNotes] = useState("");
  const [fAssignees, setFAssignees] = useState<string[]>([]);

  const [conflicts, setConflicts] = useState<Record<string, any[]>>({}); // personId -> conflicts list
  const [checkingConflicts, setCheckingConflicts] = useState(false);

  async function loadAll(tid: string, ws = weekStart, we = weekEnd) {
    setLoading(true);
    setBanner("");
    try {
      const [ppl, tsk, avail] = await Promise.all([
        fetchPeopleForTeam(tid),
        fetchTasksForTeam(tid, iso(ws), iso(we)),
        getAvailability(tid, iso(ws), iso(we))
      ]);
      setPeople(ppl);
      setTasks(tsk);
      setAvailability(avail);
    } catch (e: any) {
      setBanner(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchTeams()
      .then(ts => {
        setTeams(ts);
        if (ts[0]) setTeamId(ts[0].id);
      })
      .catch(e => setBanner(e?.message ?? String(e)));
  }, []);

  useEffect(() => {
    if (!teamId) return;
    loadAll(teamId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, weekStart]);

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

  function openCreate(prefillDay?: Date) {
    setEditing(null);
    setFTitle("");
    const start = prefillDay ? new Date(prefillDay) : new Date(weekStart);
    start.setHours(9, 0, 0, 0);
    const end = new Date(start);
    end.setHours(10, 0, 0, 0);
    setFStart(isoToDtLocal(start.toISOString()));
    setFEnd(isoToDtLocal(end.toISOString()));
    setFSize("hourly");
    setFStatus("planned");
    setFNotes("");
    setFAssignees([]);
    setConflicts({});
    setModalOpen(true);
  }

  function openEdit(task: Task) {
    setEditing(task);
    setFTitle(task.title ?? "");
    setFStart(isoToDtLocal(task.start_at));
    setFEnd(isoToDtLocal(task.end_at));
    setFSize((task.task_size ?? "custom") as any);
    setFStatus((task.status ?? "planned") as any);
    setFNotes(task.notes ?? "");
    setFAssignees((task.assignees ?? []).map((a: any) => a.person_id));
    setConflicts({});
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
    // Requires get_person_tasks_in_window RPC. If it doesn't exist, function returns null.
    setCheckingConflicts(true);
    try {
      const ws = dtLocalToIso(fStart);
      const we = dtLocalToIso(fEnd);
      const results: Record<string, any[]> = {};

      for (const pid of fAssignees) {
        const list = await getPersonTasksInWindow(pid, ws, we);
        if (!list) continue;

        // filter out the task currently being edited
        const filtered = list.filter((x: any) => x.task_id !== editing?.id);

        // only flag if overlap exists
        if (filtered.length) results[pid] = filtered;
      }
      setConflicts(results);
    } finally {
      setCheckingConflicts(false);
    }
  }

  async function onSave() {
    setBanner("");
    if (!teamId) return;
    if (!fTitle.trim()) return setBanner("Task title is required.");
    if (!fStart || !fEnd) return setBanner("Start and End are required.");

    const startISO = dtLocalToIso(fStart);
    const endISO = dtLocalToIso(fEnd);
    if (new Date(endISO) <= new Date(startISO)) return setBanner("End must be after Start.");

    // Soft conflict warning (does not block save)
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
          team_id: teamId,
          start_at: startISO,
          end_at: endISO,
          task_size: fSize,
          status: fStatus,
          notes: fNotes,
          assigneeIds: fAssignees
        });
      }

      setModalOpen(false);
      await loadAll(teamId);
    } catch (e: any) {
      setBanner(e?.message ?? String(e));
    }
  }

  async function onDelete(taskId: string) {
    if (!confirm("Delete this task?")) return;
    setBanner("");
    try {
      await deleteTask(taskId);
      await loadAll(teamId);
    } catch (e: any) {
      setBanner(e?.message ?? String(e));
    }
  }

  return (
    <main style={{ padding: 16, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>VT Multi-Team Scheduler</h1>
        <span style={{ color: "#666", fontSize: 13 }}>
          (static GitHub Pages UI + Supabase)
        </span>
      </div>

      {banner && (
        <div style={{ marginTop: 12, padding: 10, border: "1px solid #f3d1d1", background: "#fff5f5", borderRadius: 10 }}>
          <b>Note:</b> {banner}
        </div>
      )}

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
        <label>
          Team:&nbsp;
          <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>

        <button onClick={() => setWeekStart(addDays(weekStart, -7))}>◀ Prev week</button>
        <div style={{ fontWeight: 700 }}>
          {format(weekStart, "dd MMM yyyy")} – {format(addDays(weekStart, 6), "dd MMM yyyy")}
        </div>
        <button onClick={() => setWeekStart(addDays(weekStart, 7))}>Next week ▶</button>

        <button onClick={() => openCreate()} style={{ marginLeft: "auto" }}>
          + New task
        </button>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10 }}>
        <label style={{ fontSize: 13, color: "#444" }}>
          Filter person:&nbsp;
          <select value={personFilter} onChange={(e) => setPersonFilter(e.target.value)}>
            <option value="all">All</option>
            {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>

        <label style={{ fontSize: 13, color: "#444" }}>
          Filter status:&nbsp;
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All</option>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>

        {loading && <span style={{ color: "#666", fontSize: 13 }}>Loading…</span>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14, marginTop: 14 }}>
        {/* Schedule */}
        <section style={{ border: "1px solid #ddd", borderRadius: 14, padding: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <h2 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>Week schedule</h2>
            <span style={{ fontSize: 12, color: "#666" }}>
              Click a task to edit. Click day header to add.
            </span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8, marginTop: 10 }}>
            {days.map(d => {
              const dayTasks = filteredTasks.filter(t => new Date(t.start_at).toDateString() === d.toDateString());
              return (
                <div key={d.toISOString()} style={{ border: "1px solid #eee", borderRadius: 14, padding: 8, minHeight: 180 }}>
                  <div
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}
                  >
                    <button
                      onClick={() => openCreate(d)}
                      style={{ fontWeight: 800, border: "none", background: "transparent", padding: 0, cursor: "pointer" }}
                      title="Add task on this day"
                    >
                      {format(d, "EEE dd")}
                    </button>
                    <span style={{ fontSize: 12, color: "#666" }}>{dayTasks.length}</span>
                  </div>

                  {dayTasks.map(t => (
                    <div
                      key={t.id}
                      onClick={() => openEdit(t)}
                      style={{
                        border: "1px solid #ddd",
                        borderRadius: 12,
                        padding: 10,
                        marginBottom: 8,
                        cursor: "pointer"
                      }}
                      title="Click to edit"
                    >
                      <div style={{ fontWeight: 800 }}>{t.title}</div>
                      <div style={{ fontSize: 12, color: "#555" }}>
                        {format(new Date(t.start_at), "HH:mm")}–{format(new Date(t.end_at), "HH:mm")}
                        {" • "}{t.task_size}{" • "}{t.status}
                      </div>
                      <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>
                        {(t.assignees ?? []).map((a: any) => a.name).join(", ") || "Unassigned"}
                      </div>
                    </div>
                  ))}

                  {dayTasks.length === 0 && <div style={{ color: "#777", fontSize: 13 }}>No tasks</div>}
                </div>
              );
            })}
          </div>
        </section>

        {/* Who's free */}
        <section style={{ border: "1px solid #ddd", borderRadius: 14, padding: 12 }}>
          <h2 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>Who’s free (this week)</h2>
          <div style={{ fontSize: 13, color: "#666", marginTop: 6, marginBottom: 10 }}>
            Sorted by least scheduled hours (selected team + week).
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {availability.map((a: any) => (
              <div key={a.person_id} style={{ border: "1px solid #eee", borderRadius: 14, padding: 10 }}>
                <div style={{ fontWeight: 800 }}>{a.name}</div>
                <div style={{ fontSize: 13 }}>
                  Scheduled: <b>{Number(a.scheduled_hours).toFixed(2)}h</b> • Daily cap: {a.daily_capacity_hours}h
                </div>
              </div>
            ))}
            {availability.length === 0 && <div style={{ color: "#777", fontSize: 13 }}>No people found for this team.</div>}
          </div>
        </section>
      </div>

      {/* Modal */}
      {modalOpen && (
        <div
          onClick={() => setModalOpen(false)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: 16
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "min(780px, 100%)", background: "white", borderRadius: 16, border: "1px solid #ddd", padding: 14 }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
              <div>
                <div style={{ fontWeight: 900, fontSize: 16 }}>
                  {editing ? "Edit task" : "New task"}
                </div>
                <div style={{ color: "#666", fontSize: 12 }}>
                  Times use your browser timezone (Perth will display correctly on Perth machines).
                </div>
              </div>
              <button onClick={() => setModalOpen(false)}>✕</button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, marginTop: 12 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <label style={{ fontSize: 13 }}>
                  Task name
                  <input value={fTitle} onChange={(e) => setFTitle(e.target.value)} style={inputStyle} />
                </label>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <label style={{ fontSize: 13 }}>
                    Start
                    <input type="datetime-local" value={fStart} onChange={(e) => setFStart(e.target.value)} style={inputStyle} />
                  </label>
                  <label style={{ fontSize: 13 }}>
                    End
                    <input type="datetime-local" value={fEnd} onChange={(e) => setFEnd(e.target.value)} style={inputStyle} />
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
                      {TASK_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>

                  <label style={{ fontSize: 13 }}>
                    Status
                    <select value={fStatus} onChange={(e) => setFStatus(e.target.value as any)} style={inputStyle as any}>
                      {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                </div>

                <label style={{ fontSize: 13 }}>
                  Notes
                  <textarea value={fNotes} onChange={(e) => setFNotes(e.target.value)} style={{ ...inputStyle, minHeight: 80 }} />
                </label>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontWeight: 900, fontSize: 13 }}>Assignees</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 240, overflow: "auto", border: "1px solid #eee", borderRadius: 12, padding: 10 }}>
                  {people.map(p => {
                    const checked = fAssignees.includes(p.id);
                    return (
                      <label key={p.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) setFAssignees(prev => [...prev, p.id]);
                            else setFAssignees(prev => prev.filter(x => x !== p.id));
                          }}
                        />
                        <span>{p.name}</span>
                      </label>
                    );
                  })}
                  {people.length === 0 && <div style={{ fontSize: 13, color: "#777" }}>No people linked to this team.</div>}
                </div>

                <button onClick={checkConflicts} disabled={checkingConflicts}>
                  {checkingConflicts ? "Checking…" : "Check conflicts"}
                </button>

                {Object.keys(conflicts).length > 0 && (
                  <div style={{ border: "1px solid #f3d1d1", background: "#fff5f5", borderRadius: 12, padding: 10 }}>
                    <div style={{ fontWeight: 900, fontSize: 13, marginBottom: 6 }}>Potential conflicts</div>
                    {Object.entries(conflicts).map(([pid, list]) => {
                      const personName = people.find(p => p.id === pid)?.name ?? pid;
                      return (
                        <div key={pid} style={{ marginBottom: 8 }}>
                          <div style={{ fontWeight: 800, fontSize: 13 }}>{personName}</div>
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
                    <div style={{ fontSize: 12, color: "#666" }}>
                      This is a warning only (save is allowed).
                    </div>
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

          </div>
        </div>
      )}

      <div style={{ marginTop: 14, color: "#666", fontSize: 12 }}>
        Tip: If conflict checking shows nothing, it likely means the optional RPC <code>get_person_tasks_in_window</code> isn’t created yet — the app will still work without it.
      </div>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 10px",
  borderRadius: 12,
  border: "1px solid #ddd",
  outline: "none",
  marginTop: 6,
  fontSize: 14
};
