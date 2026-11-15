// Beeldbewerking in de browser: verkleinen, opnieuw coderen (dat verwijdert EXIF/GPS), base64.

import { fitForVision } from "../shared/geo";
import { sanitizeJpeg } from "../shared/jpeg-clean";

export interface PreparedImage {
  blob: Blob;
  width: number;
  height: number;
  base64: string;
  previewUrl: string;
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("Het bestand kon niet worden gelezen."));
    reader.readAsDataURL(blob);
  });
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Coderen van de foto mislukte."))), "image/jpeg", quality);
  });
}

/** Zet gecodeerde bytes om in een blob die de server zeker accepteert (alleen JFIF/ICC-segmenten). */
export async function finalizeJpeg(blob: Blob): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const clean = sanitizeJpeg(bytes);
  return new Blob([clean as BlobPart], { type: "image/jpeg" });
}

/**
 * Leest een foto, draait hem volgens de EXIF-oriëntatie, verkleint hem tot de limieten van het beeldmodel
 * en codeert hem opnieuw als JPEG. Daarbij verdwijnen EXIF en GPS vanzelf.
 */
export async function prepareImage(file: Blob): Promise<PreparedImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("Deze browser kan dit bestand niet lezen. Gebruik een JPEG- of PNG-foto.");
  }
  const size = fitForVision(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is niet beschikbaar in deze browser.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();

  const blob = await finalizeJpeg(await canvasToJpeg(canvas, 0.92));
  return {
    blob,
    width: size.width,
    height: size.height,
    base64: await blobToBase64(blob),
    previewUrl: URL.createObjectURL(blob)
  };
}
