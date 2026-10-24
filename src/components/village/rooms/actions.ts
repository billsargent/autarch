// The furniture actions each scene's room UI handles, by scene id. Plain data
// so the village tests can check every clickable thing does something.
export const ROOM_ACTIONS: Record<string, string[]> = {
  village: ["goals.board", "goals.new", "mail.open"],
  library: ["skills.browse", "skills.new"],
  workshop: ["jobs.board", "jobs.new"],
  guardtower: ["activity.log", "activity.today"],
  observatory: ["monitor.charts"],
  vault: ["usage.ledger", "usage.totals"],
  townhall: ["approvals.pending", "approvals.records", "settings.open", "meeting.open"],
  cottage: ["chat.open", "journal.open"],
  home: ["home.computer", "home.desk", "home.books", "home.calendar", "home.invite", "home.guitar", "home.map", "home.pantry", "home.keepsakes"],
};
