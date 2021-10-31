import * as classify from "./classify";
import * as fetch from "node-fetch";
import * as tf from "@tensorflow/tfjs-node";
import * as Sharp from "sharp";

let model: tf.LayersModel = null;
let inputShape: tf.Shape = null;

export const isScoreImage = async (url: string, catchHandler?: (err: any) => any) => {
    try {
        if (model === null) {
            const tmodel = await tf.loadLayersModel(`file://${__dirname}/score_classifier_model/model.json`);
            const tshape = (tmodel.layers[0].input as tf.SymbolicTensor).shape;
            if (tshape[0] !== null || tshape[3] !== 3) {
                throw new Error("Invalid model input shape");
            }
            model = tmodel;
            inputShape = tshape.slice(1);
        }
        const request = await fetch.default(url);
        const buffer = await request.buffer();
        const input = Sharp(buffer);
        const fixedInput = await classify.preprocessImage(input, inputShape);
        const result = model.predict(tf.expandDims(fixedInput)) as tf.Tensor;
        const resultValue = (await result.data())[0];
        return resultValue > 0.5;
    } catch (err) {
        if (catchHandler) {
            catchHandler(err);
            return true;
        }
        throw err;
    }
};