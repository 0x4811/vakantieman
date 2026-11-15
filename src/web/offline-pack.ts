import { buildOfflineHtml, packJson, PACK_MARKER } from "../shared/offline-pack";

export { buildOfflineHtml, packJson, PACK_MARKER };

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Foto kon niet worden gelezen."));
    reader.readAsDataURL(blob);
  });
}

