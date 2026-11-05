import type { LatLng } from "@/engine/nearbuilt";

/**
 * Approximate centres for districts the source has not placed at all: none of their plots has geometry and
 * the source has no map tiles for them (checked with scripts/tools/sector-tiles-probe.mts on 2026-11-05).
 * Read off public maps, keyed by the source's sector id; each entry says what it was read from.
 *
 * Lowest-priority fallback: located plots, then the source's map view (sector-views.ts), then the source's
 * tile bounds all win, and the sync drops an entry here the moment the source publishes anything. These centres
 * only draw the district's dashed "approximate" circle and its map link; building/road distances are never
 * computed from them (that needs the source's own placement), so a rough centre cannot skew the ranking.
 */
export const DISTRICT_CENTRES: Record<string, LatLng> = {
  // الشيخ زايد: الحى الحادى عشر - المجاورة الثانية — OSM neighbourhood «الحى 11».
  "99c6b66e-92df-09a5-09d6-3a21bf7d6a5c": [30.0465, 30.9699],
  // الشيخ زايد: الحى الثالث عشر المجاورة السادسة — OSM neighbourhood «الحى 13».
  "cf13c592-eb86-0c1e-9fbd-3a21bf7cf91d": [30.0553, 30.9859],
  // أسيوط الجديدة: الاسكان المتميز - التوسعات الجنوبية الشرقية — OSM neighbourhood «الإسكان المتميز», south-east of the city centre.
  "5d6615e6-f003-5fa1-0a77-3a23a1181b52": [27.2687, 31.3487],
  // بدر: الحي المتميز2 — OSM neighbourhoods «شمال الحى المتميز غرب/شرق» (midpoint).
  "3923a8b8-5ffb-9f2b-55f0-3a21bf88f15d": [30.1268, 31.735],
  // حدائق العاصمة: حى الامل — OSM «ميدان الامل» inside the city.
  "7e80c075-68e0-f186-e2ee-3a23a0f4e7e4": [30.1384, 31.8149],
  // حدائق العاشر: غرب الحى 28 — OSM neighbourhood «الحى 28» of العاشر من رمضان, about 1.5 km west of its centre.
  "bfca4c7f-6eb7-6795-4649-3a23a0fb8a44": [30.338, 31.672],
  // سفنكس الجديدة: منطقة 145 فدان شمال السليمانية — OSM «جنة السليمانية» (30.127, 30.768), about 1.5 km north of it.
  "b57727f8-4fe8-8b34-3a30-3a21bf901617": [30.14, 30.77],
  // بدر: شمال الحى الخامس — OSM neighbourhood «الحى 5» (30.166, 31.697), just north of it.
  "b312cde3-d5e3-0938-6713-3a23a116eaa7": [30.172, 31.697],
  // أكتوبر الجديدة: منطقة الاب تاون — OSM places «قطاع 1/4/6» of أب تاون (29.906–29.910, 30.794–30.817), their middle;
  // matches the district's own description (on the monorail line, above the Green Belt compounds).
  "7a1ad6e9-bf8a-6dee-5e2d-3a21bf8c0651": [29.908, 30.806],
  // أكتوبر الجديدة: منطقة عمرانى 2 جنوب طريق الواحات — city level only: Wikipedia's coordinates for the city.
  "7fdee6a5-c159-6d6d-eea9-3a23a132dc1b": [29.903, 30.789],
  // الشيخ زايد: التوسعات بالقرار 77 — listings put these plots on محور الضبعة about 1.6 km from the Cairo–Alexandria
  // road; OSM has the axis at (30.092, 30.965) near that junction. Approximate.
  "474465cf-eb80-96c7-49e4-3a21bf7caaa0": [30.093, 30.953],
  // حدائق العاشر: قرية المعرفة — city level only: the city is the strip between بلبيس and the regional ring road west of
  // الحى 28 (OSM), so a point a few km west of it.
  "32842fc8-3192-7918-4db4-3a23a0fb90ca": [30.34, 31.64],
  // أخميم الجديدة: وحدة الجوار العمرانى السادسة عشر — city level only: Wikipedia's coordinates for the city.
  "3ff53adf-77ff-ab72-a5db-3a21bf86a906": [26.492, 31.845],
  // أخميم الجديدة: الامتداد الشمالى أ - الحى الرابع — city level only, nudged 1 km north for «الامتداد الشمالى».
  "cee5162d-d451-0d5e-0859-3a23a0f74715": [26.501, 31.845],
  // 15 مايو: المركز الفرعى 3 — city level only: OSM's place node for the city.
  "8cc7bfe2-f585-21b1-5cf4-3a21bf85fdc8": [29.832, 31.365],
};
