require("canvas"); // need this before sharp
import * as Sharp from "sharp";
import * as TextToImage from "text-to-image";

const prefix = "data:image/png;base64,";

export const renderEms = async (text: string) => {
  const dataUri = await TextToImage.generate(text, { fontFamily: "EMS_Serenissima", fontSize: 200, lineHeight:150, margin: 10, maxWidth: 10000 });
  const buffer = Buffer.from(dataUri.substring(prefix.length), 'base64');
  const img = await Sharp(buffer).trim().png().toBuffer();
  return img;
};