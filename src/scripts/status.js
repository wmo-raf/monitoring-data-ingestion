const fdi_url = "";

const minutes = 60 * 1000;
const hours = 60 * minutes;
const days = 24 * hours;

class Up {
  now = new Date();
  down = false;

  assert(obj, prop, max_delay, message) {
    if (this.now - new Date(obj[prop]) > max_delay) {
      console.log(`\n${message}.`);
      console.log(obj);
      this.down = true;
    }
  }
}

async function get(filename) {
  let response = await fetch(fdi_url + filename);
  return response.json();
}

const up = new Up();

console.log(`Checking status of ${fdi_url} ...`);
console.log({ now: up.now.toISOString() });

let heart = await get("heart.json");
let state = await get("state.json");

up.assert(heart, "last_beat", 5 * minutes, "FDI is down");
up.assert(state.sources.geos, "forecast", 18 * hours, "GEOS is delayed");
up.assert(state.sources.gfs, "forecast", 11 * hours, "GFS is delayed");
up.assert(state.sources.gfswave, "forecast", 11 * hours, "GFS-wave is delayed");

if (!up.down) console.log("\nAll sources up to date.");

Deno.exit(up.down ? 1 : 0);
