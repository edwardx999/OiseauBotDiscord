import * as classify from "./classify";
import * as tf from "@tensorflow/tfjs-node";
import * as _ from "underscore";
import * as fs from "fs";
import { positiveFiles, negativeFiles, pathologicalFiles, modelsPath } from "./train_common";

const main = async () => {

    const yes = tf.scalar(1);
    const no = tf.scalar(0);

    const inputs: tf.Tensor[] = [];
    const labels: tf.Tensor[] = [];

    const expectedShape = [200, 200, 3];

    for(const path of positiveFiles) {
        inputs.push(await classify.preprocessImage(path, expectedShape));
        labels.push(yes);
    }
    for(const path of pathologicalFiles) {
        inputs.push(await classify.preprocessImage(path, expectedShape));
        labels.push(yes);
    }
    for(const path of negativeFiles) {
        inputs.push(await classify.preprocessImage(path, expectedShape));
        labels.push(no);
    }

    const inputTensor = tf.stack(inputs);
    const labelTensor = tf.stack(labels);

    labels.forEach(label => label.dispose());
    inputs.forEach(input => input.dispose());

    const models = fs.readdirSync(modelsPath);
    for (const modelDir of models) {
        const path = `${modelsPath}/${modelDir}`;
        if (fs.statSync(path).isDirectory()) {
            const modelPath = `${path}/model.json`;
            if (fs.existsSync(modelPath)) {
                console.log(`Model: ${path}=============================================`);
                const model = await tf.loadLayersModel(`file://${modelPath}`);
                model.compile({
                    optimizer:  "adam",
                    loss: "binaryCrossentropy",
                    metrics: [tf.metrics.binaryAccuracy, tf.metrics.precision, tf.metrics.recall]
                });
                const evaluation = model.evaluate(inputTensor, labelTensor, {
                    batchSize: 10
                }) as tf.Scalar[];
                const names = ["binaryCrossentropy", "accuracy", "precision", "recall"];
                for(let i = 0; i < names.length; ++i){
                    console.log(`${names[i]}: ${evaluation[i].dataSync()[0]}`)
                }
            }
        }
    }
}
main();