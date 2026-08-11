/* Guest-facing copy for event invitations.

   Deliberately client-safe — NO db import, no "server-only" — because the
   language switcher on the invite page is a client component and imports this
   directly. Same constraint as lib/locations.js.

   Arabic is present from day one on purpose. Retrofitting RTL after the layout
   exists means auditing every margin, every icon direction and every flex row;
   carrying `dir` through from the start costs almost nothing. English and Malay
   are the two that ship reviewed — Arabic strings are in place and correct, but
   have a native speaker read them before an event goes out to Arabic guests.

   REGISTER POLICY (from the Aug 2026 copy audit): the first line of any first
   contact is a salam; every acceptance says *Alhamdulillah* (Arabic must use
   الحمد لله, not ما شاء الله); *insyaAllah* appears where a future meeting is
   hoped for; it is a "reply", never an "RSVP"; the sender is "Little Quran
   Kids", never "your host"; links are "shared", never "forwarded". */

export const LANGS = [
  { code: "en", label: "English", native: "English", dir: "ltr" },
  { code: "ms", label: "Malay", native: "Bahasa Melayu", dir: "ltr" },
  { code: "ar", label: "Arabic", native: "العربية", dir: "rtl" },
];

export const DEFAULT_LANG = "en";

export function isLang(code) {
  return LANGS.some((l) => l.code === code);
}

export function dirFor(lang) {
  return LANGS.find((l) => l.code === lang)?.dir || "ltr";
}

export function isRtl(lang) {
  return dirFor(lang) === "rtl";
}

/* The ten decline reasons, in the order they appear in the dropdown. The KEY is
   what the database stores — labels can be reworded freely without touching
   saved replies. "other" reveals a one-line text input and requires it. */
export const DECLINE_REASONS = [
  "away",
  "work",
  "familyEvent",
  "unwell",
  "caring",
  "transport",
  "school",
  "newborn",
  "lateNight",
  "other",
];

export function isDeclineReason(key) {
  return DECLINE_REASONS.includes(key);
}

const STRINGS = {
  en: {
    salam: "Assalamu'alaikum",
    inviteLine: "We would like to invite you and your family to",
    hostedBy: "Hosted by",
    when: "When",
    where: "Where",
    dressCode: "Dress code",
    addToCalendar: "Add to calendar",
    getDirections: "Get directions",
    rsvpTitle: "Will you join us?",
    replyBy: "Please reply by {date}.",
    partyCap: "Up to {n} people on this invitation.",
    yes: "Yes, we'll be there",
    no: "Sorry, we can't make it",
    whyTitle: "May we ask why?",
    whyHint: "It helps us plan future majlis around families.",
    chooseReason: "Choose a reason",
    reason_away: "Away or travelling that weekend",
    reason_work: "Work commitment",
    reason_familyEvent: "Another family event — kenduri or wedding",
    reason_unwell: "Unwell or medical appointment",
    reason_caring: "Caring for someone at home",
    reason_transport: "Travel or transport is difficult",
    reason_school: "Clashes with school or exams",
    reason_newborn: "Expecting or with a newborn",
    reason_lateNight: "The timing is too late for young children",
    reason_other: "Another reason — tell us in a line",
    reasonOtherLabel: "Tell us in a line",
    reasonRequired: "Please choose a reason — it helps us plan.",
    adults: "Adults",
    children: "Children",
    fewerAdult: "One fewer adult",
    moreAdult: "One more adult",
    fewerChild: "One fewer child",
    moreChild: "One more child",
    adultOne: "adult",
    adultMany: "adults",
    childOne: "child",
    childMany: "children",
    partyNames: "Names of those joining you",
    partyNamesHint: "One name per line — helps us with seating",
    message: "A message for us",
    photoTitle: "Share a family photo",
    photoHint: "We're making something special with these. Optional.",
    photoConsent: "I'm happy for this photo to be used in event materials",
    familyName: "Family name",
    familyNameHint: "How your family should be named on the photo",
    choosePhoto: "Choose a photo",
    changePhoto: "Change photo",
    contribTitle: "Family contribution",
    contribRequired: "Required",
    contribBody:
      "Every attending family contributes one hamper towards the majlis. Your reply is complete once checkout is confirmed.",
    contribCta: "Contribute & continue",
    contribSmall:
      "Opens the Shopify checkout on the school store, tagged to this invitation, then returns you here.",
    contribPaidLine: "Paid · {qty} × {title} — carried into your reply",
    contribPendingNote:
      "Waiting for the store to confirm your checkout — this page updates on its own.",
    contribIncomplete: "Please complete the contribution to finish your reply.",
    contribution: "Contribution",
    paidOn: "paid {date}",
    submit: "Send my reply",
    update: "Update my reply",
    saving: "Sending…",
    thanksYes: "Alhamdulillah — we can't wait to see you.",
    thanksNo: "Thank you for letting us know. You'll be missed.",
    youReplied: "You replied",
    changeReply: "Change my reply",
    closed: "Replies for this event are now closed.",
    closedBody: "If your plans have changed, please contact Little Quran Kids.",
    notFound: "This invitation link isn't valid.",
    notFoundBody: "Please check the link you were sent, or contact Little Quran Kids.",
    language: "Language",
    required: "Please choose a reply.",
    tooLarge: "That photo is too large — please choose a smaller one.",
    partyTooBig: "That's more guests than this invitation covers — please contact Little Quran Kids.",
    photoFailed:
      "Your reply was saved, but the photo didn't upload. Tap 'Change my reply' to try the photo again.",
    error: "Something went wrong. Please try again.",
  },
  ms: {
    salam: "Assalamu'alaikum",
    inviteLine: "Kami ingin menjemput anda sekeluarga ke",
    hostedBy: "Dianjurkan oleh",
    when: "Tarikh & Masa",
    where: "Tempat",
    dressCode: "Kod pakaian",
    addToCalendar: "Tambah ke kalendar",
    getDirections: "Dapatkan arah",
    rsvpTitle: "Sudikah anda hadir?",
    replyBy: "Sila balas sebelum {date}.",
    partyCap: "Sehingga {n} orang bagi jemputan ini.",
    yes: "Ya, kami akan hadir",
    no: "Maaf, kami tidak dapat hadir",
    whyTitle: "Boleh kami tahu sebabnya?",
    whyHint: "Ia membantu kami merancang majlis akan datang untuk keluarga.",
    chooseReason: "Pilih sebab",
    reason_away: "Berada di luar atau dalam perjalanan hujung minggu itu",
    reason_work: "Komitmen kerja",
    reason_familyEvent: "Acara keluarga lain — kenduri atau majlis perkahwinan",
    reason_unwell: "Kurang sihat atau ada temujanji perubatan",
    reason_caring: "Menjaga ahli keluarga di rumah",
    reason_transport: "Perjalanan atau pengangkutan menyukarkan",
    reason_school: "Bertembung dengan sekolah atau peperiksaan",
    reason_newborn: "Sedang menanti cahaya mata atau baru bersalin",
    reason_lateNight: "Masanya terlalu lewat untuk anak kecil",
    reason_other: "Sebab lain — beritahu kami sebaris",
    reasonOtherLabel: "Beritahu kami sebaris",
    reasonRequired: "Sila pilih sebab — ia membantu kami merancang.",
    adults: "Dewasa",
    children: "Kanak-kanak",
    fewerAdult: "Kurang seorang dewasa",
    moreAdult: "Tambah seorang dewasa",
    fewerChild: "Kurang seorang kanak-kanak",
    moreChild: "Tambah seorang kanak-kanak",
    adultOne: "dewasa",
    adultMany: "dewasa",
    childOne: "kanak-kanak",
    childMany: "kanak-kanak",
    partyNames: "Nama mereka yang bersama anda",
    partyNamesHint: "Satu nama setiap baris — membantu kami mengatur tempat duduk",
    message: "Pesanan untuk kami",
    photoTitle: "Kongsi gambar keluarga",
    photoHint: "Kami sedang menyediakan sesuatu yang istimewa. Pilihan sahaja.",
    photoConsent: "Saya bersetuju gambar ini digunakan untuk bahan acara",
    familyName: "Nama keluarga",
    familyNameHint: "Bagaimana keluarga anda dinamakan pada gambar",
    choosePhoto: "Pilih gambar",
    changePhoto: "Tukar gambar",
    contribTitle: "Sumbangan keluarga",
    contribRequired: "Wajib",
    contribBody:
      "Setiap keluarga yang hadir menyumbang satu hamper untuk majlis ini. Jawapan anda lengkap setelah pembayaran disahkan.",
    contribCta: "Beri sumbangan & teruskan",
    contribSmall:
      "Membuka pembayaran Shopify di kedai sekolah, ditandakan pada jemputan ini, kemudian kembali ke sini.",
    contribPaidLine: "Dibayar · {qty} × {title} — disertakan dalam jawapan anda",
    contribPendingNote:
      "Menunggu pengesahan pembayaran daripada kedai — halaman ini dikemas kini sendiri.",
    contribIncomplete: "Sila lengkapkan sumbangan untuk menghantar jawapan anda.",
    contribution: "Sumbangan",
    paidOn: "dibayar {date}",
    submit: "Hantar jawapan saya",
    update: "Kemas kini jawapan saya",
    saving: "Menghantar…",
    thanksYes: "Alhamdulillah — kami menantikan kehadiran anda, insyaAllah.",
    thanksNo: "Terima kasih kerana memaklumkan. Kami akan merindui anda.",
    youReplied: "Anda telah menjawab",
    changeReply: "Tukar jawapan saya",
    closed: "Jawapan untuk acara ini telah ditutup.",
    closedBody: "Jika rancangan anda berubah, sila hubungi Little Quran Kids.",
    notFound: "Pautan jemputan ini tidak sah.",
    notFoundBody: "Sila semak pautan yang dihantar kepada anda, atau hubungi Little Quran Kids.",
    language: "Bahasa",
    required: "Sila pilih jawapan anda.",
    tooLarge: "Gambar itu terlalu besar — sila pilih yang lebih kecil.",
    partyTooBig: "Jumlah tetamu melebihi jemputan ini — sila hubungi Little Quran Kids.",
    photoFailed:
      "Jawapan anda telah disimpan, tetapi gambar gagal dimuat naik. Tekan 'Tukar jawapan saya' untuk mencuba gambar semula.",
    error: "Sesuatu tidak kena. Sila cuba lagi.",
  },
  ar: {
    salam: "السلام عليكم",
    inviteLine: "يسعدنا دعوتكم وعائلتكم إلى",
    hostedBy: "بدعوة من",
    when: "الموعد",
    where: "المكان",
    dressCode: "الزي",
    addToCalendar: "أضف إلى التقويم",
    getDirections: "الاتجاهات",
    rsvpTitle: "هل ستشرفوننا بالحضور؟",
    replyBy: "نرجو الرد قبل {date}.",
    partyCap: "حتى {n} أشخاص في هذه الدعوة.",
    yes: "نعم، سنحضر",
    no: "نعتذر، لا نستطيع الحضور",
    whyTitle: "هل لنا أن نعرف السبب؟",
    whyHint: "يساعدنا ذلك في تنظيم المجالس القادمة بما يناسب العائلات.",
    chooseReason: "اختاروا سبباً",
    reason_away: "مسافرون أو خارج البلد في تلك العطلة",
    reason_work: "ارتباط بالعمل",
    reason_familyEvent: "مناسبة عائلية أخرى — وليمة أو زواج",
    reason_unwell: "وعكة صحية أو موعد طبي",
    reason_caring: "رعاية أحد أفراد الأسرة في المنزل",
    reason_transport: "صعوبة في التنقل أو المواصلات",
    reason_school: "يتعارض مع المدرسة أو الامتحانات",
    reason_newborn: "في انتظار مولود أو معنا مولود جديد",
    reason_lateNight: "الوقت متأخر على الأطفال الصغار",
    reason_other: "سبب آخر — أخبرونا بسطر واحد",
    reasonOtherLabel: "أخبرونا بسطر واحد",
    reasonRequired: "يرجى اختيار سبب — فهو يساعدنا على التخطيط.",
    adults: "البالغون",
    children: "الأطفال",
    fewerAdult: "إنقاص بالغ واحد",
    moreAdult: "زيادة بالغ واحد",
    fewerChild: "إنقاص طفل واحد",
    moreChild: "زيادة طفل واحد",
    adultOne: "بالغ",
    adultMany: "بالغون",
    childOne: "طفل",
    childMany: "أطفال",
    partyNames: "أسماء المرافقين",
    partyNamesHint: "اسم في كل سطر — يساعدنا في ترتيب الجلوس",
    message: "رسالة لنا",
    photoTitle: "شاركونا صورة العائلة",
    photoHint: "نحضّر بها شيئاً مميزاً. اختياري.",
    photoConsent: "أوافق على استخدام هذه الصورة في مواد الفعالية",
    familyName: "اسم العائلة",
    familyNameHint: "كيف يُكتب اسم عائلتكم على الصورة",
    choosePhoto: "اختر صورة",
    changePhoto: "تغيير الصورة",
    contribTitle: "مساهمة العائلة",
    contribRequired: "مطلوبة",
    contribBody:
      "تساهم كل عائلة حاضرة بسلة واحدة لدعم المجلس. يكتمل ردكم بعد تأكيد الدفع.",
    contribCta: "المساهمة والمتابعة",
    contribSmall:
      "يفتح صفحة الدفع في متجر المدرسة، مرتبطةً بهذه الدعوة، ثم تعودون إلى هنا.",
    contribPaidLine: "مدفوعة · {qty} × {title} — أُدرجت في ردكم",
    contribPendingNote: "بانتظار تأكيد الدفع من المتجر — تتحدث هذه الصفحة تلقائياً.",
    contribIncomplete: "يرجى إتمام المساهمة لإكمال ردكم.",
    contribution: "المساهمة",
    paidOn: "دُفعت {date}",
    submit: "إرسال ردي",
    update: "تحديث ردي",
    saving: "جارٍ الإرسال…",
    thanksYes: "الحمد لله — بانتظار تشريفكم إن شاء الله.",
    thanksNo: "شكراً لإعلامنا. سنفتقدكم.",
    youReplied: "ردكم المسجَّل",
    changeReply: "تعديل ردي",
    closed: "أُغلق باب الرد على هذه الدعوة.",
    closedBody: "إذا تغيرت خططكم، يرجى التواصل مع Little Quran Kids.",
    notFound: "رابط الدعوة غير صالح.",
    notFoundBody: "يرجى التحقق من الرابط المرسل إليكم، أو التواصل مع Little Quran Kids.",
    language: "اللغة",
    required: "يرجى اختيار الرد.",
    tooLarge: "حجم الصورة كبير — يرجى اختيار صورة أصغر.",
    partyTooBig: "عدد الضيوف يتجاوز ما تغطيه هذه الدعوة — يرجى التواصل مع Little Quran Kids.",
    photoFailed: "حُفظ ردكم، لكن الصورة لم تُرفع. اضغطوا «تعديل ردي» لمحاولة رفع الصورة مرة أخرى.",
    error: "حدث خطأ ما. يرجى المحاولة مرة أخرى.",
  },
};

/* Returns a lookup function rather than the object so a missing key falls back
   to English instead of rendering `undefined` on a guest's screen. */
export function t(lang) {
  const table = STRINGS[lang] || STRINGS[DEFAULT_LANG];
  const fallback = STRINGS[DEFAULT_LANG];
  return (key) => table[key] ?? fallback[key] ?? key;
}

/* Tiny template fill for the handful of strings that carry a value —
   fmt(t("replyBy"), { date: "1 September" }). Unknown names resolve empty so a
   missed variable can never print "{date}" to a guest. */
export function fmt(template, vars = {}) {
  return String(template).replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? ""));
}

/* The label for a stored decline-reason key, in the asked-for language. */
export function declineReasonLabel(lang, key) {
  if (!key) return "";
  return t(lang)(`reason_${key}`);
}

/* "2 adults, 3 children" with singulars handled — used in the reply summary. */
export function partyLine(lang, adults, children) {
  const table = t(lang);
  const parts = [];
  if (adults > 0) parts.push(`${adults} ${table(adults === 1 ? "adultOne" : "adultMany")}`);
  if (children > 0) parts.push(`${children} ${table(children === 1 ? "childOne" : "childMany")}`);
  return parts.join(lang === "ar" ? "، " : ", ");
}

/* Dates are stored as Singapore wall time and must READ as Singapore time to a
   guest in any timezone — an invite that says 7pm has to say 7pm in Doha too. */
export function formatEventDate(iso, lang) {
  if (!iso) return "";
  const locale = { en: "en-SG", ms: "ms-MY", ar: "ar" }[lang] || "en-SG";
  try {
    return new Intl.DateTimeFormat(locale, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "Asia/Singapore",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function formatDeadline(iso, lang) {
  if (!iso) return "";
  const locale = { en: "en-SG", ms: "ms-MY", ar: "ar" }[lang] || "en-SG";
  try {
    return new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Asia/Singapore",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/* Exported for the i18n parity test only — every language must define every
   key, so a new string can never silently fall back to English in production. */
export function allStringTables() {
  return STRINGS;
}
