"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addDays,
  addMonths,
  format,
  startOfMonth,
  startOfWeek,
  subMonths
} from "date-fns";

import {
  addTeamMember,
  createPerson,
  createTeam,
  deletePerson,
  deleteTeam,
  fetchAllMembership,
  fetchAllPeople,
  fetchPeopleForTeam,
  fetchTasksForTeams,
  fetchTeams,
  removeTeamMember,
  updatePerson,
  updateTeam,
  type Person,
  type Team
} from "../../lib/api";

type Task = any;

type AdminTab = "calendar" | "people" | "teams" | "membership";
type ViewMode = "week" | "month";

function iso(d: Date) { return d.toISOString(); }
function sameDay(a: Date, b: Date) { return a.toDateString() === b.toDateString(); }

export default function AdminPage() {
  const [tab, setTab] = useState<AdminTab>("calendar");

  const [teams, setTeams] = useState<Team[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [membership, setMembership] = useState<{ team_id: string; person_id: string }[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);

  const [banner, setBanner] = useState("");
  const [loading, setLoading] = useState(false);

  // Calendar controls
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [monthAnchor, setMonthAnchor] = useState<Date>(() => startOfMonth(new Date()));

  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const monthStart = useMemo(() => startOfMonth(monthAnchor), [monthAnchor]);
  const monthGridStart = useMemo(() => startOfWeek(monthStart, { weekStartsOn: 1 }), [monthStart]);
  const monthCells = useMemo(() => Array.from({ length: 42 }, (_, i) => addDays(monthGridStart, i)), [monthGridStart]);

  const windowStart = useMemo(() => (viewMode === "week" ? weekStart : monthGridStart), [viewMode, weekStart, monthGridStart]);
  const windowEnd = useMemo(() => (viewMode === "week" ? weekEnd : addDays(monthGridStart, 42)), [viewMode, weekEnd, monthGridStart]);

  const teamNameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const t of teams) m[t.id] = t.name;
    return m;
  }, [teams]);

  // Forms: People
  const [pName, setPName] = useState("");
  const [pCap, setPCap] = useState(8);

  // Forms: Teams
  const [tName, setTName] = useState("");

  // Editing
  const [editPersonId, setEditPersonId] = useState<string | null>(null);
  const [editPersonName, setEditPersonName] = useState("");
  const [editPersonCap, setEditPersonCap] = useState(8);

  const [editTeamId, setEditTeamId] = useState<string | null>(null);
  const [editTeamName, setEditTeamName] = useState("");

  async function reloadBase() {
    setBanner("");
    try {
      const [ts, ps, ms] = await Promise.all([fetchTeams(), fetchAllPeople(), fetchAllMembership()]);
      setTeams(ts);
      setPeople(ps);
      setMembership(ms);
    } catch (e: any) {
      setBanner(e?.message ?? String(e));
    }
  }

  async function reloadCalendar() {
    if (!teams.length) return;
    setLoading(true);
    setBanner("");
    try {
      const teamIds = teams.map(t => t.id);
      const tsk = await fetchTasksForTeams(teamIds, iso(windowStart), iso(windowEnd));
      setTasks(tsk);
    } catch (e: any) {
      setBanner(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reloadBase();
  }, []);

  useEffect(() => {
    reloadCalendar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teams.length, viewMode, weekStart, monthAnchor]);

  function isMember(teamId: string, personId: string) {
    return membership.some(m => m.team_id === teamId && m.person_id === personId);
  }

  async function toggleMember(teamId: string, personId: string, want: boolean) {
    setBanner("");
    // optimistic
    setMembership(prev => {
      if (want) return [...prev, { team_id: teamId, person_id: personId }];
      return prev.filter(m => !(m.team_id === teamId && m.person_id === personId));
    });

    try {
      if (want) await addTeamMember(teamId, personId);
      else await removeTeamMember(teamId, personId);
    } catch (e: any) {
      // revert
      await reloadBase();
      setBanner(e?.message ?? String(e));
    }
  }

  function tasksForDay(d: Date) {
    return (tasks ?? []).filter(t => sameDay(new Date(t.start_at), d));
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

  // People CRUD
  async function onAddPerson() {
    setBanner("");
    const name = pName.trim();
    if (!name) return setBanner("Person name is required.");
    try {
      await createPerson({ name, daily_capacity_hours: pCap });
      setPName("");
      setPCap(8);
      await reloadBase();
    } catch (e: any) {
      setBanner(e?.message ?? String(e));
    }
  }

  function startEditPerson(p: Person) {
    setEditPersonId(p.id);
    setEditPersonName(p.name);
    setEditPersonCap(p.daily_capacity_hours ?? 8);
  }

  async function saveEditPerson() {
    if (!editPersonId) return;
    setBanner("");
    try {
      await updatePerson(editPersonId, { name: editPersonName.trim(), daily_capacity_hours: editPersonCap });
      setEditPersonId(null);
      await reloadBase();
    } catch (e: any) {
      setBanner(e?.message ?? String(e));
    }
  }

  async function onDeletePerson(personId: string) {
    if (!confirm("Delete this person? This may fail if they are assigned to tasks.")) return;
    setBanner("");
    try {
      await deletePerson(personId);
      await reloadBase();
    } catch (e: any) {
      setBanner(e?.message ?? String(e));
    }
  }

  // Team CRUD
  async function onAddTeam() {
    setBanner("");
    const name = tName.trim();
    if (!name) return setBanner("Team name is required.");
    try {
      await createTeam({ name });
      setTName("");
      await reloadBase();
    } catch (e: any) {
      setBanner(e?.message ?? String(e));
    }
  }

  function startEditTeam(t: Team) {
    setEditTeamId(t.id);
    setEditTeamName(t.name);
  }

  async function saveEditTeam() {
    if (!editTeamId) return;
    setBanner("");
    try {
      await updateTeam(editTeamId, { name: editTeamName.trim() });
      setEditTeamId(null);
      await reloadBase();
    } catch (e: any) {
      setBanner(e?.message ?? String(e));
    }
  }

  async function onDeleteTeam(teamId: string) {
    if (!confirm("Delete this team? This may fail if tasks or memberships exist.")) return;
    setBanner("");
    try {
      await deleteTeam(teamId);
      await reloadBase();
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
          <h1>Admin</h1>
          <div className="sub">
            Manage people, teams, multi-team assignments •{" "}
            <a href="../">Back to scheduler</a>
          </div>
        </div>
        <div className="nav">
          <span className="pill">{loading ? "Loading…" : "Ready"}</span>
        </div>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === "calendar" ? "active" : ""}`} onClick={() => setTab("calendar")}>Overall calendar</button>
        <button className={`tab ${tab === "people" ? "active" : ""}`} onClick={() => setTab("people")}>People</button>
        <button className={`tab ${tab === "teams" ? "active" : ""}`} onClick={() => setTab("teams")}>Teams</button>
        <button className={`tab ${tab === "membership" ? "active" : ""}`} onClick={() => setTab("membership")}>Membership</button>
      </div>

      {banner && <div className="banner">{banner}</div>}

      {tab === "calendar" && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card-body">
            <div className="row">
              <label className="label" style={{ minWidth: 180 }}>
                View
                <select className="select" value={viewMode} onChange={(e) => setViewMode(e.target.value as any)}>
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

            <div className="hr" />

            {viewMode === "week" ? (
              <div className="dayGrid">
                {weekDays.map(d => {
                  const groups = groupedTasksForDay(d);
                  const total = groups.reduce((acc, g) => acc + g.tasks.length, 0);
                  return (
                    <div key={d.toISOString()} className="dayCol">
                      <div className="dayTop">
                        <div style={{ fontWeight: 900 }}>{format(d, "EEE dd")}</div>
                        <span className="count">{total}</span>
                      </div>
                      {groups.map(g => (
                        <div key={g.teamId} style={{ marginBottom: 10 }}>
                          <div className="small" style={{ fontWeight: 900, marginBottom: 6 }}>{g.teamName}</div>
                          {g.tasks.map(t => (
                            <div key={t.id} className="task" style={{ cursor: "default" }}>
                              <div className="taskTitle">{t.title}</div>
                              <div className="taskMeta">
                                {format(new Date(t.start_at), "HH:mm")}–{format(new Date(t.end_at), "HH:mm")} • {t.status}
                              </div>
                            </div>
                          ))}
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
                    const groups = groupedTasksForDay(d);
                    const total = groups.reduce((acc, g) => acc + g.tasks.length, 0);
                    const maxTeams = 3;
                    const maxPerTeam = 2;

                    return (
                      <div key={`${d.toISOString()}_${idx}`} className="dayCol" style={{ opacity: inMonth ? 1 : 0.55, minHeight: 160 }}>
                        <div className="dayTop">
                          <div style={{ fontWeight: 900 }}>{format(d, "d")}</div>
                          <span className="count">{total}</span>
                        </div>

                        {groups.slice(0, maxTeams).map(g => (
                          <div key={g.teamId} style={{ marginBottom: 8 }}>
                            <div className="small" style={{ fontWeight: 900, marginBottom: 4 }}>{g.teamName}</div>
                            {g.tasks.slice(0, maxPerTeam).map(t => (
                              <div key={t.id} className="task" style={{ padding: 8, cursor: "default" }}>
                                <div className="taskTitle">{t.title}</div>
                                <div className="taskMeta">{format(new Date(t.start_at), "HH:mm")} • {t.status}</div>
                              </div>
                            ))}
                            {g.tasks.length > maxPerTeam && <div className="small">+{g.tasks.length - maxPerTeam}</div>}
                          </div>
                        ))}
                        {groups.length > maxTeams && <div className="small">+{groups.length - maxTeams} teams</div>}
                        {total === 0 && <div className="small">—</div>}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {tab === "people" && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card-header">
            <h2>People</h2>
          </div>
          <div className="card-body">
            <div className="row">
              <label className="label" style={{ minWidth: 320 }}>
                Name
                <input className="input" value={pName} onChange={(e) => setPName(e.target.value)} placeholder="Full name" />
              </label>
              <label className="label" style={{ minWidth: 180 }}>
                Daily capacity (hours)
                <input className="input" type="number" min={1} max={24} value={pCap} onChange={(e) => setPCap(Number(e.target.value))} />
              </label>
              <button className="btn primary" style={{ marginTop: 18 }} onClick={onAddPerson}>Add person</button>
            </div>

            <div className="hr" />

            <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {people.map(p => (
                <div key={p.id} className="task" style={{ cursor: "default" }}>
                  {editPersonId === p.id ? (
                    <>
                      <label className="label">
                        Name
                        <input className="input" value={editPersonName} onChange={(e) => setEditPersonName(e.target.value)} />
                      </label>
                      <label className="label" style={{ marginTop: 8 }}>
                        Daily cap
                        <input className="input" type="number" min={1} max={24} value={editPersonCap} onChange={(e) => setEditPersonCap(Number(e.target.value))} />
                      </label>
                      <div className="row" style={{ justifyContent: "flex-end", marginTop: 10 }}>
                        <button className="btn" onClick={() => setEditPersonId(null)}>Cancel</button>
                        <button className="btn primary" onClick={saveEditPerson}>Save</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="taskTitle">{p.name}</div>
                      <div className="taskMeta">Daily cap: {p.daily_capacity_hours ?? 8}h</div>
                      <div className="row" style={{ justifyContent: "flex-end", marginTop: 10 }}>
                        <button className="btn" onClick={() => startEditPerson(p)}>Edit</button>
                        <button className="btn danger" onClick={() => onDeletePerson(p.id)}>Delete</button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === "teams" && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card-header">
            <h2>Teams</h2>
          </div>
          <div className="card-body">
            <div className="row">
              <label className="label" style={{ minWidth: 360 }}>
                Team name
                <input className="input" value={tName} onChange={(e) => setTName(e.target.value)} placeholder="e.g. Manufacturing" />
              </label>
              <button className="btn primary" style={{ marginTop: 18 }} onClick={onAddTeam}>Add team</button>
            </div>

            <div className="hr" />

            <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {teams.map(t => (
                <div key={t.id} className="task" style={{ cursor: "default" }}>
                  {editTeamId === t.id ? (
                    <>
                      <label className="label">
                        Team name
                        <input className="input" value={editTeamName} onChange={(e) => setEditTeamName(e.target.value)} />
                      </label>
                      <div className="row" style={{ justifyContent: "flex-end", marginTop: 10 }}>
                        <button className="btn" onClick={() => setEditTeamId(null)}>Cancel</button>
                        <button className="btn primary" onClick={saveEditTeam}>Save</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="taskTitle">{t.name}</div>
                      <div className="row" style={{ justifyContent: "flex-end", marginTop: 10 }}>
                        <button className="btn" onClick={() => startEditTeam(t)}>Edit</button>
                        <button className="btn danger" onClick={() => onDeleteTeam(t.id)}>Delete</button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === "membership" && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card-header">
            <h2>Membership (multi-team)</h2>
            <span className="small">Tick people into multiple teams. Saves instantly.</span>
          </div>
          <div className="card-body" style={{ overflowX: "auto" }}>
            {teams.length === 0 || people.length === 0 ? (
              <div className="small">Add teams and people first.</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: "0 10px" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "0 10px", color: "rgba(255,255,255,0.7)", fontSize: 12 }}>Person</th>
                    {teams.map(t => (
                      <th key={t.id} style={{ textAlign: "center", padding: "0 10px", color: "rgba(255,255,255,0.7)", fontSize: 12 }}>
                        {t.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {people.map(p => (
                    <tr key={p.id} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 14 }}>
                      <td style={{ padding: "10px", border: "1px solid rgba(255,255,255,0.10)", borderRight: "none", borderTopLeftRadius: 14, borderBottomLeftRadius: 14 }}>
                        <div style={{ fontWeight: 900 }}>{p.name}</div>
                        <div className="small">Cap: {p.daily_capacity_hours ?? 8}h</div>
                      </td>
                      {teams.map(t => {
                        const checked = isMember(t.id, p.id);
                        return (
                          <td
                            key={t.id}
                            style={{
                              padding: "10px",
                              border: "1px solid rgba(255,255,255,0.10)",
                              borderLeft: "none",
                              textAlign: "center"
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => toggleMember(t.id, p.id, e.target.checked)}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="small" style={{ marginTop: 10 }}>
              If ticking fails, Supabase RLS is blocking inserts/deletes on <code>team_members</code> — the error will show in the banner.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
