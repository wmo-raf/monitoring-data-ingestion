export const name = "average temperature at 2 m above ground anomaly";

export const metadata = {
  unit: "degC",
  originalUnit: "degK",
};

export { variable } from "./era5monthly-temperature-2-m.js";

export const anomaly = true;
