import * as sharp from "sharp";
import * as tf from "@tensorflow/tfjs-node";

export type Image = sharp.Sharp;

const splitDifference = (larger: number, smaller: number) => {
	const diff = larger - smaller;
	const split = diff >> 1;
	return split;
};

const REQUIRED_CHANNELS = 3;

const colorScaler = tf.scalar(1/255);

export const preprocessImage = async (image: Image | string, inputShape: tf.Shape) => {
	if (typeof image === "string") {
		image = sharp(image);
	}
	const inputWidth = inputShape[0];
	const inputHeight = inputShape[1];
	const inputRatio = inputShape[0] / inputShape[1];
	const inputChannels = inputShape[2];
	if (inputChannels !== REQUIRED_CHANNELS) {
		throw new Error(`${REQUIRED_CHANNELS} layer shape needed`);
	}

	const imageMetadata = await image.metadata();
	const imageRatio = imageMetadata.width / imageMetadata.height;

	const fixedImage = (() => {
		if (imageRatio < inputRatio) { // image skinnier, must crop out top and bottom
			const cropHeight = Math.ceil(imageMetadata.width / inputRatio);
			const top = splitDifference(imageMetadata.height, cropHeight);
			return image.extract({ left: 0, top: top, width: imageMetadata.width, height: top + cropHeight });
		} else {
			const cropWidth = Math.ceil(imageMetadata.height * inputRatio);
			const left = splitDifference(imageMetadata.width, cropWidth);
			return image.extract({ left: left, top: 0, width: cropWidth, height: imageMetadata.height });
		}
	})().resize({
		width: inputWidth,
		height: inputHeight,
		fit: "fill",
		kernel: "cubic"
	}).removeAlpha().toColorspace("srgb");
	// await fixedImage.clone().png().toFile("test_output.png");
	const buffer = await fixedImage.raw().toBuffer(); // order x, y, channel
	
	return tf.tidy(() => tf.tensor3d(buffer, [inputWidth, inputHeight, REQUIRED_CHANNELS], "float32").mul(colorScaler));
};

export const createModel = (inputWidth: number, inputHeight: number) => {
	const inputShape: tf.Shape = [inputWidth, inputHeight, REQUIRED_CHANNELS];
	const model = tf.sequential();
	model.add(tf.layers.conv2d({
		inputShape: inputShape,
		kernelSize: 5,
		filters: 8,
		strides: 1,
		activation: "relu",
		kernelInitializer: "varianceScaling"
	}));
	model.add(tf.layers.maxPooling2d({
		poolSize: [2, 2],
		strides: [2, 2]
	}));
	model.add(tf.layers.flatten());

	model.add(tf.layers.dense({
		units: 1,
		kernelInitializer: "varianceScaling",
		activation: 'sigmoid'
	}));

	const optimizer = tf.train.adam();
	model.compile({
		optimizer: optimizer,
		loss: "binaryCrossentropy",
		metrics: ["accuracy"]
	});
	return {
		model,
		inputShape
	};
};