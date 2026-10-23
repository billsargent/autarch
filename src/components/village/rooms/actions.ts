// The furniture actions each scene's room UI handles, by scene id. Plain data
// so the village tests can check every clickable thing does something.
export const ROOM_ACTIONS: Record<string, string[]> = {
  village: ["goals.board", "goals.new"],
  library: ["skills.browse", "skills.new"],
  workshop: ["jobs.board", "jobs.new"],
};
