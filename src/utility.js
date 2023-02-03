import { Datetime } from "./datetime.js";
import { createHash } from "crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rmdir,
  stat,
  writeFile,
} from "fs/promises";
import { platform, tmpdir } from "os";
import { resolve, join, dirname, sep, basename } from "path";
import { fileURLToPath } from "url";
import util from "util";
import mv from "mv";
import { brotliCompress as _brotliCompress, constants } from "zlib";

import crypto from "crypto";
import axios from "axios";

const rename = util.promisify(mv);

const brotliCompress = util.promisify(_brotliCompress);

export const parent_output_dir = await create_dir(
  process.env.DATA_OUTPUT_PATH ? process.env.DATA_OUTPUT_PATH : "../public/mdi"
);

export const clip_by_shp_path = process.env.CLIP_BY_SHP_PATH;

export const sources_state_dir = await create_dir("./state/sources");
export const datasets_state_dir = await create_dir("./state/datasets");
export const perm_cache_dir = await create_dir("./cache");
export const temp_cache_dir = await create_dir(join(tmpdir(), "hw-cache"));

async function create_dir(relative_path) {
  let path = absolute_path(relative_path);
  await mkdir_p(path);
  return path;
}

export function absolute_path(relative_path) {
  return resolve(dirname(fileURLToPath(import.meta.url)), relative_path);
}

export async function hash_of_this_file(import_meta) {
  let data = await readFile(fileURLToPath(import_meta.url));
  return createHash("md5").update(data).digest("hex");
}

export async function mkdir_p(path) {
  await mkdir(path, { mode: "775", recursive: true });
}

export async function json_dir_to_obj(path) {
  if (!(await stat(path)).isDirectory()) return read_json(path);

  return Object.fromEntries(
    await Promise.all(
      (
        await readdir(path)
      ).map(async (file) => [
        basename(file, ".json"),
        await json_dir_to_obj(join(path, file)),
      ])
    )
  );
}

export async function read_json(file, default_value = undefined) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (e) {
    if (default_value !== undefined && e.code === "ENOENT") {
      return default_value;
    }
    throw e;
  }
}

export async function write_json_atomically(file, obj, compress = false) {
  let string = JSON.stringify(obj, null, compress ? null : 2);
  let data = string;

  await write_file_atomically(file, data);
}

export async function brotli(buffer, compression_level = 11) {
  let params = { [constants.BROTLI_PARAM_QUALITY]: compression_level };
  return brotliCompress(buffer, { params });
}

const parent_tmp_dir = await create_dir("./atomic");

export async function write_file_atomically(file, data) {
  let tmp_dir = await mkdtemp(parent_tmp_dir + sep);
  let tmp_file = join(tmp_dir, basename(file));

  await writeFile(tmp_file, data);
  await rename(tmp_file, file);
  await rmdir(tmp_dir);
}

const tp_size = process.env.UV_THREADPOOL_SIZE ?? 4;

export async function run_all(promise_functions, max_concurrency = tp_size) {
  return new Promise((resolve, reject) => {
    let finished_count = -max_concurrency;
    let queue = [...promise_functions];
    let rejected = false;
    let reject_and_stop = (e) => {
      reject(e);
      rejected = true;
    };
    let tick = () => {
      if (rejected) return;
      if (++finished_count === promise_functions.length) resolve();
      if (queue.length > 0) queue.shift()().then(tick, reject_and_stop);
    };
    for (let i = 0; i < max_concurrency; i++) tick();
  });
}

const windows = platform() === "win32";

export function output_path(output_dir, iso_date_string, layer_name = "") {
  if (windows) iso_date_string = iso_date_string.replaceAll(":", "_");
  return join(
    output_dir,
    `${layer_name && layer_name + "_"}${iso_date_string}`
  );
}

export function typical_metadata(dataset, dt, shared_metadata) {
  let { start, end, missing } = dataset.current_state;
  start ??= dt.to_iso_string();
  end = !end || dt > Datetime.from(end) ? dt.to_iso_string() : end;
  let metadata = dataset.metadata ?? {};
  let new_state = { start, end, missing };
  return { start, end, missing, ...metadata, ...shared_metadata, new_state };
}

function get_signature(body, secret) {
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(JSON.stringify(body));
  const hash = hmac.digest("hex");
  return hash;
}

export function send_ingest_command(endpoint, secret, payload) {
  const signature = get_signature(payload, secret);

  return axios
    .post(endpoint, payload, {
      headers: {
        "X-Gsky-Signature": signature,
      },
    })
    .catch((err) => {
      console.log("Error sending GSKY INGEST COMMAND", err);
    });
}
