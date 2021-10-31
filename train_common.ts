import * as classify from "./classify";
import * as tf from "@tensorflow/tfjs-node";
import * as _ from "underscore";
import * as fs from "fs";

const trainingPath = "./training";
const positivePath = trainingPath + "/scores";
const negativePath = trainingPath + "/not_scores";
const pathologicalPath = trainingPath + "/pathological_scores";

const loadFiles = (path: string) => {
  const files = fs.readdirSync(path);
  const ret: string[] = [];
  for (const file of files) {
    if (file.endsWith("jpeg") ||
      file.endsWith("png") ||
      file.endsWith("webp")) {
      ret.push(`${path}/${file}`);
    }
  }
  return ret;
};

export const positiveFiles = loadFiles(positivePath);
export const negativeFiles = loadFiles(negativePath);
export const pathologicalFiles = loadFiles(pathologicalPath);

export const modelsPath = "models";