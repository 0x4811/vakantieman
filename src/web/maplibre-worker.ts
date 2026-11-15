// MapLibre 6 laadt zijn worker uit een apart bestand. Vite bundelt dat bestand (met zijn gedeelde
// onderdelen) tot één script op dezelfde oorsprong, zodat de CSP (worker-src 'self') volstaat.
import { setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

setWorkerUrl(workerUrl);
