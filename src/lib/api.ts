import { supabase } from "./supabaseClient";

export async function fetchTeams() {
  const { data, error } = await supabase.from("teams").select("id,name").order("name");
  if (error) throw error;
  return data ?? [];
}

export async function fetchPeopleForTeam(teamId: string) {
  const { data, error } = await supabase
    .from("team_members")
    .select("people(id,name,daily_capacity_hours)")
    .eq("team_id", teamId);

  if (error) throw error;

  return (data ?? []).map((r: any) => r.people).filter(Boolean);
}

export async function fetchTasksForTeam(teamId: string, windowStartISO: string, windowEndISO: string) {
  const { data, error } = await supabase
    .from("tasks_with_assignees")
    .select("*")
    .eq("team_id", teamId)
    .lt("start_at", windowEndISO)
    .gt("end_at", windowStartISO)
    .neq("status", "cancelled")
    .order("start_at");

  if (error) throw error;
  return data ?? [];
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
      notes: payload.notes ?? null,
    }])
    .select("*")
    .single();

  if (error) throw error;

  if (payload.assigneeIds.length) {
    const { error: aErr } = await supabase
      .from("task_assignees")
      .insert(payload.assigneeIds.map(pid => ({ task_id: task.id, person_id: pid })));
    if (aErr) throw aErr;
  }

  return task;
}

export async function deleteTask(taskId: string) {
  const { error } = await supabase.from("tasks").delete().eq("id", taskId);
  if (error) throw error;
}

export async function getAvailability(teamId: string, windowStartISO: string, windowEndISO: string) {
  const { data, error } = await supabase.rpc("get_people_availability_in_window", {
    p_team_id: teamId,
    p_window_start: windowStartISO,
    p_window_end: windowEndISO
  });
  if (error) throw error;
  return data ?? [];
}
