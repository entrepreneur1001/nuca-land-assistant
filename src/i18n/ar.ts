/** All user-facing text, in Egyptian Arabic. */

const nf = (digits = 0) => new Intl.NumberFormat("ar-EG", { maximumFractionDigits: digits });
export const num = (n: number | null | undefined, digits = 0) =>
  n == null || !Number.isFinite(n) ? "—" : nf(digits).format(n);
export const usd = (n: number | null | undefined) => (n == null ? "—" : `${num(n)} دولار`);
export const pct = (n: number | null | undefined) => (n == null ? "—" : `${num(Math.round(n * 100))}٪`);
export const km = (n: number | null | undefined) =>
  n == null ? "مش معروف" : n >= 5 ? "٥ كم أو أكتر" : n < 1 ? `${num(Math.round(n * 1000))} متر` : `${num(n, 1)} كم`;
export const date = (iso: string | Date | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("ar-EG", { day: "numeric", month: "long", year: "numeric" }) : "—";
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
    full: "الموقع ده مش رسمي ومش تابع لهيئة المجتمعات العمرانية الجديدة ولا لأي جهة حكومية. البيانات متجمعة من مصادر عامة ومتاحة للكل، وممكن تتأخر أو يبقى فيها أخطاء، وكل التوقعات والترتيب تقديرية ومفيهاش أي ضمان. الموقع مبيحجزش أراضي ومبيطلبش أي بيانات شخصية. اتأكد دايماً من الأرض والسعر والاشتراطات على موقع الهيئة الرسمي قبل ما تحجز.",
    official: "موقع الهيئة الرسمي",
  },
  rules: {
    title: "الاشتراطات البنائية",
    ratio: "نسبة البناء",
    floors: "الارتفاع المسموح",
    setbacks: "الردود",
    units: "عدد الشقق في الدور",
    unitsValue: (n: number) => `${num(n)} شقق`,
    unitsNote3: "الشقة التالتة بعد دفع رسوم ترخيصها لجهاز المدينة.",
    unitsNote4: "الشقة التالتة والرابعة بعد دفع رسوم ترخيصهم لجهاز المدينة واستيفاء أماكن الركن.",
    unitsBasis: "محسوبة من مساحة الأرض: أقل من ٧٣٠ م² = شقتين، من ٧٣٠ لـ ٩٥٠ م² = ٣ شقق، أكتر من ٩٥٠ م² = ٤ شقق.",
    note: "منقولة من بيانات الطرح للمنطقة، اتأكد منها من كراسة الشروط.",
    noteBooklet: "منقولة من كراسة شروط الطرح الرسمية (المصدر مانشرهاش للمنطقة دي)، اتأكد منها قبل الحجز.",
  },
  tagline: "بترتيبك وفلوسك… إيه أحسن أرض تقدر تحجزها؟",
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
      intro: (p: PhaseName) =>
        `قبل ما تختار أرض في المرحلة ${p.numAr} اعرف هتبني عليها إيه: نسبة البناء من مساحة الأرض، الارتفاع المسموح (أرضي + كام دور)، والردود من الأمام والخلف والجنب. الأرقام دي بتختلف من منطقة للتانية حتى جوه نفس المدينة.`,
      byCityH: "الاشتراطات حسب المدينة والمنطقة",
      area: "المنطقة",
      notesH: "ملاحظات مهمة من كراسة الشروط",
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
    ahead: (ahead: number, before: number, lo: number, hi: number, left: number) =>
      `قدامك حوالي ${num(ahead)} واحد. متوقع ${num(before)} منهم يحجزوا قبلك (ما بين ${num(lo)} و ${num(hi)})، ويفضل في السوق كله حوالي ${num(left)} أرض.`,
    high: (n: number) => `${num(n)} اختيار فرصته عالية`,
    medium: (n: number) => `${num(n)} اختيار فرصته متوسطة`,
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
  top5: "أحسن ٥ أراضي ليك",
  card: {
    plot: "قطعة",
    area: "المساحة",
    price: "السعر",
    dp: "المقدم",
    ppm: "سعر المتر",
    m2: "م²",
    score: "التقييم",
    chance: "فرصتك",
  },
  badge: { garden: "🌳 حديقة", corner: "📐 ناصية", street: "🛣️ شارع رئيسي", units: (n: number) => `🏢 ${num(n)} شقق/دور`, sea: "🌊 فيو", nearBuilt: "🏘️ قريبة من العمار" },
  ai: {
    title: "رأي الذكاء الاصطناعي",
    button: "اسأل الذكاء الاصطناعي",
    again: "حلّل تاني",
    running: "بيحلّل…",
    cooldown: (s: number) => `استنى ${num(s)} ثانية`,
    failed: "التحليل مانجحش، الترتيب العادي لسه شغال.",
    dailyCap: "الذكاء الاصطناعي عليه ضغط دلوقتي، جرّب كمان شوية.",
    cached: "نتيجة محفوظة",
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
    sorts: { score: "التقييم", reach: "فرصة الوصول", nearBuilt: "القرب من العمار", price: "الأرخص", area: "الأكبر" },
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
      `هيئة المجتمعات بتبعت أكواد الحجز على دفعات (آخر الدفعات ${num(perBatch)} كود، حوالي ${num(perWeek, 1)} دفعات في الأسبوع). اتبعت ${num(codes)} كود لحد دلوقتي، يعني اللي ترتيبهم لحد ${num(codes)} اتنادوا. نسبة اللي بيحجز فعلاً من كل دفعة ما بين ${lo} و ${hi} (المتوسط ${mid}).`,
    demand: (gc: number, g: number, c: number) =>
      `الحجوزات الجاية بتتوزع على المناطق حسب الطلب في آخر أسبوع، ولما منطقة تخلص الطلب بيروح لغيرها. جوه كل منطقة، الحديقة+الناصية بتتحجز أسرع ${num(gc, 1)} مرة، الحديقة ${num(g, 1)} مرة، والناصية ${num(c, 1)} مرة من الأرض العادية (من الحجوزات اللي حصلت فعلاً).`,
    nearBuilt:
      "«قربها من العمار» = المسافة لأقرب مباني قائمة على خرايط «أوبن ستريت ماب» (لو الأرض مالهاش إحداثيات بناخد نص منطقتها)، مع نسبة الأراضي اللي حواليها اتحجزت (٤٠٠ متر).",
    street:
      "«على شارع رئيسي» = حدود الأرض على بُعد ٣٠ متر أو أقل من محور شارع رئيسي متسجّل على «أوبن ستريت ماب». ده مش من بيانات الهيئة ومالوش تميّز في السعر، والخرايط في المدن الجديدة ممكن تكون ناقصة.",
    units:
      "«عدد الشقق في الدور» محسوب من مساحة الأرض: أقل من ٧٣٠ م² شقتين، من ٧٣٠ لـ ٩٥٠ م² ٣ شقق (بعد دفع رسوم ترخيص الشقة التالتة)، وأكتر من ٩٥٠ م² ٤ شقق (بعد دفع رسوم الترخيص واستيفاء أماكن الركن). الأرض اللي فيها ٣ أو ٤ شقق بتاخد تقييم أعلى.",
    assumptions: [
      "افتراض: أكواد الحجز بتتبعت بالترتيب.",
      "افتراض: الدفعات الجاية هتتحجز بنفس نسبة الدفعات الأخيرة.",
      "أحسن احتمال: الدفعات تكبر لحد ٣٣٪؛ أسوأ احتمال: أصغر دفعة حصلت.",
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
    over: "(أكتر من ميزانيتك)",
    nucaId: "رقم القطعة في الهيئة",
    map: "افتح الخريطة ↗",
    location: "المكان",
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
    source: (when: string) => `آخر تحديث للأرض من المصدر ${when}`,
    notFound: "الأرض دي مش موجودة.",
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
    etaNote: "دي تقديرات مش مضمونة، وبتعتمد على إن الهيئة تفضل بنفس حجم الدفعات ومواعيدها.",
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
    col7d: "أسبوع",
    colLeft: "فاضل",
    colBooked: "اتحجز",
    colSellOut: "هتخلص في",
    days_: (n: number) => `~${num(n)} يوم`,
  },
};
