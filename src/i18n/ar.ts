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
  premium: "حديقة / ناصية",
  budget: "مناسبة لميزانيتك",
  location: "المكان اللي بتفضله",
  value: "سعر المتر مقارنة باللي زيها",
  area: "المساحة",
};

export const t = {
  appName: "مساعد أراضي بيت الوطن",
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
    none: "الاشتراطات مش منشورة للمنطقة دي، شوف كراسة الشروط على موقع الهيئة.",
    note: "منقولة من بيانات الطرح للمنطقة، اتأكد منها من كراسة الشروط.",
  },
  tagline: "بترتيبك وفلوسك… إيه أحسن أرض تقدر تحجزها؟",
  nav: { home: "الرئيسية", market: "السوق" },
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
    extra: "أقصى زيادة تقدر تدفعها (دولار)",
    garden: "🌳 حديقة",
    corner: "📐 ناصية",
    nearBuilt: "🏘️ قريبة من العمار",
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
    none: "مفيش أراضي مناسبة لميزانيتك وفلاترك. جرّب تزوّد الزيادة اللي تقدر تدفعها أو تخفّف الفلاتر.",
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
  badge: { garden: "🌳 حديقة", corner: "📐 ناصية", sea: "🌊 فيو", nearBuilt: "🏘️ قريبة من العمار" },
  ai: {
    title: "رأي الذكاء الاصطناعي",
    button: "اسأل الذكاء الاصطناعي",
    again: "حلّل تاني",
    running: "بيحلّل…",
    cooldown: (s: number) => `استنى ${num(s)} ثانية`,
    note: "بيحلّل الأراضي اللي إحنا بعتناها له بس، ومينفعش يخترع أرض مش موجودة.",
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
    assumptions: [
      "افتراض: أكواد الحجز بتتبعت بالترتيب.",
      "افتراض: الدفعات الجاية هتتحجز بنفس نسبة الدفعات الأخيرة.",
      "أحسن احتمال: الدفعات تكبر لحد ٣٣٪؛ أسوأ احتمال: أصغر دفعة حصلت.",
      "الأرض متاحة لو المقدم أقل من أو يساوي اللي دفعته + الزيادة اللي تقدر عليها.",
    ],
    source: (name: string) =>
      `مصدر البيانات: ${name}، موقع بيتابع الأراضي من الموقع الرسمي. كل الأرقام تقديرية، اتأكد من الأرض على موقع الهيئة قبل الحجز.`,
  },
  reasons: {
    gardenCorner: "حديقة + ناصية",
    garden: "على حديقة",
    corner: "ناصية",
    covered: "المقدم مغطّى باللي دفعته",
    extra: (n: number) => `محتاجة ${num(n)} دولار زيادة للمقدم`,
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
