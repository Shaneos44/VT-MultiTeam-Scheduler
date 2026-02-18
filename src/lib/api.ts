import { supabase } from "./supabaseClient";

export type Team = { id: string; name: string };
export type Person = { id: string; name: string; daily_capacity_hours: number };

export type TaskRow = {
  id: string;
  title: string;
  team_id: string;
  project_id: string | null;
  start_at: string;
  end_at: string;
  task_size: string;
  status: string;
  notes: string | null;
};

export type TaskWithAssignees = TaskRow & {
  assignees: { person_id: string; name: string }[];
};

// ---------------- TEAMS ----------------

export async function fetchTeams(): Promise<Team[]> {
  const { data, error } = await supabase.from("teams").select("id,name").order("name");
  if (error) throw error;
  return data ?? [];
}

export async function createTeam(payload: { name: string }) {
  const { data, error } = await supabase
    .from("teams")
    .insert([{ name: payload.name }])
    .select("id,name")
    .single();
  if (error) throw error;
  return data as Team;
}

export async function updateTeam(teamId: string, payload: { name: string }) {
  const { error } = await supabase.from("teams").update({ name: payload.name }).eq("id", teamId);
  if (error) throw error;
}

export async function deleteTeam(teamId: string) {
  // May fail if FK constraints exist (tasks/team_members). That's OK—surface error.
  const { error } = await supabase.from("teams").delete().eq("id", teamId);
  if (error) throw error;
}

// ---------------- PEOPLE ----------------

export async function fetchAllPeople(): Promise<Person[]> {
  const { data, error } = await supabase
    .from("people")
    .select("id,name,daily_capacity_hours")
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export async function createPerson(payload: { name: string; daily_capacity_hours?: number }) {
  const { data, error } = await supabase
    .from("people")
    .insert([
      {
        name: payload.name,
        daily_capacity_hours: payload.daily_capacity_hours ?? 8
      }
    ])
    .select("id,name,daily_capacity_hours")
    .single();

  if (error) throw error;
  return data as Person;
}

export async function updatePerson(personId: string, payload: { name: string; daily_capacity_hours: number }) {
  const { error } = await supabase
    .from("people")
    .update({ name: payload.name, daily_capacity_hours: payload.daily_capacity_hours })
    .eq("id", personId);

  if (error) throw error;
}

export async function deletePerson(personId: string) {
  const { error } = await supabase.from("people").delete().eq("id", personId);
  if (error) throw error;
}

// ---------------- MEMBERSHIP ----------------

export async function fetchTeamMembers(teamId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("team_members")
    .select("person_id")
    .eq("team_id", teamId);

  if (error) throw error;
  return (data ?? []).map((r: any) => r.person_id);
}

export async function fetchAllMembership(): Promise<{ team_id: string; person_id: string }[]> {
  const { data, error } = await supabase.from("team_members").select("team_id,person_id");
  if (error) throw error;
  return (data ?? []) as any[];
}

export async function addTeamMember(teamId: string, personId: string) {
  const { error } = await supabase.from("team_members").insert([{ team_id: teamId, person_id: personId }]);
  if (error) throw error;
}

export async function removeTeamMember(teamId: string, personId: string) {
  const { error } = await supabase
    .from("team_members")
    .delete()
    .eq("team_id", teamId)
    .eq("person_id", personId);
  if (error) throw error;
}

export async function fetchPeopleForTeam(teamId: string): Promise<Person[]> {
  const { data, error } = await supabase
    .from("team_members")
    .select("people(id,name,daily_capacity_hours)")
    .eq("team_id", teamId);

  if (error) throw error;
  return (data ?? []).map((r: any) => r.people).filter(Boolean);
}

// ---------------- TASKS ----------------

async function attachAssignees(tasks: TaskRow[]): Promise<TaskWithAssignees[]> {
  if (!tasks.length) return [];
  const taskIds = tasks.map(t => t.id);

  const { data: taRows, error: taErr } = await supabase
    .from("task_assignees")
    .select("task_id, people(id,name)")
    .in("task_id", taskIds);

  if (taErr) throw taErr;

  const map: Record<string, { person_id: string; name: string }[]> = {};
  for (const r of (taRows ?? []) as any[]) {
    const p = r.people;
    if (!p) continue;
    if (!map[r.task_id]) map[r.task_id] = [];
    map[r.task_id].push({ person_id: p.id, name: p.name });
  }

  return tasks.map(t => ({ ...t, assignees: map[t.id] ?? [] }));
}

export async function fetchTasksForTeam(teamId: string, windowStartISO: string, windowEndISO: string) {
  const { data: taskRows, error: tErr } = await supabase
    .from("tasks")
    .select("id,title,team_id,project_id,start_at,end_at,task_size,status,notes")
    .eq("team_id", teamId)
    .lt("start_at", windowEndISO)
    .gt("end_at", windowStartISO)
    .neq("status", "cancelled")
    .order("start_at");

  if (tErr) throw tErr;
  return attachAssignees((taskRows ?? []) as TaskRow[]);
}

export async function fetchTasksForTeams(teamIds: string[], windowStartISO: string, windowEndISO: string) {
  if (!teamIds.length) return [];
  const { data: taskRows, error: tErr } = await supabase
    .from("tasks")
    .select("id,title,team_id,project_id,start_at,end_at,task_size,status,notes")
    .in("team_id", teamIds)
    .lt("start_at", windowEndISO)
    .gt("end_at", windowStartISO)
    .neq("status", "cancelled")
    .order("start_at");

  if (tErr) throw tErr;
  return attachAssignees((taskRows ?? []) as TaskRow[]);
}

export async function createTask(payload: {
  title: string;
  team_id: string;
  start_at: string;
  end_at: string;
  task_size: string;
  status: string;
  notes?: string;
  assigneeIds: string[];
}) {
  const { data: task, error } = await supabase
    .from("tasks")
    .insert([{
      title: payload.title,
      team_id: payload.team_id,
      start_at: payload.start_at,
      end_at: payload.end_at,
      task_size: payload.task_size,
      status: payload.status,
      notes: payload.notes ?? null
    }])
    .select("*")
    .single();

  if (error) throw error;

  if (payload.assigneeIds?.length) {
    const { error: aErr } = await supabase
      .from("task_assignees")
      .insert(payload.assigneeIds.map(pid => ({ task_id: task.id, person_id: pid })));
    if (aErr) throw aErr;
  }

  return task;
}

export async function updateTask(taskId: string, payload: {
  title: string;
  start_at: string;
  end_at: string;
  task_size: string;
  status: string;
  notes?: string;
  assigneeIds: string[];
}) {
  const { error } = await supabase
    .from("tasks")
    .update({
      title: payload.title,
      start_at: payload.start_at,
      end_at: payload.end_at,
      task_size: payload.task_size,
      status: payload.status,
      notes: payload.notes ?? null
    })
    .eq("id", taskId);

  if (error) throw error;

  const { error: delErr } = await supabase.from("task_assignees").delete().eq("task_id", taskId);
  if (delErr) throw delErr;

  if (payload.assigneeIds?.length) {
    const { error: insErr } = await supabase
      .from("task_assignees")
      .insert(payload.assigneeIds.map(pid => ({ task_id: taskId, person_id: pid })));
    if (insErr) throw insErr;
  }
}

export async function deleteTask(taskId: string) {
  const { error } = await supabase.from("tasks").delete().eq("id", taskId);
  if (error) throw error;
}

// ---------------- AVAILABILITY + CONFLICTS ----------------

export async function getAvailability(teamId: string, windowStartISO: string, windowEndISO: string) {
  const { data, error } = await supabase.rpc("get_people_availability_in_window", {
    p_team_id: teamId,
    p_window_start: windowStartISO,
    p_window_end: windowEndISO
  });
  if (error) throw error;
  return data ?? [];
}

/**
 * Optional: conflict warning if your RPC exists. If it doesn't, we return null.
 */
export async function getPersonTasksInWindow(personId: string, windowStartISO: string, windowEndISO: string) {
  const { data, error } = await supabase.rpc("get_person_tasks_in_window", {
    p_person_id: personId,
    p_window_start: windowStartISO,
    p_window_end: windowEndISO
  });
  if (error) return null;
  return data ?? [];
}
