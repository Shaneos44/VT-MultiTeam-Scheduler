"use client";

import { useEffect, useMemo, useState } from "react";
import { addDays, format, startOfWeek } from "date-fns";
import {
  createTask,
  deleteTask,
  fetchPeopleForTeam,
  fetchTasksForTeam,
  fetchTeams,
  getAvailability
} from "@/lib/api";

type TasksWithAssignees = any;

function iso(d: Date) {
  return d.toISOString();
}

export default function Home() {
  const [teams, setTeams] = useState<{id:string; name:string}[]>([]);
  const [teamId, setTeamId] = useState<string>("");
  const [people, setPeople] = useState<{id:string; name:string; daily_capacity_hours:number}[]>([]);
  const [tasks, setTasks] = useState<TasksWithAssignees[]>([]);
  const [availability, setAvailability] = useState<any[]>([]);
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [loading, setLoading] = useState(false);

  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);

  useEffect(() => {
    fetchTeams().then(ts => {
      setTeams(ts);
      if (ts[0]) setTeamId(ts[0].id);
    }).catch(console.error);
  }, []);

  async function refresh(tid: string) {
    const [tsk, avail] = await Promise.all([
      fetchTasksForTeam(tid, iso(weekStart), iso(weekEnd)),
      getAvailability(tid, iso(weekStart), iso(weekEnd))
    ]);
    setTasks(tsk);
    setAvailability(avail);
  }

  useEffect(() => {
    if (!teamId) return;
    setLoading(true);
    Promise.all([
      fetchPeopleForTeam(teamId),
      fetchTasksForTeam(teamId, iso(weekStart), iso(weekEnd)),
      getAvailability(teamId, iso(weekStart), iso(weekEnd))
    ])
      .then(([ppl, tsk, avail]) => {
        setPeople(ppl);
        setTasks(tsk);
        setAvailability(avail);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [teamId, weekStart, weekEnd]);

  async function onQuickAdd() {
    if (!teamId || !people.length) return;

    const start = new Date(weekStart);
    start.setHours(9,0,0,0);
    const end = new Date(start);
    end.setHours(10,0,0,0);

    await createTask({
      title: "New Task",
      team_id: teamId,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      task_size: "hourly",
      status: "planned",
      notes: "",
      assigneeIds: [people[0].id]
    });

    await refresh(teamId);
  }

  const days = useMemo(() => Array.from({length:7}, (_,i) => addDays(weekStart,i)), [weekStart]);

  return (
    <main style={{ padding: 16, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>Multiteam Scheduler</h1>

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <label>
          Team:&nbsp;
          <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>

        <button onClick={() => setWeekStart(addDays(weekStart, -7))}>◀ Prev week</button>
        <div style={{ fontWeight: 600 }}>
          {format(weekStart, "dd MMM yyyy")} – {format(addDays(weekStart, 6), "dd MMM yyyy")}
        </div>
        <button onClick={() => setWeekStart(addDays(weekStart, 7))}>Next week ▶</button>

        <button onClick={onQuickAdd} style={{ marginLeft: "auto" }}>
          + Quick add (1h @ 9am)
        </button>
      </div>

      {loading && <div>Loading…</div>}

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
        <section style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Week schedule</h2>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8 }}>
            {days.map(d => (
              <div key={d.toISOString()} style={{ border: "1px solid #eee", borderRadius: 10, padding: 8, minHeight: 160 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>{format(d, "EEE dd")}</div>

                {tasks
                  .filter(t => new Date(t.start_at).toDateString() === d.toDateString())
                  .map(t => (
                    <TaskCard
                      key={t.id}
                      task={t}
                      onDelete={async () => {
                        await deleteTask(t.id);
                        await refresh(teamId);
                      }}
                    />
                  ))}

                {tasks.filter(t => new Date(t.start_at).toDateString() === d.toDateString()).length === 0 && (
                  <div style={{ color: "#777", fontSize: 13 }}>No tasks</div>
                )}
              </div>
            ))}
          </div>
        </section>

        <section style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Who’s free (this week)</h2>
          <div style={{ fontSize: 13, color: "#666", marginBottom: 8 }}>
            Sorted by least scheduled hours (selected team + week).
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {availability.map((a: any) => (
              <div key={a.person_id} style={{ border: "1px solid #eee", borderRadius: 10, padding: 10 }}>
                <div style={{ fontWeight: 700 }}>{a.name}</div>
                <div style={{ fontSize: 13 }}>
                  Scheduled: <b>{Number(a.scheduled_hours).toFixed(2)}h</b> • Daily cap: {a.daily_capacity_hours}h
                </div>
              </div>
            ))}
            {availability.length === 0 && <div style={{ color: "#777", fontSize: 13 }}>No people found for this team.</div>}
          </div>
        </section>
      </div>

      <footer style={{ marginTop: 16, color: "#666", fontSize: 12 }}>
        DB stores UTC (<code>timestamptz</code>). Times render in your browser’s local timezone.
      </footer>
    </main>
  );
}

function TaskCard({ task, onDelete }: { task: any; onDelete: () => void }) {
  const start = new Date(task.start_at);
  const end = new Date(task.end_at);
  const who = (task.assignees ?? []).map((a: any) => a.name).join(", ");

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 10, marginBottom: 8 }}>
      <div style={{ fontWeight: 700 }}>{task.title}</div>
      <div style={{ fontSize: 12, color: "#555" }}>
        {format(start, "HH:mm")}–{format(end, "HH:mm")} • {task.task_size} • {task.status}
      </div>
      <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>
        {who ? <>Assignees: {who}</> : <>No assignees</>}
      </div>
      <button onClick={onDelete} style={{ marginTop: 8 }}>Delete</button>
    </div>
  );
}
