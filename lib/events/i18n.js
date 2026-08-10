/* Guest-facing copy for event invitations.

   Deliberately client-safe — NO db import, no "server-only" — because the
   language switcher on the invite page is a client component and imports this
   directly. Same constraint as lib/locations.js.

   Arabic is present from day one on purpose. Retrofitting RTL after the layout
   exists means auditing every margin, every icon direction and every flex row;
   carrying `dir` through from the start costs almost nothing. English and Malay
   are the two that ship reviewed — Arabic strings are in place and correct, but
   have a native speaker read them before an event goes out to Arabic guests. */

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

const STRINGS = {
  en: {
    youreInvited: "You're invited",
    hostedBy: "Hosted by",
    when: "When",
    where: "Where",
    dressCode: "Dress code",
    addToCalendar: "Add to calendar",
    getDirections: "Get directions",
    rsvpTitle: "Will you join us?",
    rsvpBy: "Kindly reply by",
    yes: "Joyfully accept",
    no: "Regretfully decline",
    maybe: "Not sure yet",
    adults: "Adults",
    children: "Children",
    partyNames: "Names of those joining you",
    partyNamesHint: "One per line — helps us with seating",
    dietary: "Dietary requirements",
    dietaryHint: "Allergies, halal, vegetarian, anything we should know",
    message: "A message for the host",
    photoTitle: "Share a family photo",
    photoHint: "We're making something special with these. Optional.",
    photoConsent: "I'm happy for this photo to be used in event materials",
    familyName: "Family name",
    familyNameHint: "How your family should be named on the photo",
    choosePhoto: "Choose a photo",
    changePhoto: "Change photo",
    supportTitle: "Support the event",
    supportBody: "If you'd like to contribute, every bit helps us put this together.",
    supportCta: "Contribute",
    submit: "Send my reply",
    update: "Update my reply",
    saving: "Sending…",
    thanksYes: "Wonderful — we can't wait to see you.",
    thanksNo: "Thank you for letting us know. You'll be missed.",
    thanksMaybe: "Thank you — let us know when you're sure.",
    youReplied: "You replied",
    changeReply: "Change my reply",
    closed: "RSVPs for this event are now closed.",
    notFound: "This invitation link isn't valid.",
    notFoundBody: "Please check the link you were sent, or contact your host.",
    guestsCount: "guests",
    language: "Language",
    required: "Please choose a reply.",
    tooLarge: "That photo is too large — please pick one under 10MB.",
    partyTooBig: "That's more guests than this invitation covers — please contact your host.",
    error: "Something went wrong. Please try again.",
  },
  ms: {
    youreInvited: "Anda dijemput",
    hostedBy: "Dianjurkan oleh",
    when: "Bila",
    where: "Di mana",
    dressCode: "Kod pakaian",
    addToCalendar: "Tambah ke kalendar",
    getDirections: "Dapatkan arah",
    rsvpTitle: "Sudikah anda hadir?",
    rsvpBy: "Sila balas sebelum",
    yes: "Ya, saya hadir",
    no: "Maaf, tidak dapat hadir",
    maybe: "Belum pasti",
    adults: "Dewasa",
    children: "Kanak-kanak",
    partyNames: "Nama mereka yang bersama anda",
    partyNamesHint: "Satu setiap baris — membantu kami mengatur tempat duduk",
    dietary: "Keperluan pemakanan",
    dietaryHint: "Alahan, halal, vegetarian, apa sahaja yang perlu kami tahu",
    message: "Pesanan untuk tuan rumah",
    photoTitle: "Kongsi gambar keluarga",
    photoHint: "Kami sedang menyediakan sesuatu yang istimewa. Pilihan sahaja.",
    photoConsent: "Saya bersetuju gambar ini digunakan untuk bahan acara",
    familyName: "Nama keluarga",
    familyNameHint: "Bagaimana keluarga anda dinamakan pada gambar",
    choosePhoto: "Pilih gambar",
    changePhoto: "Tukar gambar",
    supportTitle: "Sokong acara ini",
    supportBody: "Jika anda ingin menyumbang, setiap sumbangan amat bermakna.",
    supportCta: "Menyumbang",
    submit: "Hantar jawapan saya",
    update: "Kemas kini jawapan saya",
    saving: "Menghantar…",
    thanksYes: "Alhamdulillah — kami menantikan kehadiran anda.",
    thanksNo: "Terima kasih kerana memaklumkan. Kami akan merindui anda.",
    thanksMaybe: "Terima kasih — beritahu kami apabila anda pasti.",
    youReplied: "Anda telah menjawab",
    changeReply: "Tukar jawapan saya",
    closed: "RSVP untuk acara ini telah ditutup.",
    notFound: "Pautan jemputan ini tidak sah.",
    notFoundBody: "Sila semak pautan yang dihantar kepada anda, atau hubungi tuan rumah.",
    guestsCount: "tetamu",
    language: "Bahasa",
    required: "Sila pilih jawapan anda.",
    tooLarge: "Gambar itu terlalu besar — sila pilih yang bawah 10MB.",
    partyTooBig: "Jumlah tetamu melebihi jemputan ini — sila hubungi tuan rumah.",
    error: "Sesuatu tidak kena. Sila cuba lagi.",
  },
  ar: {
    youreInvited: "أنتم مدعوون",
    hostedBy: "بدعوة من",
    when: "الموعد",
    where: "المكان",
    dressCode: "الزي",
    addToCalendar: "أضف إلى التقويم",
    getDirections: "الاتجاهات",
    rsvpTitle: "هل ستشرفوننا بالحضور؟",
    rsvpBy: "نرجو الرد قبل",
    yes: "نعم، سأحضر",
    no: "أعتذر عن الحضور",
    maybe: "لست متأكداً بعد",
    adults: "البالغون",
    children: "الأطفال",
    partyNames: "أسماء المرافقين",
    partyNamesHint: "اسم في كل سطر — يساعدنا في ترتيب الجلوس",
    dietary: "المتطلبات الغذائية",
    dietaryHint: "الحساسية، حلال، نباتي، أو أي شيء ينبغي أن نعرفه",
    message: "رسالة إلى المضيف",
    photoTitle: "شاركونا صورة العائلة",
    photoHint: "نحضّر بها شيئاً مميزاً. اختياري.",
    photoConsent: "أوافق على استخدام هذه الصورة في مواد الفعالية",
    familyName: "اسم العائلة",
    familyNameHint: "كيف يُكتب اسم عائلتكم على الصورة",
    choosePhoto: "اختر صورة",
    changePhoto: "تغيير الصورة",
    supportTitle: "ادعم الفعالية",
    supportBody: "إن أردتم المساهمة، فكل مساهمة تعيننا على إقامتها.",
    supportCta: "المساهمة",
    submit: "إرسال ردي",
    update: "تحديث ردي",
    saving: "جارٍ الإرسال…",
    thanksYes: "ما شاء الله — في انتظار تشريفكم.",
    thanksNo: "شكراً لإعلامنا. سنفتقدكم.",
    thanksMaybe: "شكراً لكم — أعلمونا عند التأكد.",
    youReplied: "ردكم المسجَّل",
    changeReply: "تعديل ردي",
    closed: "أُغلق باب الرد على هذه الدعوة.",
    notFound: "رابط الدعوة غير صالح.",
    notFoundBody: "يرجى التحقق من الرابط المرسل إليكم، أو التواصل مع المضيف.",
    guestsCount: "ضيوف",
    language: "اللغة",
    required: "يرجى اختيار الرد.",
    tooLarge: "حجم الصورة كبير — يرجى اختيار صورة أقل من ١٠ ميغابايت.",
    partyTooBig: "عدد الضيوف يتجاوز ما تغطيه هذه الدعوة — يرجى التواصل مع المضيف.",
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
