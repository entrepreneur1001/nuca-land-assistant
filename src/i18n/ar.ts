/** All user-facing text, in Egyptian Arabic. */

import { ALAMEIN_BLOCKS, UNITS, type AlameinBlock } from "@/engine/units";

const nf = (digits = 0) => new Intl.NumberFormat("ar-EG", { maximumFractionDigits: digits });
export const num = (n: number | null | undefined, digits = 0) =>
  n == null || !Number.isFinite(n) ? "—" : nf(digits).format(n);
/** «بلوك ١: من ٢٩ لـ ٤٤ وحدة، …» for the New Alamein per-plot rule. */
const alameinList = ALAMEIN_BLOCKS.map((b) => `بلوك ${num(b.block)}: من ${num(b.min)} لـ ${num(b.max)} وحدة`).join("، ");
const alameinPlots = ALAMEIN_BLOCKS.reduce((a, b) => a + b.plots, 0);
/** «٥٫٨ مليون», or the plain figure rounded to ten thousand below a million. */
const millions = (n: number) => (n >= 1e6 ? `${num(n / 1e6, n >= 1e7 ? 0 : 1)} مليون` : num(Math.round(n / 1e4) * 1e4));
export const usd = (n: number | null | undefined) => (n == null ? "—" : `${num(n)} دولار`);
export const pct = (n: number | null | undefined) => (n == null ? "—" : `${num(Math.round(n * 100))}٪`);
export const km = (n: number | null | undefined) =>
  n == null ? "مش معروف" : n >= 5 ? "٥ كم أو أكتر" : n < 1 ? `${num(Math.round(n * 1000))} متر` : `${num(n, 1)} كم`;
/** Calendar date in Cairo time, so the build server and every visitor's browser print the same day. */
export const date = (iso: string | Date | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("ar-EG", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Cairo" }) : "—";
export const dateTime = (iso: string | Date | null | undefined) =>
  iso ? new Date(iso).toLocaleString("ar-EG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—";

export function ago(iso: string | null | undefined, now: number) {
  if (!iso) return "لسه ماتحدّثتش";
  if (!now) return "…";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `من ${num(s)} ثانية`;
  const m = Math.floor(s / 60);
  if (m < 60) return `من ${num(m)} دقيقة`;
  const h = Math.floor(m / 60);
  if (h < 48) return `من ${num(h)} ساعة`;
  return `من ${num(Math.floor(h / 24))} يوم`;
}

export const REC: Record<string, string> = {
  STRONG_BUY: "لقطة",
  GOOD: "كويسة",
  WATCH: "تحت المراقبة",
  SKIP: "سيبها",
  AVOID: "ابعد عنها",
};
export const REACH: Record<string, string> = {
  REACHABLE: "غالباً هتلحقها",
  RISKY: "فرصة متوسطة",
  UNLIKELY: "صعب تلحقها",
  BOOKED: "اتحجزت",
};

export const FACTOR: Record<string, string> = {
  reachability: "فرصة إنك تلحقها",
  nearBuilt: "قربها من العمار",
  premium: "حديقة / ناصية / عدد الشقق",
  location: "المكان اللي بتفضله",
  value: "سعر المتر مقارنة باللي زيها",
  area: "المساحة",
  demand: "بتتحجز بسرعة دلوقتي",
};

const availText = (n: number) => (n ? num(n) + " أرض متاحة" : "كل الأراضي اتحجزت");
const areaCount = (n: number) => (n === 1 ? "منطقة واحدة" : n === 2 ? "منطقتين" : num(n) + (n <= 10 ? " مناطق" : " منطقة"));

/** How a phase is named in text (see lib/phases.ts). */
export type PhaseName = { num: string; numAr: string; ordinal: string };

export const t = {
  appName: "مساعد أراضي بيت الوطن",
  appShort: "بيت الوطن",
  disclaimer: {
    short: "⚠️ موقع غير رسمي ومش تابع لهيئة المجتمعات العمرانية. الأرقام تقديرية.",
    full: "الموقع ده مش رسمي ومش تابع لهيئة المجتمعات العمرانية الجديدة ولا لأي جهة حكومية. البيانات مقروءة من الصفحات العامة لموقع الهيئة الرسمي، وممكن تتأخر أو يبقى فيها أخطاء، وكل التوقعات والترتيب تقديرية ومفيهاش أي ضمان. الموقع مبيحجزش أراضي ومبيطلبش أي بيانات شخصية. اتأكد دايماً من الأرض والسعر والاشتراطات على موقع الهيئة الرسمي قبل ما تحجز.",
    official: "موقع الهيئة الرسمي",
  },
  rules: {
    title: "الاشتراطات البنائية",
    ratio: "نسبة البناء",
    floors: "الارتفاع المسموح",
    setbacks: "الردود",
    units: "عدد الشقق في الدور",
    unitsValue: (n: number) => (n === 2 ? "شقتين" : `${num(n)} شقق`),
    unitsConditions:
      "بشرط إن مساحة الشقة (شاملة حصتها من الخدمات والبلكونات) ماتقلش عن ١٠٠ م²، وتوفير أماكن ركن جوه الأرض، وإن شبكة المرافق تستوعب العدد.",
    unitsBasis: `محسوبة من مساحة الأرض حسب تنويه الوزارة للطرح الحادي عشر: حتى ${num(UNITS.twoUpToM2)} م² = شقتين في الدور، من ${num(UNITS.twoUpToM2 + 1)} لـ ${num(UNITS.threeUpToM2)} م² = ٣ شقق، من ${num(UNITS.threeUpToM2 + 1)} لـ ${num(UNITS.fourUpToM2)} م² = ٤ شقق، ${num(UNITS.fourUpToM2 + 1)} م² فأكتر = ٥ شقق.`,
    unitsPerPlot: "عدد الوحدات في القطعة",
    unitsCityDecides: "بيحددها جهاز المدينة لكل قطعة حسب البلوك",
    unitsValueRange: (min: number, max: number) => `من ${num(min)} لـ ${num(max)} وحدة`,
    unitsBlockValue: (b: AlameinBlock) => `من ${num(b.min)} لـ ${num(b.max)} وحدة (بلوك ${num(b.block)})`,
    unitsBlockRow: (b: AlameinBlock) => `بلوك ${num(b.block)} (${num(b.plots)} قطعة): من ${num(b.min)} لـ ${num(b.max)} وحدة`,
    unitsAlamein: `في العلمين الجديدة تيسير عدد الشقق في الدور مابيطبقش: جهاز المدينة بيحدد عدد الوحدات لكل قطعة حسب البلوك — ${alameinList} (${num(alameinPlots)} قطعة). العدد النهائي لكل قطعة حسب اشتراطات جهاز المدينة.`,
    note: "منقولة من بيانات الطرح للمنطقة، اتأكد منها من كراسة الشروط.",
    noteBooklet: "منقولة من كراسة شروط الطرح أو بروشور المنطقة الرسمي (المصدر مانشرهاش للمنطقة دي)، اتأكد منها قبل الحجز.",
  },
  tagline: "بترتيبك وفلوسك… إيه أحسن أرض تقدر تحجزها؟",
  /** Home-page notice: every plot now has its exact place and shape on the map, from the official plans. */
  plansNotice: {
    lead: "جديد:",
    text: "أماكن كل قطع الأراضي اتحدّثت على الخريطة من مخططات الهيئة الرسمية. افتح أي مدينة وشوف شكل كل قطعة ومكانها بالظبط: الأخضر متاح، والأحمر اتحجز. وكمان بقينا نعرض الأراضي اللي عليها حجز مبدئي (البرتقالي): لسه ينفع تحجزها، وأول تحويل بيكسب.",
    link: "شوف الأراضي على الخريطة",
  },
  nav: { home: "الرئيسية", market: "السوق", available: "المتاح", guide: "دليل الحجز" },
  /** Static, crawlable pages (phase hub pages and page metadata). `p` is the phase: {num: "11", numAr: "١١", ordinal: "الحادية عشرة"}. */
  seo: {
    siteTitle: (p: PhaseName) => `بيت الوطن المرحلة ${p.num} — الأراضي المتاحة وسعر المتر وأحسن أرض لترتيبك`,
    description: (p: PhaseName) =>
      `أراضي بيت الوطن المرحلة ${p.ordinal} للمصريين بالخارج: الأراضي المتاحة والمحجوزة في كل مدينة، سعر المتر والمقدم، الاشتراطات البنائية، وترتيب أحسن أرض تقدر تلحقها بترتيب حجزك.`,
    marketTitle: (p: PhaseName) => `سوق بيت الوطن المرحلة ${p.num} — الحجوزات والأراضي المتاحة لحظة بلحظة`,
    marketDescription: (p: PhaseName) =>
      `حركة الحجز في بيت الوطن المرحلة ${p.numAr}: الأراضي اللي اتحجزت والمتاحة، الحجوزات كل يوم، أكتر المناطق طلباً والمناطق اللي بتخلص بسرعة.`,
    landTitle: "تفاصيل الأرض",
    areaTitle: "الأراضي على الخريطة",
    home: {
      h1: (p: PhaseName) => `أراضي بيت الوطن المرحلة ${p.num} (${p.ordinal})`,
      intro: (p: PhaseName, total: number, cities: number, booked: number, available: number, at: string) =>
        `مساعد مجاني وغير رسمي لأراضي بيت الوطن المرحلة ${p.numAr} للمصريين بالخارج. الطرح فيه ${num(total)} قطعة أرض سكنية في ${num(cities)} مدينة جديدة، اتحجز منهم ${num(booked)} ولسه ${num(available)} متاحين (حسب بيانات يوم ${at}). حط ترتيب حجزك والمبلغ اللي حوّلته، وإحنا نرتّبلك الأراضي اللي غالباً هتلحقها حسب السعر والمساحة والحديقة والناصية وقربها من العمار.`,
      hubH: (p: PhaseName) => `كل حاجة عن المرحلة ${p.numAr}`,
      citiesH: (p: PhaseName) => `أراضي المرحلة ${p.numAr} حسب المدينة`,
    },
    hub: {
      available: "الأراضي المتاحة والمحجوزة",
      availableSub: "المتبقي في كل مدينة وسعر المتر",
      rules: "اشتراطات البناء",
      rulesSub: "نسبة البناء والأدوار والردود لكل منطقة",
      guide: "دليل الحجز",
      guideSub: "مين يحجز، التحويلات، المقدم والأقساط",
      market: "حركة الحجز لحظة بلحظة",
      marketSub: "الحجوزات كل يوم والمناطق اللي بتخلص",
    },
    available: {
      title: (p: PhaseName) => `الأراضي المتاحة بيت الوطن المرحلة ${p.num} — المتاح والمحجوز في كل مدينة`,
      description: (p: PhaseName, available: number, booked: number) =>
        `كام أرض متاحة وكام اتحجزت في بيت الوطن المرحلة ${p.ordinal}؟ ${num(available)} متاحة و${num(booked)} محجوزة، مع المتبقي في كل مدينة وسعر المتر وأقل مقدم.`,
      h1: (p: PhaseName) => `الأراضي المتاحة والمحجوزة في بيت الوطن المرحلة ${p.num}`,
      intro: (p: PhaseName) =>
        `الجدول ده بيوضح أراضي المرحلة ${p.numAr} في كل مدينة: اتطرح كام قطعة، واتحجز كام، وفاضل كام، وسعر المتر وأقل مقدم في الأراضي اللي لسه متاحة. دوس على اسم المدينة تشوف مناطقها واشتراطات البناء فيها.`,
      tableH: "المتبقي حسب المدينة",
      city: "المدينة",
      pctBooked: "نسبة المحجوز",
      soldOut: "خلصت",
    },
    city: {
      title: (p: PhaseName, city: string) => `بيت الوطن المرحلة ${p.num} ${city} — الأراضي المتاحة وسعر المتر`,
      description: (p: PhaseName, city: string, available: number, ppm: string, areas: number) =>
        `أراضي بيت الوطن المرحلة ${p.ordinal} في ${city}: ${availText(available)} في ${areaCount(areas)}، وسعر المتر من ${ppm}. المساحات والمقدم واشتراطات البناء وخريطة كل منطقة.`,
      h1: (p: PhaseName, city: string) => `أراضي بيت الوطن المرحلة ${p.num} في ${city}`,
      intro: (p: PhaseName, city: string, total: number, available: number, areas: number) =>
        `في المرحلة ${p.numAr} من بيت الوطن اتطرح في ${city} ${num(total)} قطعة أرض سكنية في ${areaCount(areas)}، ${available ? "ولسه " + num(available) + " منهم متاحين للحجز" : "وكلهم اتحجزوا"}. تحت هتلاقي كل منطقة: الأسعار والمساحات وأقل مقدم والاشتراطات البنائية ومكانها على الخريطة.`,
      areasH: (city: string) => `مناطق ${city}`,
      map: "مكانها على خرائط جوجل",
      otherCities: "مدن تانية في نفس المرحلة",
    },
    rulesPage: {
      title: (p: PhaseName) => `اشتراطات البناء بيت الوطن المرحلة ${p.num} — نسبة البناء والأدوار والردود`,
      description: (p: PhaseName) =>
        `الاشتراطات البنائية لأراضي بيت الوطن المرحلة ${p.ordinal} في كل مدينة ومنطقة: نسبة البناء، الارتفاع وعدد الأدوار المسموح، والردود، من كراسة الشروط الرسمية.`,
      h1: (p: PhaseName) => `اشتراطات البناء في بيت الوطن المرحلة ${p.num}`,
      cityPage: "صفحة المدينة ←",
      intro: (p: PhaseName) =>
        `قبل ما تختار أرض في المرحلة ${p.numAr} اعرف هتبني عليها إيه: نسبة البناء من مساحة الأرض، الارتفاع المسموح (أرضي + كام دور)، والردود من الأمام والخلف والجنب. الأرقام دي بتختلف من منطقة للتانية حتى جوه نفس المدينة.`,
      byCityH: "الاشتراطات حسب المدينة والمنطقة",
      area: "المنطقة",
      notesH: "ملاحظات مهمة من كراسة الشروط",
      unitsH: "عدد الوحدات السكنية المسموح بيها",
      unitsAllCitiesH: "كل المدن الجديدة (ما عدا العلمين الجديدة): الحد الأقصى للشقق في الدور حسب مساحة الأرض",
      unitsAlameinH: "العلمين الجديدة: عدد الوحدات لكل قطعة حسب البلوك",
      unitsAreaCol: "مساحة الأرض",
      unitsPerFloorCol: "الحد الأقصى للشقق في الدور",
      unitsBlockCol: "البلوك",
      unitsPlotsCol: "عدد القطع",
      unitsRangeCol: "الوحدات المسموح بيها لكل قطعة",
      unitsRows: [
        [`حتى ${num(UNITS.twoUpToM2)} م²`, "شقتين"],
        [`من ${num(UNITS.twoUpToM2 + 1)} لـ ${num(UNITS.threeUpToM2)} م²`, "٣ شقق"],
        [`من ${num(UNITS.threeUpToM2 + 1)} لـ ${num(UNITS.fourUpToM2)} م²`, "٤ شقق"],
        [`${num(UNITS.fourUpToM2 + 1)} م² فأكتر`, "٥ شقق"],
      ] as [string, string][],
      unitsAlameinNote: "تيسير زيادة عدد الشقق في الدور مابيطبقش على العلمين الجديدة، والأعداد دي بتخضع لاشتراطات وتفاصيل جهاز المدينة لكل قطعة.",
      unitsSource: "المصدر: تنويه وزارة الإسكان بشأن عدد الوحدات السكنية بقطع أراضي بيت الوطن – الطرح الحادي عشر.",
      unitsConditionsH: "الضوابط العامة",
      unitsConditions: [
        "مساحة الوحدة السكنية (شاملة حصتها من الخدمات والبلكونات) ماتقلش عن ١٠٠ م² (في العلمين الجديدة حسب جهاز المدينة).",
        "توفير أماكن انتظار للعربيات.",
        "الالتزام باستيعاب شبكة المرافق.",
        "الالتزام بالاشتراطات البنائية والعامة المعمول بيها.",
      ],
    },
    guidePage: {
      title: (p: PhaseName) => `شروط حجز بيت الوطن المرحلة ${p.ordinal} — المقدم والأقساط والتحويلات`,
      description: (p: PhaseName) =>
        `دليل حجز أراضي بيت الوطن المرحلة ${p.num}: مين يقدر يحجز، التحويلات التنشيطية وأولوية التخصيص، مقدم الحجز ٢٥٪، أنظمة الأقساط لحد ٧ سنين، نسب التميز والاستلام والبناء، من كراسة الشروط الرسمية.`,
      h1: (p: PhaseName) => `دليل حجز أراضي بيت الوطن المرحلة ${p.num}`,
      intro: (p: PhaseName, date: string) =>
        `ملخص مبسّط لكراسة شروط المرحلة ${p.ordinal} (${date}) الصادرة من هيئة المجتمعات العمرانية الجديدة. رقم الصفحة جنب كل جزء علشان ترجع للنص الأصلي، والكراسة الرسمية هي المرجع لو فيه أي اختلاف.`,
      tocH: "محتويات الدليل",
      page: (pages: string) => `كراسة الشروط ص ${pages}`,
      contactH: "التواصل الرسمي",
      contact: "الإيميل الرسمي لأراضي المرحلة في كراسة الشروط:",
      bankNote: "بيانات الحساب البنكي للتحويل موجودة في كراسة الشروط (صفحة ١٠). خدها من الكراسة أو من الموقع الرسمي بس، ومتحوّلش على أي حساب بيتبعتلك في رسالة.",
    },
    stat: {
      total: "إجمالي القطع",
      available: "متاح",
      booked: "اتحجز",
      ppm: "سعر المتر",
      range: (lo: string, hi: string) => `${lo} – ${hi}`,
      area: "المساحات",
      areaRange: (lo: number, hi: number) => `${num(lo)} – ${num(hi)} م²`,
      minDp: "أقل مقدم",
      minTotal: "أرخص أرض",
      garden: "على حديقة",
      corner: "ناصية",
    },
    hot: "مطلوبة",
    cheapest: "أرخص سعر متر في المدينة",
    lowestDp: "أقل مقدم في المدينة",
    noRules: "الاشتراطات البنائية للمنطقة دي مش منشورة في بيانات الطرح، راجع كراسة الشروط.",
    ruleSource: { booklet: "كراسة الشروط", source: "بيانات الطرح" },
    sourceH: "مصدر الأرقام",
    asOf: (d: string) =>
      `الأرقام في الصفحة دي من بيانات الطرح العامة يوم ${d}، والحجز شغال فممكن تكون اتغيرت. الأرقام اللحظية في صفحة السوق وفي المساعد.`,
    calcNote: "نسبة المحجوز وأقل/أعلى سعر محسوبين من بيانات القطع. الأسعار والمقدم زي ما هي في بيانات الطرح، ونسب التميز ممكن تزود السعر.",
    officialNote: "اتأكد دايماً من الموقع الرسمي وكراسة الشروط قبل أي تحويل.",
    booklet: (p: PhaseName) => `كراسة شروط المرحلة ${p.ordinal}`,
    official: "موقع أراضي الهيئة الرسمي",
    cta: "رتّبلي أحسن أرض ليا",
    ctaSub: "حط ترتيب حجزك والمبلغ اللي حوّلته وشوف الأراضي اللي غالباً هتلحقها.",
    faqH: "أسئلة بتتسأل كتير",
    faq: {
      ppmQ: (p: PhaseName, place: string) => `سعر المتر في بيت الوطن المرحلة ${p.num} ${place} كام؟`,
      ppmA: (place: string, lo: string, hi: string) =>
        `سعر المتر في أراضي ${place} المتاحة من ${lo} لـ ${hi} حسب المنطقة، وبيزيد ٥٪ للناصية و٥٪ للحديقة.`,
      availQ: (p: PhaseName, place: string) => `فيه كام أرض متاحة في ${place} في المرحلة ${p.numAr}؟`,
      availA: (available: number, total: number, at: string) =>
        `يوم ${at} كان فيه ${num(available)} أرض متاحة من أصل ${num(total)}، والعدد بيقل مع كل دفعة حجز.`,
      dpQ: (place: string) => `أقل مقدم لأرض في ${place} كام؟`,
      dpA: (dp: string, total: string) => `أقل مقدم في الأراضي المتاحة ${dp}، وأرخص أرض إجمالي تمنها ${total}.`,
      downQ: (p: PhaseName) => `مقدم حجز بيت الوطن المرحلة ${p.num} كام؟`,
      downA: "المقدم ٢٥٪ من قيمة الأرض بالدولار، وبيتدفع الأول كرصيد، وبعدها تحويل تنشيطي ٣٠٥٠ دولار (منهم ٥٠ دولار مصاريف دراسة مابترجعش) بيتضاف للرصيد ويحدد أولوية التخصيص.",
      installQ: (p: PhaseName) => `أقساط أراضي بيت الوطن المرحلة ${p.num} على كام سنة؟`,
      installA: "فيه بديلين: الباقي بعد المقدم على ٣ أقساط سنوية بفايدة البنك المركزي، أو بسعر مثبت بالدولار على أقساط سنوية لحد ٧ سنين بعائد ثابت ٤٫٧٥٪، والاتنين عليهم ٠٫٥٪ مصاريف إدارية.",
      whoQ: (p: PhaseName) => `مين يقدر يحجز في بيت الوطن المرحلة ${p.ordinal}؟`,
      whoA: "أي مصري الجنسية سنه ٢١ سنة أو أكتر (والقاصر عن طريق وليّه)، بتحويل بالدولار من الخارج أو من حساب دولاري في مصر بشروط البنك المركزي، وقطعة واحدة بس لكل حاجز.",
      buildQ: "لازم أبني في قد إيه؟",
      buildA: "لازم تطلع التراخيص وتخلّص البناء خلال ٥ سنين من استلام الأرض، وإلا التخصيص ممكن يتلغي.",
    },
    crumbs: { home: "الرئيسية" },
  },
  prayer: {
    title: "لو الموقع ساعدك، متنساناش من دعواتك 🤲",
    sub: "وعندك فكرة تحسّن الموقع أو لقيت غلطة؟ قولّنا.",
  },
  feedback: {
    open: "💡 اقترح تحسين",
    openShort: "💡 اقتراح",
    title: "اقترح تحسين",
    intro: "أي فكرة أو مشكلة أو بيانات غلط، احنا بنقرا كل رسالة.",
    typeLabel: "نوع الرسالة",
    types: { suggestion: "اقتراح", bug: "مشكلة في الموقع", data: "بيانات غلط" },
    message: "رسالتك",
    messagePh: {
      suggestion: "مثلاً: يا ريت تضيفوا فلتر حسب…",
      bug: "إيه اللي حصل؟ وكنت في أنهي صفحة؟",
      data: "أنهي أرض أو منطقة؟ وإيه الصح؟",
    },
    counter: (n: number, max: number) => `${num(n)} / ${num(max)}`,
    tooShort: (n: number) => `اكتب ${num(n)} حروف كمان على الأقل`,
    contact: "وسيلة تواصل (اختياري)",
    contactPh: "موبايل أو إيميل لو حابب نرد عليك",
    send: "ابعت",
    sending: "بنبعت…",
    cancel: "إلغاء",
    close: "إغلاق",
    successTitle: "شكراً! وصلنا رسالتك 🤍",
    successSub: "ومتنساش الدعوة.",
    another: "ابعت رسالة تانية",
    error: "مقدرناش نبعت الرسالة، اتأكد من النت وجرّب تاني. كلامك لسه محفوظ.",
    cooldown: (s: number) => `استنى ${num(s)} ثانية قبل ما تبعت تاني`,
    privacy: "مش هنعرض رسالتك لحد، ومتكتبش أي بيانات حساسة.",
  },
  loading: "بنحمّل الأراضي…",
  loadError: "مقدرناش نحمّل البيانات. جرّب تاني بعد شوية.",
  quota: "الموقع عليه ضغط كبير النهارده، جرّب تاني بكرة.",
  firstSync: "أول تحديث للبيانات لسه شغال، استنى دقايق.",
  stale: "⚠ البيانات ممكن تكون قديمة",
  live: "شغّال",
  lastUpdate: "آخر تحديث",
  profile: {
    title: "بياناتك",
    hint: "البيانات دي بتتحفظ على جهازك بس.",
    rank: "ترتيبك",
    paid: "المبلغ اللي دفعته (دولار)",
    rankPlaceholder: "مثلاً ١٧٠٠٠",
    paidPlaceholder: "مثلاً ٣٩٥٠٠",
    missing: "اكتب ترتيبك والمبلغ اللي دفعته عشان نطلعلك الأراضي المناسبة.",
    garden: "🌳 حديقة",
    corner: "📐 ناصية (على شارعين)",
    nearBuilt: "🏘️ قريبة من العمار",
    units: "🏢 ٣ شقق أو أكتر في الدور",
    modes: { prefer: "أفضّلها", require: "لازم", ignore: "مش فارقة" },
    cities: "المدن اللي بتفضلها (دوس بالترتيب)",
    allCities: (n: number) => `كل المدن (${num(n)})`,
    fewerCities: "أقل",
    onlyCities: "اعرض المدن دي بس",
    share: "انسخ لينك بإعداداتك",
    copied: "اتنسخ ✓",
    reset: "رجّع الافتراضي",
  },
  kpi: {
    ahead: "قدامك كام واحد",
    aheadSub: (codes: number) => `اتبعت ${num(codes)} كود حجز لحد دلوقتي`,
    booked: "اتحجز لحد دلوقتي",
    bookedSub: (n: number) => `${num(n)} في آخر ٢٤ ساعة`,
    available: "متاح في حدود ميزانيتك",
    availableSub: (n: number) => `من ${num(n)} أرض متاحة`,
    reachable: "غالباً هتلحق منهم",
    reachableSub: (lo: number, hi: number) => `ما بين ${num(lo)} و ${num(hi)}`,
  },
  now: {
    title: "تعمل إيه دلوقتي؟",
    turn: "دورك غالباً هييجي",
    turnRange: (best: string, worst: string) => `(بدري: ${best} — متأخر: ${worst})`,
    ahead: (ahead: number, pending: number, before: number, lo: number, hi: number, left: number) =>
      `قدامك حوالي ${num(ahead)} واحد لسه مااتندهوش، وكمان حوالي ${num(pending)} حجز متوقع من ناس اتندهوا قبلك ولسه ماحجزوش. يعني متوقع ${num(before)} حجز قبل دورك (ما بين ${num(lo)} و ${num(hi)})، ويفضل في السوق كله حوالي ${num(left)} أرض.`,
    high: (n: number) => `${num(n)} اختيار فرصته عالية`,
    medium: (n: number) => `${num(n)} اختيار فرصته متوسطة`,
    demand: "🔥 دورك قريب: بنقدّم المناطق اللي الناس بتحجز فيها بسرعة الأيام دي، لأن ده غالباً معناه إنها مكان كويس.",
    featureReach: (gc: number, nb: number) => `🌳📐 حوالي ${num(gc)} حديقة+ناصية · 🏘️ حوالي ${num(nb)} قريبة من العمار هتلحقهم`,
    strategy: "الخطة",
    target: "ركّز على",
    backup: "بديل",
    avoid: "متعتمدش على",
    avoidReason: (n: number) => `اتحجز منها ${num(n)} في آخر أسبوع، وغالباً هتخلص قبل دورك`,
    targetDetail: (n: number, s: number) => `(${num(n)} اختيار كويس، أعلى تقييم ${num(s)})`,
    top: "أحسن اختيار دلوقتي",
    why: "ليه؟",
    none: "مفيش أراضي مناسبة لميزانيتك وفلاترك. جرّب تخفّف الفلاتر.",
  },
  top10: "أحسن ١٠ أراضي ليك",
  card: {
    plot: "قطعة",
    area: "المساحة",
    price: "السعر",
    dp: "المقدم",
    ppm: "سعر المتر",
    m2: "م²",
    score: "التقييم",
    chance: "فرصة إنك تلحقها",
    chanceHint: "احتمال إن الأرض تفضل متاحة لحد ما دورك ييجي",
    scoreHint: "تقييم الأرض من ١٠٠ (السعر، المساحة، الحديقة، الناصية، القرب من العمار)",
  },
  area: {
    back: "→ ارجع للرئيسية",
    allDistricts: "كل المناطق",
    notFound: "المدينة دي مش موجودة في بيانات الطرح.",
    available: (a: number, total: number) => `${num(a)} متاحة من ${num(total)}`,
    ppm: "سعر المتر",
    minDp: "أقل مقدم",
    mapTitle: "الأراضي على الخريطة",
    legendApprox: "مكان تقريبي (أراضي من غير إحداثيات)",
    approx: (n: number, a: number) => `${num(n)} أرض مكانها التقريبي هنا (${num(a)} متاحة)`,
    noMap: "مفيش إحداثيات للأراضي هنا ولا لمكان المنطقة، فمش هنقدر نعرضها على الخريطة.",
    mapNote: "النقط الخضرا متاحة والحمرا اتحجزت. دوس على أي نقطة تفتح الأرض.",
    listTitle: "الأراضي المتاحة",
    budget: "في حدود اللي دفعته",
    sorts: { ppm: "الأرخص سعر متر", dp: "أقل مقدم", area: "الأكبر", reach: "فرصة الوصول" },
    more: (n: number) => `اعرض ${num(n)} كمان`,
    none: "مفيش أراضي متاحة هنا دلوقتي.",
    openMap: "🗺️ شوف كل الأراضي على الخريطة",
  },
  badge: {
    garden: "🌳 حديقة",
    corner: "📐 ناصية",
    street: "🛣️ شارع رئيسي",
    units: (n: number) => `🏢 ${num(n)} شقق/دور`,
    sea: "🌊 فيو",
    nearBuilt: "🏘️ قريبة من العمار",
    held: "⏳ عليها طلب حجز مبدئي",
    heldHint: "حد قدّم طلب حجز مبدئي على الأرض دي على موقع الهيئة. لسه تقدر تحجزها: أول تحويل بنكي يوصل هو اللي بيكسب.",
  },
  ai: {
    title: "رأي الذكاء الاصطناعي",
    button: "اسأل الذكاء الاصطناعي",
    again: "حلّل تاني",
    running: "بيحلّل…",
    cooldown: (s: number) => `استنى ${num(s)} ثانية`,
    failed: "التحليل مانجحش، الترتيب العادي لسه شغال.",
    dailyCap: "الذكاء الاصطناعي عليه ضغط دلوقتي، جرّب كمان شوية.",
    cached: "نتيجة محفوظة",
    outdated: "بياناتك اتغيرت بعد آخر تحليل، اضغط «حلّل تاني» عشان الرأي يتحسب على ترتيبك الجديد.",
    risks: "مخاطر",
    confidence: "الثقة",
  },
  search: {
    title: "بحث متقدم",
    city: "المدينة",
    all: "الكل",
    project: "اسم المنطقة",
    minArea: "مساحة من",
    maxArea: "مساحة لحد",
    maxDp: "أقصى مقدم",
    maxPpm: "أقصى سعر متر",
    minReach: "فرصة الوصول على الأقل ٪",
    garden: "حديقة",
    corner: "ناصية",
    nearBuilt: "قريبة من العمار",
    units: "٣ شقق أو أكتر في الدور",
    sort: "رتّب حسب",
    sorts: { score: "التقييم", reach: "فرصة الوصول", nearBuilt: "القرب من العمار", premium: "الأعلى تميزًا", price: "الأرخص", ppm: "الأرخص سعر متر", area: "الأكبر" },
    results: (n: number) => `${num(n)} أرض`,
    prev: "اللي قبله",
    next: "اللي بعده",
    weights: "أوزان الترتيب",
    weightsReset: "رجّع الأوزان الافتراضية",
    empty: "مفيش نتايج.",
  },
  how: {
    title: "إزاي بنحسب؟",
    queue: (perBatch: number, perWeek: number, codes: number, lo: string, hi: string, mid: string) =>
      `هيئة المجتمعات بتبعت دفعة أكواد حجز كل يوم عمل (${num(perWeek)} أيام في الأسبوع من الحد للخميس، والجمعة والسبت إجازة)، وحجم الدفعة دلوقتي ${num(perBatch)} كود وممكن تزيد. اتبعت ${num(codes)} كود لحد دلوقتي، يعني اللي ترتيبهم لحد ${num(codes)} اتنادوا. نسبة اللي بيحجز فعلاً من كل دفعة ما بين ${lo} و ${hi} (المتوسط ${mid}).`,
    official: (through: number, day: string, next: { from: number; to: number | null; day: string } | null) => {
      const base = `الأرقام دي من أخبار موقع أراضي الهيئة الرسمي: اتبعت أكواد لحد مسلسل ${num(through)} يوم ${day}`;
      if (!next) return `${base}.`;
      const to = next.to == null ? "" : ` لـ ${num(next.to)}`;
      return `${base}، والدفعة الجاية من ${num(next.from)}${to} يوم ${next.day}.`;
    },
    officialStale: (day: string) => `آخر خبر رسمي على موقع الهيئة من ${day} أقدم من بيانات الدفعات، فبنحسب على بيانات الدفعات.`,
    officialLink: "الخبر على موقع الهيئة",
    late: (unbooked: number, mid: string, hi: string) =>
      `فيه حوالي ${num(unbooked)} واحد خدوا كود قبل كده ولسه ماحجزوش. لو لسه يقدروا يحجزوا، بنفترض إن ${mid} منهم هيحجزوا قبلك (وفي أسوأ حالة ${hi}).`,
    demand: (gc: number, g: number, c: number) =>
      `الحجوزات الجاية بتتوزع على المناطق حسب الطلب في آخر أسبوع، ولما منطقة تخلص الطلب بيروح لغيرها. جوه كل منطقة، الحديقة+الناصية بتتحجز أسرع ${num(gc, 1)} مرة، الحديقة ${num(g, 1)} مرة، والناصية ${num(c, 1)} مرة من الأرض العادية (من الحجوزات اللي حصلت فعلاً).`,
    nearBuilt:
      "«قربها من العمار» = المسافة لأقرب مباني قائمة على خرايط «أوبن ستريت ماب» (لو الأرض مالهاش إحداثيات بناخد نص منطقتها)، مع نسبة الأراضي اللي حواليها اتحجزت (٤٠٠ متر).",
    street:
      "«على شارع رئيسي» = حدود الأرض على بُعد ٣٠ متر أو أقل من محور شارع رئيسي متسجّل على «أوبن ستريت ماب». ده مش من بيانات الهيئة ومالوش تميّز في السعر، والخرايط في المدن الجديدة ممكن تكون ناقصة.",
    units: `«عدد الشقق في الدور» محسوب من مساحة الأرض حسب تنويه الوزارة للطرح الحادي عشر: حتى ${num(UNITS.twoUpToM2)} م² شقتين، من ${num(UNITS.twoUpToM2 + 1)} لـ ${num(UNITS.threeUpToM2)} م² ٣ شقق، من ${num(UNITS.threeUpToM2 + 1)} لـ ${num(UNITS.fourUpToM2)} م² ٤ شقق، و${num(UNITS.fourUpToM2 + 1)} م² فأكتر ٥ شقق (بشرط إن الشقة ماتقلش عن ١٠٠ م² وتوفير أماكن ركن). الأرض اللي فيها ٣ شقق أو أكتر بتاخد تقييم أعلى. في العلمين الجديدة جهاز المدينة بيحدد عدد الوحدات لكل قطعة حسب البلوك، فمفيش رقم في الدور ولا زيادة في التقييم.`,
    assumptions: [
      "افتراض: أكواد الحجز بتتبعت بالترتيب.",
      "افتراض: الدفعات الجاية هتتحجز بنفس نسبة الدفعات الأخيرة.",
      "لما موقع الهيئة الرسمي ينشر خبر بنفس يوم آخر دفعة أو أحدث، أرقامه هي اللي بتتحسب.",
      "أحسن احتمال: الدفعات تكبر لحد ٣٣٪؛ أسوأ احتمال: نفس حجم الدفعة الحالية.",
      "الأرض متاحة لو المقدم أقل من أو يساوي المبلغ اللي دفعته.",
    ],
  },
  reasons: {
    gardenCorner: "حديقة + ناصية",
    garden: "على حديقة",
    corner: "ناصية (على شارعين)",
    street: "على شارع رئيسي",
    units: (n: number) => `ينفع ${num(n)} شقق في الدور`,
    high: (p: number) => `فرصة كبيرة (${num(p)}٪) تكون لسه فاضية في دورك`,
    mid: (p: number) => `فرصة متوسطة (${num(p)}٪) تفضل لحد دورك`,
    low: (p: number) => `فرصة ضعيفة (${num(p)}٪) تفضل لحد دورك`,
    nearBuilt: (d: string) => `قريبة من مباني قائمة (${d})`,
    neighbours: "حواليها أراضي كتير اتحجزت",
    cheap: "سعر المتر أرخص من اللي زيها في نفس المدينة",
    preferred: "في المكان اللي بتفضله",
    fastSelling: "🔥 المنطقة دي بتتحجز بسرعة الأيام دي",
  },
  detail: {
    back: "→ ارجع للرئيسية",
    available: "متاحة",
    booked: "اتحجزت",
    rankOf: (n: number) => `رقم ${num(n)} في الأراضي المناسبة ليك`,
    total: "السعر الكلي",
    base: "سعر المتر الأساسي",
    premiums: (c: number, g: number, s: number) => `ناصية ${num(c)}٪ · حديقة ${num(g)}٪ · فيو ${num(s)}٪`,
    premiumsLabel: "الزيادات",
    budget: "ميزانيتك",
    /** Shown for the budget when no payment has been entered; links to the home page form. */
    budgetUnset: "مش محددة — اكتب اللي دفعته في الرئيسية",
    over: "(أكتر من ميزانيتك)",
    nucaId: "رقم القطعة في الهيئة",
    map: "افتح الخريطة ↗",
    location: "المكان",
    approxSector: "(تقريبي: مكان المنطقة، الهيئة منشرتش مكان القطعة)",
    approxCity: "(تقريبي: المدينة بس، الهيئة منشرتش مكان المنطقة)",
    mapTitle: "مكان القطعة",
    thisPlot: (n: string) => `قطعة ${n}`,
    approxArea: "القطعة في المنطقة دي تقريبًا",
    legendThis: "القطعة دي",
    legendAvailable: "متاحة",
    legendBooked: "اتحجزت",
    /** Map checkbox: hide the booked plots. */
    onlyAvailable: "اعرض المتاح بس",
    mapNote: "النقط هي باقي قطع المنطقة. دوس على أي نقطة تفتحها.",
    builtDist: "أقرب مباني قائمة",
    builtFromSector: "(محسوبة من نص المنطقة)",
    roadDist: "على شارع رئيسي",
    roadNote: "(من الخرايط، مش تميّز من الهيئة)",
    neighbours: "الأراضي اللي حواليها اتحجزت",
    breakdown: "تفاصيل التقييم",
    chanceTitle: "فرصة إنها تفضل فاضية لحد دورك",
    chanceText: (mid: string, lo: string, hi: string) => `المتوقع ${mid}. في الأسوأ ${lo}، وفي الأحسن ${hi}.`,
    sector: (avail: number, recent: number, exp: number, left: number) =>
      `المنطقة فيها ${num(avail)} أرض متاحة. اتحجز ${num(recent)} في آخر أسبوع. متوقع يتحجز ${num(exp)} قبل دورك، ويفضل حوالي ${num(left)}.`,
    notEligible: (booked: boolean) => (booked ? "الأرض دي اتحجزت خلاص." : "الأرض دي برا ميزانيتك أو فلاترك."),
    source: (when: string) => `آخر تحديث للأرض من موقع الهيئة الرسمي ${when}`,
    notFound: "الأرض دي مش موجودة.",
  },
  /** The 404 page. */
  notFound: {
    title: "الصفحة دي مش موجودة",
    text: "يمكن الرابط اتغير أو فيه غلطة في الكتابة. تقدر ترجع للرئيسية أو تشوف الأراضي المتاحة.",
    home: "ارجع للرئيسية",
    available: "الأراضي المتاحة",
  },
  /** Private compounds outlined on the maps (public/compounds, from Nawy's listings). */
  compound: {
    /** Map button that shows/hides the compounds. */
    toggle: "كمبوندات",
    toggleTitle: "إظهار أو إخفاء الكمبوندات اللي حوالين الأراضي",
    /** Lowest listed unit price in the compound, in EGP: rounded, since it is only as fresh as the last fetch. */
    from: (egp: number) => `الأسعار تبدأ من حوالي ${millions(egp)} جنيه`,
    legend: "كمبوندات خاصة (دوس عليها للتفاصيل)",
  },
  /** Official zone plans drawn over the satellite maps (public/plans). */
  plan: {
    /** Map button that shows/hides the plan image (the plot shapes stay). */
    toggle: "المخطط",
    toggleTitle: "إظهار أو إخفاء صورة المخطط الرسمي",
    /** Status word on a plot shape: available but someone filed a preliminary booking on it. */
    held: "عليها حجز مبدئي",
    legendHeld: "متاحة وعليها حجز مبدئي",
    /** Legend of the greyed plan images of earlier offerings under the current stage. */
    legendPast: "مخططات مراحل سابقة (للتوضيح بس)",
    /** Tooltip on a plot shape whose number could not be read off the plan. */
    unknown: "قطعة من المخطط لم يتم التعرف على رقمها",
    note: "شكل القطع من مخطط الهيئة الرسمي: الأخضر متاح، البرتقالي عليه حجز مبدئي، والأحمر اتحجز. دوس على أي قطعة تفتحها.",
  },
  market: {
    title: "حالة السوق",
    last24: "اتحجز في آخر ٢٤ ساعة",
    perHour: (n: number) => `${num(n, 1)} في الساعة`,
    last7: "اتحجز في آخر ٧ أيام",
    perDay: (n: number) => `${num(n)} في اليوم`,
    conversion: "نسبة اللي بيحجز",
    conversionSub: (lo: string, hi: string) => `ما بين ${lo} و ${hi} من الأكواد`,
    days: "فاضل كام يوم على دورك",
    daysSub: (lo: number, hi: number) => `ما بين ${num(lo)} و ${num(hi)} يوم`,
    eta: "إمتى كود الحجز بتاعك هييجي؟",
    etaNote: "دفعة كل يوم عمل من الحد للخميس (الجمعة والسبت إجازة، والإجازات الرسمية مش محسوبة). دي تقديرات مش مضمونة، وبتعتمد على إن الهيئة تفضل بنفس حجم الدفعات أو تزوّدها.",
    best: "بدري",
    expected: "المتوقع",
    worst: "متأخر",
    perBatch: (n: number) => `${num(n)} كود في الدفعة`,
    perDayChart: "الحجوزات كل يوم",
    remainingChart: "الأراضي اللي لسه متاحة",
    batchesChart: "الأكواد اللي اتبعتت والحجوزات في كل دفعة",
    codes: "أكواد",
    bookings: "حجوزات",
    hourlyChart: "الحجوزات كل ساعة (آخر ٤٨ ساعة)",
    dpChart: "توزيع المقدم (دولار)",
    areaChart: "توزيع المساحات (م²)",
    availableS: "متاح",
    bookedS: "اتحجز",
    popular: "أكتر المناطق طلباً (آخر أسبوع)",
    fastest: "المناطق اللي بتخلص بسرعة",
    colProject: "المنطقة",
    col7d: "حجوزات الأسبوع",
    colLeft: "فاضل",
    colBooked: "اتحجز",
    colPct: "نسبة المحجوز",
    colSellOut: "هتخلص في",
    days_: (n: number) => (n < 1 ? "أقل من يوم" : `~${num(Math.round(n))} يوم`),
  },
};
