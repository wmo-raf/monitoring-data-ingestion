import { temp_cache_dir } from "./utility.js";
import { Buffer } from "buffer";
import { spawn } from "child_process";
import { rm } from "fs/promises";
import { join } from "path";
import { v4 as uuidv4 } from "uuid";
import util from "util";
import mv from "mv";

const rename = util.promisify(mv);

export async function grib1(input, output, options = {}) {
  return await grib1_to_file(input, output, options);
}

export async function grib1_normal(count, input, output, options = {}) {
  // save to file
  let out_grib = join(temp_cache_dir, uuidv4());
  out_grib = await grib1_to_file(input, out_grib, options);

  // calculate average across all timesteps
  await cdo_timmean(out_grib, output);

  return output;
}

export async function grib1_anomaly(
  normal,
  input,
  output,
  options = {},
  asGeoTiff = false
) {
  let in_temp_file = join(temp_cache_dir, uuidv4());
  in_temp_file = await grib1_to_file(input, in_temp_file, options);

  if (!asGeoTiff) {
    // subtract normal from climatology mean
    return await cdo_sub(in_temp_file, normal, output);
  }

  const out = await cdo_sub(in_temp_file, normal);

  const tiff_out = await grib_to_tiff(out);

  await rename(tiff_out, output + ".tif");
}

export async function grib2(input, output, options = { match: ".*" }) {
  return await grib2_to_file(input, output, options);
}

export async function grib2_acc(input, options = {}) {
  return await combine_grib(input, options, (a, b) => a - b);
}

async function grib_to_tiff(input) {
  let out_file = join(temp_cache_dir, uuidv4()) + ".tif";

  const gdal_translate_args = [
    "-co",
    "COMPRESS=LZW",
    "-co",
    "predictor=3",
    "-ot",
    "Float32",
    input,
    out_file,
  ];

  await spawn_cmd("gdal_translate", gdal_translate_args);

  return out_file;
}

async function grib2_to_file(input, output, options) {
  let out_temp_file = join(temp_cache_dir, uuidv4());

  await spawn_cmd("wgrib2", [
    input,
    "-match",
    options.match,
    "-limit",
    options.limit,
    "-grib",
    out_temp_file,
  ]);

  if (options.clip_by) {
    const out = await clip_grib(out_temp_file, output.options.clip_by);
    await rm(out_temp_file); // clean up
    out_temp_file = out;
  }

  if (options.factor) {
    const out = await cdo_multc(out_temp_file, options.factor);
    await rm(out_temp_file); // clean up
    out_temp_file = out;
  }

  if (options.asGeoTiff) {
    const out = await grib_to_tiff(out_temp_file);
    await rm(out_temp_file);
    out_temp_file = out;
  }

  if (options.asGeoTiff) {
    return await rename(out_temp_file, output + ".tif");
  } else {
    return await rename(out_temp_file, output + ".grib");
  }
}

async function grib1_to_file(input, output, options = {}) {
  let out_temp_file = join(temp_cache_dir, uuidv4());

  const { record_number, clip_by, asGeoTiff, factor } = options;

  // create grib file for variable
  await spawn_cmd("wgrib", [
    input,
    "-d",
    record_number,
    "-grib",
    "-o",
    out_temp_file,
  ]);

  if (clip_by) {
    const out = await clip_grib(out_temp_file, clip_by);
    await rm(out_temp_file); // clean up
    out_temp_file = out;
  }

  if (factor) {
    const out = await cdo_multc(out_temp_file, factor);
    await rm(out_temp_file); // clean up
    out_temp_file = out;
  }

  if (asGeoTiff) {
    const out = await grib_to_tiff(out_temp_file);
    await rm(out_temp_file);
    out_temp_file = out;
  }

  if (asGeoTiff) {
    const out_file = output + ".tif";
    await rename(out_temp_file, out_file);
    return out_file;
  } else {
    const out_file = output + ".grib";
    await rename(out_temp_file, out_file);
    return out_file;
  }
}

export async function combine_grib(files, options = {}) {
  let out_file = join(temp_cache_dir, uuidv4());

  const cdo_sub_args = ["sub", files[0], files[1], out_file];

  await spawn_cmd("cdo", cdo_sub_args);

  if (options.factor) {
    let out = await cdo_multc(out_file, options.factor);
    await rm(out_file);
    out_file = out;
  }

  return out_file;
}

async function clip_grib(input, geom) {
  let out_file = join(temp_cache_dir, uuidv4());
  const gdalwarp_args = [
    "-q",
    "-cutline",
    geom,
    "-crop_to_cutline",
    "-of",
    "GRIB",
    "-dstnodata",
    -9999,
    "-overwrite",
    "-t_srs",
    "EPSG:4326",
    input,
    out_file,
  ];

  await spawn_cmd("gdalwarp", gdalwarp_args);

  return out_file;
}

async function cdo_multc(input, constant) {
  let out_file = join(temp_cache_dir, uuidv4());

  const cdo_multc_args = [`-mulc,${constant}`, input, out_file];
  await spawn_cmd("cdo", cdo_multc_args);

  return out_file;
}

async function cdo_timmean(input, output) {
  let out_file = output;

  if (!output) {
    out_file = join(temp_cache_dir, uuidv4());
  }

  const cdo_timmean_args = ["timmean", "-setmissval,-999", input, out_file];
  await spawn_cmd("cdo", cdo_timmean_args);

  return out_file;
}

async function cdo_sub(ifile1, ifile2, output) {
  let out_file = output;

  if (!output) {
    out_file = join(temp_cache_dir, uuidv4());
  }

  const cdo_subtrace_args = ["sub", ifile1, ifile2, out_file];

  await spawn_cmd("cdo", cdo_subtrace_args);

  return out_file;
}

async function spawn_cmd(command, args) {
  return new Promise((resolve, reject) => {
    let child = spawn(command, args);

    let { stdout, stderr } = child;
    let chunks = [];
    let errs = [];

    stdout.on("data", (chunk) => chunks.push(chunk));
    stderr.on("data", (err) => errs.push(err));

    child.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        let msg = Buffer.concat(errs).toString();
        reject(`${command} exited with code ${code}:\n${msg}`);
      }
    });

    for (let obj of [child, stdout, stderr]) {
      obj.on("error", reject);
    }
  });
}
