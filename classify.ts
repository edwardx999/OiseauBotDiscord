import * as sharp from "sharp";
import * as tf from "@tensorflow/tfjs-node";

export type Image = sharp.Sharp;

const splitDifference = (larger: number, smaller: number) => {
	const diff = larger - smaller;
	const split = diff >> 1;
	return split;
};

export const enum PreprocessMode {
	grayscale = 1,
	normal = 3,
	gradBrightness = 4,

};

export const preprocessModeChannels = (mode: PreprocessMode): number => {
	return mode;
}

export const preprocessModeFromChannels = (channels: number): PreprocessMode => {
	switch (channels) {
		case PreprocessMode.normal:
		case PreprocessMode.gradBrightness:
			return channels;
	}
	throw new Error("Invalid number of channels");
}

const colorScaler = tf.scalar(1 / 255);

export const preprocessImage = async (image: Image | string, inputShape: tf.Shape, trim: boolean = false) => {
	const loadedImage = typeof image === "string" ? sharp(image) : image;
	const inputWidth = inputShape[0];
	const inputHeight = inputShape[1];
	const inputRatio = inputShape[0] / inputShape[1];
	const inputChannels = preprocessModeFromChannels(inputShape[2]);

	const trimmedImage = trim ? sharp(await loadedImage.trim().png().toBuffer()) : loadedImage;

	const imageMetadata = await trimmedImage.metadata();
	const imageRatio = imageMetadata.width / imageMetadata.height;
	const fixedImage = (() => {
		if (imageRatio < inputRatio) { // image skinnier, must crop out top and bottom
			const cropHeight = Math.ceil(imageMetadata.width / inputRatio);
			const top = splitDifference(imageMetadata.height, cropHeight);
			return trimmedImage.extract({ left: 0, top: top, width: imageMetadata.width, height: top + cropHeight });
		} else {
			const cropWidth = Math.ceil(imageMetadata.height * inputRatio);
			const left = splitDifference(imageMetadata.width, cropWidth);
			return trimmedImage.extract({ left: left, top: 0, width: cropWidth, height: imageMetadata.height });
		}
	})().resize({
		width: inputWidth,
		height: inputHeight,
		fit: "fill",
		kernel: "cubic"
	}).removeAlpha();
	// await fixedImage.clone().png().toFile("test_output.png");
	switch (inputChannels) {
		case PreprocessMode.grayscale:
			{
				const buffer = await fixedImage.grayscale().raw().toBuffer(); // order x, y, channel
				return tf.tidy(() => tf.tensor3d(buffer, [inputWidth, inputHeight, inputChannels], "float32").mul(colorScaler));
			}
		case PreprocessMode.normal:
			{
				const buffer = await fixedImage.toColorspace("srgb").raw().toBuffer(); // order x, y, channel
				return tf.tidy(() => tf.tensor3d(buffer, [inputWidth, inputHeight, inputChannels], "float32").mul(colorScaler));
			}
		case PreprocessMode.gradBrightness:
			{
				const imagePromise = fixedImage.clone().toColorspace("srgb").raw().toBuffer();
				const brightnessPromise = fixedImage.clone().grayscale().raw().toBuffer();
				const image = await imagePromise;
				const brightness = await brightnessPromise;
				// sobel in sharp doesn't work because of negative truncation or something
				return tf.tidy(() => {
					const imageTensor = tf.tensor3d(image, [inputWidth, inputHeight, 3], "float32").mul(colorScaler);
					const brightnessTensor = tf.tensor3d(brightness, [inputWidth, inputHeight, 1], "float32").mul(colorScaler);
					const offsetBrightnessTensor = tf.split(brightnessTensor, [1, inputHeight - 1], 0)[1] as tf.Tensor3D;
					const cutoffBrightnessTenor = tf.split(brightnessTensor, [inputHeight - 1, 1], 0)[0] as tf.Tensor3D;
					const gradientTensor = tf.abs(tf.sub(cutoffBrightnessTenor, offsetBrightnessTensor).pad([[0, 1], [0, 0], [0, 0]], 0));
					return tf.concat([imageTensor, gradientTensor], 2);
				});
			}
	}

};

// loss under 0.1 is okay, to try to avoid overfitting
const tolerance = tf.scalar(0.1);
const tolerantLoss = (gold: tf.Tensor, pred: tf.Tensor) => {
	return tf.tidy(() => tf.relu(tf.losses.logLoss(gold, pred).sub(tolerance)));
};

export const createDefaultModel = (inputWidth: number, inputHeight: number, mode: PreprocessMode) => {
	const inputShape: tf.Shape = [inputWidth, inputHeight, mode];
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
		//loss: tolerantLoss,
		metrics: ["accuracy"]
	});
	return {
		model,
		inputShape
	};
};