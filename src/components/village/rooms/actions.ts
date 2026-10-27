// The furniture actions each scene's room UI handles, by scene id. Plain data
// so the village tests can check every clickable thing does something.
export const ROOM_ACTIONS: Record<string, string[]> = {
  village: ["goals.board", "goals.new", "mail.open", "trade.post", "signs.directions"],
  library: ["skills.browse", "skills.new", "library.documents", "library.research"],
  workshop: ["jobs.board", "jobs.new"],
  guardtower: ["activity.log", "activity.today"],
  observatory: ["monitor.charts"],
  vault: ["usage.ledger", "usage.totals"],
  townhall: ["approvals.pending", "approvals.records", "settings.open", "meeting.open"],
  cottage: ["chat.open", "journal.open", "cottage.letters"],
  storehouse: ["store.stores", "store.orders", "store.ledger"],
  postoffice: ["post.outbox", "post.sent", "post.inbox", "post.calendar", "post.letters"],
  tavern: ["tavern.bar", "tavern.keeper"],
  bakery: ["bakery.oven", "bakery.keeper"],
  shop: ["shop.counter", "shop.keeper"],
  home: ["home.computer", "home.desk", "home.books", "home.calendar", "home.invite", "home.guitar", "home.map", "home.pantry", "home.keepsakes"],
};
