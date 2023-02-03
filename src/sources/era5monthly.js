import { Datetime } from "../datetime.js";
import { download, get_json, post_json } from "../download.js";
import { grib1, grib1_normal, grib1_anomaly } from "../file-conversions.js";
import {
  output_path,
  run_all,
  perm_cache_dir,
  typical_metadata,
  send_ingest_command,
} from "../utility.js";
import { access, rm } from "fs/promises";
import { join } from "path";
import { setTimeout as sleep } from "timers/promises";
import { parentPort } from "worker_threads";
import { v4 as uuidv4 } from "uuid";

const name = "reanalysis-era5-single-levels-monthly-means";

const SHP_CLIP_PATH = process.env.SHP_CLIP_PATH;

const GSKY_ERA5_INGEST_WEBHOOK_ENDPOINT =
  process.env.GSKY_ERA5_INGEST_WEBHOOK_ENDPOINT;
const GSKY_WEHBOOK_SECRET = process.env.GSKY_WEHBOOK_SECRET;
const GSKY_ERA5_INGEST_SCRIPT_FILENAME =
  process.env.GSKY_ERA5_INGEST_SCRIPT_FILENAME;

const shared_metadata = {
  width: 1440,
  height: 721,
  interval: "monthly-aggregate",
  projection: "ERA5",
};

const aoi_bbox = [37, -21.36, -39.34, 65.49];

export async function forage(current_state, datasets) {
  let { date, last_updated, normals = {} } = current_state;
  let dt = date
    ? Datetime.from(date).add({ months: 1 })
    : Datetime.from("1959-01-01");
  date = dt.to_iso_string();

  last_updated = await verify_update_needed(name, dt, last_updated);

  let metadatas = datasets.map((d) => typical_metadata(d, dt, shared_metadata));
  let variables = [...new Set(datasets.map((d) => d.variable))];

  const options = {
    format: "grib",
    product_type: "monthly_averaged_reanalysis",
    year: dt.year,
    month: dt.p_month,
    time: "00:00",
    variable: variables,
    area: aoi_bbox,
  };

  let input;
  try {
    input = await download_cds(name, options, process.env.CDS_API_KEY);
  } catch (e) {
    if (e === "Error: no data is available within your requested subset") {
      return { new_state: { ...current_state, last_updated } };
    }
    throw e;
  }

  await run_all(
    datasets.map((dataset, i) => async () => {
      let output = output_path(
        dataset.output_dir,
        dt.to_iso_string(),
        dataset.layer_name
      );
      let record_number =
        variables.findIndex((v) => v === dataset.variable) + 1;

      if (dataset.anomaly) {
        let normal = await get_normal(normals, dt, dataset.variable, {
          clip_by: SHP_CLIP_PATH,
        });
        const out_grib = output + ".grib";
        await grib1_anomaly(
          normal,
          input,
          output,
          {
            record_number,
            clip_by: SHP_CLIP_PATH,
          },
          true
        );
      } else {
        await grib1(input, output, {
          record_number,
          clip_by: SHP_CLIP_PATH,
          asGeoTiff: true,
        });
      }
    })
  );
  await rm(input);

  // send gsky ingest command on successfull download
  if (
    GSKY_ERA5_INGEST_WEBHOOK_ENDPOINT &&
    GSKY_WEHBOOK_SECRET &&
    GSKY_ERA5_INGEST_SCRIPT_FILENAME
  ) {
    console.log(`Sending Ingest Command for time ${dt.to_iso_string()}`);

    const payload = {
      filename: `-f ${GSKY_ERA5_INGEST_SCRIPT_FILENAME}`,
    };

    await send_ingest_command(
      GSKY_ERA5_INGEST_WEBHOOK_ENDPOINT,
      GSKY_WEHBOOK_SECRET,
      payload
    );
  }

  return { metadatas, new_state: { date, last_updated, normals } };
}

const count = 30;
const starting_year = 1991;

async function get_normal(normals, dt, variable, options = {}) {
  normals[variable] ??= {};
  let month = dt.p_month;
  let normal = normals[variable][month];
  if (normal) return normal;

  const cds_options = {
    format: "grib",
    product_type: "monthly_averaged_reanalysis",
    year: Array.from({ length: count }, (_, i) => i + starting_year),
    month,
    time: "00:00",
    variable,
    area: aoi_bbox,
  };

  let input = await download_cds(name, cds_options, process.env.CDS_API_KEY);
  let output = join(perm_cache_dir, uuidv4());
  normals[variable][month] = output;

  await grib1_normal(count, input, output, {
    ...options,
    record_number: "all",
  });

  return output;
}

const base_url = "https://cds.climate.copernicus.eu/api/v2";

async function verify_update_needed(name, dt, last_updated) {
  let ui_resources_url = `${base_url}.ui/resources/${name}`;
  let { update_date } = await get_json(ui_resources_url);
  let getting_latest =
    dt >=
    Datetime.from(update_date).round({
      smallestUnit: "month",
      roundingMode: "floor",
    });
  if (last_updated === update_date && getting_latest) throw "No update needed";
  return update_date;
}

async function download_cds(name, request, auth) {
  let resource_url = `${base_url}/resources/${name}`;

  let response = await post_json(resource_url, request, { auth });
  let task_url = `${base_url}/tasks/${response.request_id}`;

  let sleep_time = 1e3;
  let reply = await get_json(task_url, { auth });

  while (["queued", "running"].includes(reply.state)) {
    await sleep(sleep_time);
    sleep_time = Math.min(sleep_time * 1.5, 120e3);
    reply = await get_json(task_url, { auth });
    parentPort?.postMessage("keepalive");
  }

  if (reply.state !== "completed") throw `Error: ${reply.error.message}`;

  let download_url = reply.location.startsWith("https://")
    ? reply.location
    : `${base_url}/${reply.location}`;

  return download(download_url, { auth });
}
