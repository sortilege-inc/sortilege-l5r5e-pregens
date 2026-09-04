#!/usr/bin/env node
/* The purse gate: run the Creator's own coin helpers over the generated
   chargen data and fail if any character's starting money renders as a
   fraction of a coin.

   That is the defect this exists to catch. Money used to be summed as a koku
   float, so Peasant Family's 10 zeni -- the corpus states it in copper --
   reached the side panel and the export as "0.2". Coin is added one
   denomination at a time now and never carried into the next, which also
   keeps the sheet saying what the book says: the entry gives ten copper
   coins, not the one silver bu they are worth.

   The helpers are read out of assets/creator.js rather than retyped, so this
   tests the code that ships. Run it directly or let pipeline.sh run it:

       node scripts/coin_selftest.js
*/
var fs = require("fs"), path = require("path");
var ROOT = path.join(__dirname, "..");
var src = fs.readFileSync(path.join(ROOT, "assets/creator.js"), "utf8");

// the shipped implementation of one top-level function, by brace matching
function grab(name) {
  var i = src.indexOf("function " + name + "(");
  if (i < 0) throw new Error("assets/creator.js defines no " + name + "()");
  var depth = 0, start = src.indexOf("{", i);
  for (var k = start; k < src.length; k++) {
    if (src[k] === "{") depth++;
    else if (src[k] === "}" && --depth === 0) return src.slice(i, k + 1);
  }
  throw new Error(name + "() is unbalanced");
}
var COINS = ["koku", "bu", "zeni"];
eval(grab("addCoins"));
eval(grab("scaleCoins"));
eval(grab("coinLabel"));

global.window = global;
require(path.join(ROOT, "data/chargen/families.js"));
require(path.join(ROOT, "data/chargen/upbringings.js"));

var pass = 0, fail = [];
function is(what, got, want) {
  if (got === want) { pass++; return; }
  fail.push(what + " -> " + JSON.stringify(got) + ", wanted " + JSON.stringify(want));
}
function zero() { return { koku: 0, bu: 0, zeni: 0 }; }
function fam(n) {
  var f = L5R_FAMILIES.filter(function (x) { return x.name === n; })[0];
  if (!f) throw new Error("no family called " + n);
  return f.starting_coins;
}
function up(re) {
  var u = L5R_UPBRINGINGS.filter(function (x) { return new RegExp(re).test(x.name); })[0];
  if (!u) throw new Error("no upbringing matching " + re);
  return u.starting_coins;
}
var purse = function () {
  var out = zero();
  [].slice.call(arguments).forEach(function (c) { addCoins(out, c); });
  return out;
};

// what the book gives, said the way the book says it
is("Peasant Family", coinLabel(purse(fam("Peasant Family"))), "10 zeni");
is("Kaiu", coinLabel(purse(fam("Kaiu"))), "5 koku");
is("Tonbo", coinLabel(purse(fam("Tonbo"))), "1 koku");
is("Farmer Upbringing", coinLabel(purse(up("Farmer"))), "2 bu");
is("Hinin Upbringing", coinLabel(purse(up("Hinin"))), "5 zeni");
// items are not coin: Temple's day of rations is gear, and says so elsewhere
is("Temple Upbringing", coinLabel(purse(up("Temple"))), "nothing");
is("nothing from anywhere", coinLabel(zero()), "nothing");

// a sum keeps both denominations rather than collapsing them
is("Kaiu + Farmer", coinLabel(purse(fam("Kaiu"), up("Farmer"))), "5 koku, 2 bu");

// the one Lion heritage that doubles starting money, on each shape
is("Kaiu doubled", coinLabel(scaleCoins(purse(fam("Kaiu")), 2)), "10 koku");
is("Peasant Family doubled", coinLabel(scaleCoins(purse(fam("Peasant Family")), 2)), "20 zeni");
is("Kaiu + Farmer doubled",
   coinLabel(scaleCoins(purse(fam("Kaiu"), up("Farmer")), 2)), "10 koku, 4 bu");

// the invariant, over every entry the corpus states rather than a chosen few
var all = L5R_FAMILIES.concat(L5R_UPBRINGINGS);
var fractional = all.filter(function (e) {
  return /\./.test(coinLabel(purse(e.starting_coins))) ||
         /\./.test(coinLabel(scaleCoins(purse(e.starting_coins), 2)));
});
if (fractional.length) {
  fail.push(fractional.length + " of " + all.length +
            " render a fraction of a coin: " +
            fractional.map(function (e) { return e.name; }).join(", "));
} else { pass++; }

if (fail.length) {
  console.error("FAIL — the purse gate, " + fail.length + " of " +
                (pass + fail.length) + ":");
  fail.forEach(function (f) { console.error("   " + f); });
  process.exit(1);
}
console.log("purse gate: " + pass + " checks, no fractional coin across " +
            all.length + " families and upbringings");
