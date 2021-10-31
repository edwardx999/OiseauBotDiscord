import * as classify from "./classify";
import * as tf from "@tensorflow/tfjs-node";
import * as _ from "underscore";
import * as fs from "fs";
import { positiveFiles, negativeFiles, pathologicalFiles, modelsPath } from "./train_common";

console.log(`${positiveFiles.length} positive files`);
console.log(`${pathologicalFiles.length} positive pathological files`);
console.log(`${negativeFiles.length} negative files`);

const { model, inputShape } = classify.createDefaultModel(200, 200);


const BATCH_SIZE = 500;

const batchCache: Record<string, {label: tf.Tensor, image: tf.Tensor, dirty: boolean}> = {};
const getBatch = async () => {
  const inputs: [tf.Tensor, tf.Tensor][] = [];
  _.shuffle(negativeFiles);
  _.shuffle(positiveFiles);
  const NEG_RATIO = Math.random() / 4 + 0.25; 
  const NEGATIVE_FILES = Math.min(Math.floor(NEG_RATIO * BATCH_SIZE), negativeFiles.length);
  const POSITIVE_FILES = BATCH_SIZE - NEGATIVE_FILES - pathologicalFiles.length;
  for(const path in batchCache) {
    batchCache[path].dirty = false;
  }
  const addImage = async (path: string, labelVal: number) => {
    const cached = batchCache[path];
    if(cached){
      cached.dirty = true;
      inputs.push([cached.image, cached.label]);
    } else {
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
  for(let i = 0; i < pathologicalFiles.length; ++i){
    await addImage(pathologicalFiles[i], 1);
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

fs.mkdirSync(modelsPath, { recursive: true });

const main = async () => {
  for (let i = 0; i < 1000; ++i) {
    const [inputs, labels] = await getBatch();
    const h = await model.fit(inputs, labels, {
      batchSize: 10,
      epochs: 4,
      shuffle: true
    });
    const path = `${modelsPath}/${new Date().getTime()}`;
    fs.mkdirSync(path, { recursive: true });
    await model.save(`file://${path}`);
  }
}

main();