/** Stable Latin URL slugs for city pages (/city/[slug]). A city missing here fails the build, so add it when the source adds one. */
const CITY_SLUGS: Record<string, string> = {
  "السادات": "sadat",
  "أكتوبر الجديدة": "new-october",
  "أسيوط الجديدة": "new-assiut",
  "حدائق العاشر": "hadayek-el-asher",
  "القاهرة الجديدة": "new-cairo",
  "العلمين الجديدة": "new-alamein",
  "بنى سويف الجديدة": "new-beni-suef",
  "سفنكس الجديدة": "new-sphinx",
  "المنصورة الجديدة": "new-mansoura",
  "السادس من أكتوبر": "6th-of-october",
  "العبور الجديدة": "new-obour",
  "برج العرب الجديدة": "new-borg-el-arab",
  "العاشر من رمضان": "10th-of-ramadan",
  "بدر": "badr",
  "المنيا الجديدة": "new-minya",
  "الشروق": "el-shorouk",
  "أسوان الجديدة": "new-aswan",
  "15 مايو": "15th-of-may",
  "سوهاج الجديدة": "new-sohag",
  "الفيوم الجديدة": "new-fayoum",
  "أخميم الجديدة": "new-akhmim",
  "الشيخ زايد": "sheikh-zayed",
  "حدائق العاصمة": "hadayek-el-asema",
  "دمياط الجديدة": "new-damietta",
  "العبور": "obour",
};

export function citySlug(name: string): string {
  const s = CITY_SLUGS[name];
  if (!s) throw new Error(`No URL slug for city "${name}"; add it to src/lib/slugs.ts`);
  return s;
}
