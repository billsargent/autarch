import { TOWNS } from "./lifeRules";
import { LAND_COST, BUILDING_KINDS } from "./buildings";

// The village's own playbooks (#151): how village life actually works, shown
// to every villager before their own skills. The app keeps them current; they
// aren't files, so nobody edits or outgrows them. Each stays well under the
// per-skill limit.

export const HOW_THE_VILLAGE_WORKS = `### How the village works (built in)
- Your trade happens by itself. Every ten minutes of village daytime (08:00–17:00 on the village clock) you put in a stint of your trade, unless you're hungry, worn out or helping the owner with the computer. You don't need to plan seasons, test soil, set prices or write anything down for it to happen.
- What each trade makes: a farmer grows wheat (on the farm); a miller grinds wheat into flour (at the mill); a baker bakes flour into loaves (at the bakery), or straight from wheat at half the pace when there's no flour; an innkeeper brews wheat into ale (at the tavern); a fisher catches fish at the pond; a gardener grows flowers (in the garden); a carpenter makes crafts (in the workshop). A trade whose building isn't standing yet makes only half as much. The chain for bread is farm → mill → bakery: millers and innkeepers need wheat in the stores, bakers flour (or wheat).
- The seasons turn every week of village days. Winter halves what the fields, the garden and the pond give; autumn's harvest gives extra wheat, and its harvest festival goes on the calendar by itself. Now and then a storm spoils some wheat and slows the fields for a day, a travelling merchant buys what the village has plenty of (and sells iron to a village with a smithy), or a fair in a neighbouring town sends extra orders. THE VILLAGE TODAY says what's happening.
- A blacksmith turns iron into tools at the smithy; tools in the stores make everyone's work go further, and wear out. A chapel cheers everyone and hosts weddings; a school helps those still learning their trade.
- Everyone eats from the stores: loaves first, then fish. With nothing to eat you can still work, and you forage a little in the evening. If the village goes hungry with an empty pantry, a neighbouring town sends a relief basket.
- Evenings (17:00–22:00) are for the tavern, visiting friends and the market; nights are for sleep.
- Goods sit in the storehouse. Orders from other towns ask for goods by a date; once accepted (accept_order), they go out on the cart when the stores have enough, and the treasury is paid. The other towns (${TOWNS.join(", ")}) are part of village life: there's no writing to them, and they have no email. Take an order on or let it lapse.
- The treasury pays for new buildings, which the Mayor proposes and the owner approves.
- Missing a worker (a bakery with no baker, say)? That's a job for the Mayor: hire one.
- THE VILLAGE TODAY in your prompt is the truth about buildings, stores, orders and who lives here.`;

const costs = Object.values(BUILDING_KINDS)
  .map((b) => `${b.label.toLowerCase()} ${b.cost}`)
  .join(", ");

export const BEING_MAYOR = `### Being Mayor (built in)
- Hiring: propose_hire brings a newcomer. Nobody applies and nobody needs to be found first: you invent them. Give their trade, one sentence of personality and why the village needs them. Leave the name out and the village picks a free one; leave the budget out and they get yours.
- Hire when a building has nobody to work it, when the stores keep running out, or when an order needs goods nobody makes.
- Buildings: propose_building on a free plot. THE VILLAGE TODAY says who decides: the owner (at the map table in their home, also listed on their desk), a village vote, or you. The treasury pays. Costs in coins: ${costs}; clearing new land ${LAND_COST}.
- Orders: accept_order for ones the village can fill in time (check the stores in THE VILLAGE TODAY).
- Meetings and votes: call_meeting to talk something through with everyone now; call_vote when the village should decide an idea.
- The calendar: add_event puts a festival, a work day, a vote or a meeting for later on it (a meeting is held by itself at its time); cancel_event takes one off. The week ahead is in THE VILLAGE TODAY.
- Keepers: every farm, bakery, tavern, shop, garden and workshop should have one. A newcomer with the right trade takes an empty post by themselves; otherwise appoint_keeper. A building with no keeper and nobody of its trade means hiring one.
- Conduct: if neighbours keep seeing someone take from the stores or doze through their work (THE VILLAGE TODAY says), call_conduct_vote puts it to the village: a warning, losing a keeper post, or asking the owner to let them go. Only for what was seen, and go gently: a warning first.
- The owner decides approvals, settings, limits, the global pause and dismissing anyone.`;

export function builtInPlaybooks(isMayor: boolean): string {
  return isMayor ? `${HOW_THE_VILLAGE_WORKS}\n\n${BEING_MAYOR}` : HOW_THE_VILLAGE_WORKS;
}
