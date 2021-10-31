import * as classify from "./classify";
import * as tf from "@tensorflow/tfjs-node";
import * as _ from "underscore";
import * as fs from "fs";

const training_path = "./training";
const positive_path = training_path + "/scores";
const negative_path = training_path + "/not_scores";

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

const positiveFiles = loadFiles(positive_path);
const negativeFiles = loadFiles(negative_path);

const { model, inputShape } = classify.createModel(200, 200);


const BATCH_SIZE = 1000;

const batchCache: Record<string, {label: tf.Tensor, image: tf.Tensor, dirty: boolean}> = {};
const getBatch = async () => {
  const inputs: [tf.Tensor, tf.Tensor][] = [];
  _.shuffle(negativeFiles);
  _.shuffle(positiveFiles);
  const NEG_RATIO = Math.random() / 4 + 0.25; 
  const NEGATIVE_FILES = Math.min(Math.floor(NEG_RATIO * BATCH_SIZE), negativeFiles.length);
  const POSITIVE_FILES = BATCH_SIZE - NEGATIVE_FILES;
  for(const path in batchCache) {
    batchCache[path].dirty = false;
  }
  const addImage = async (path: string, labelVal: number) => {
    const cached = batchCache[path];
    if(cached){
      cached.dirty = true;
      inputs.push([cached.image, cached.label]);
    } else{
      const image = await classify.preprocessImage(path, inputShape);
      const label = tf.scalar(labelVal);
      batchCache[path] = {
        image, label, dirty: true
      };
      inputs.push([image, label]);
    }
  };
  for(let i = 0; i < NEGATIVE_FILES; ++i){
    await addImage(negativeFiles[i], 0);
  }
  for(let i = 0; i < POSITIVE_FILES; ++i){
    await addImage(positiveFiles[i], 1);
  }
  for(const path in batchCache) {
    const cached = batchCache[path];
    if(!cached.dirty){
      cached.image.dispose();
      cached.label.dispose();
      delete batchCache[path];
    }
  }
  return [tf.stack(inputs.map(([image, _]) => image)), tf.stack(inputs.map(([_, label]) => label))];
};

fs.mkdirSync("models", { recursive: true });

const main = async () => {
  for (let i = 0; i < 1000; ++i) {
    const [inputs, labels] = await getBatch();
    const h = await model.fit(inputs, labels, {
      batchSize: 10,
      epochs: 10,
      shuffle: true
    });
    const path = `models/${new Date().getTime()}`;
    fs.mkdirSync(path, { recursive: true });
    await model.save(`file://${path}`);
  }
}

main();