// QR-code als afbeelding (data-URL), lokaal gegenereerd: er gaat niets naar een externe dienst.

import QRCode from "qrcode";

export async function qrDataUrl(text: string, size = 320): Promise<string> {
  return QRCode.toDataURL(text, {
    width: size,
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#0b0d11", light: "#ffffff" }
  });
}
