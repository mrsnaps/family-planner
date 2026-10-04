// Seasonal swap: plain rules. In spring and autumn, nudge to pack away last season's
// clothes and get the next season's out of storage, saying which still fit.
const { fitsChild } = require('./engine');

// Summer clothes from April to September, winter clothes the rest of the year.
const seasonOf = (date) => {
  const m = Number(String(date).slice(5, 7));
  return m >= 4 && m <= 9 ? 'summer' : 'winter';
};
const other = (s) => (s === 'summer' ? 'winter' : 'summer');
// When to nudge: late March to mid May, and mid September to mid November.
function inSwapWindow(date) {
  const md = String(date).slice(5, 10);
  return (md >= '03-20' && md <= '05-15') || (md >= '09-15' && md <= '11-15');
}

function swapPlan(child, items, today) {
  const season = seasonOf(today);
  const mine = items.filter((i) => i.childId === child.id && !i.wornOut);
  const packAway = mine.filter((i) => i.season === other(season) && !i.stored);
  const getOut = mine.filter((i) => i.season === season && i.stored);
  const outgrown = getOut.filter((i) => !fitsChild(i, child));
  const fitting = getOut.filter((i) => fitsChild(i, child));
  const haveNow = mine.filter((i) => !i.stored && i.season !== other(season) && fitsChild(i, child) && i.type !== 'shoes');
  const due = inSwapWindow(today) && (packAway.length >= 3 || getOut.length > 0);
  return {
    childId: child.id,
    name: child.name,
    season,
    due,
    packAway: packAway.map(({ id, name, type }) => ({ id, name, type })),
    getOut: fitting.map(({ id, name, type }) => ({ id, name, type })),
    outgrown: outgrown.map(({ id, name, type, size }) => ({ id, name, type, size })),
    stored: mine.filter((i) => i.stored).length,
    // Few clothes for the coming season that fit: worth a shop.
    short: due && haveNow.length + fitting.length < 6,
  };
}

module.exports = { seasonOf, inSwapWindow, swapPlan };
