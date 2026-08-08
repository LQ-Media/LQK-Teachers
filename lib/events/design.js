// Invite styling vocabulary — shared by the builder (client), the live
// preview, the public invite page and the email renderer, so all four agree on
// what a saved design means.
//
// No "server-only" here on purpose: the builder is a Client Component and
// imports these lists to render its controls.

// Fonts are limited to web-safe stacks plus the two brand faces already loaded
// by app/layout.js. An invite email cannot rely on a webfont — Gmail and
// Outlook strip @font-face — so every choice names a real fallback that exists
// on the recipient's machine. `email` is what goes into the email's inline CSS.
export const FONTS = [
  { id: "baloo", label: "Baloo (brand display)", css: "var(--font-baloo), 'Trebuchet MS', sans-serif", email: "'Trebuchet MS', 'Segoe UI', sans-serif" },
  { id: "nunito", label: "Nunito Sans (brand body)", css: "var(--font-nunito), 'Segoe UI', sans-serif", email: "'Segoe UI', Tahoma, sans-serif" },
  { id: "georgia", label: "Georgia (serif)", css: "Georgia, 'Times New Roman', serif", email: "Georgia, 'Times New Roman', serif" },
  { id: "helvetica", label: "Helvetica (clean sans)", css: "'Helvetica Neue', Helvetica, Arial, sans-serif", email: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
  { id: "courier", label: "Courier (typewriter)", css: "'Courier New', Courier, monospace", email: "'Courier New', Courier, monospace" },
];

export const ALIGNMENTS = ["left", "center", "right"];

// How hard the background image is dimmed behind the text. A photo background
// with no scrim is the single most common way an invite becomes unreadable, so
// the default is a real dim, not zero.
export const OVERLAY_MIN = 0;
export const OVERLAY_MAX = 85;

export const DEFAULT_DESIGN = {
  headingFont: "baloo",
  bodyFont: "nunito",
  align: "center",
  // Brand palette from app/globals.css — ink on cream, lavender accent.
  pageColor: "#FBF6EC",
  cardColor: "#FFFFFF",
  textColor: "#403548",
  mutedColor: "#7E7368",
  accentColor: "#8C7AA8",
  buttonTextColor: "#FFFFFF",
  overlay: 45,
  cornerRadius: 20,
  showLogo: true,
};

const HEX = /^#[0-9a-fA-F]{6}$/;

function hex(value, fallback) {
  return HEX.test(String(value || "")) ? String(value) : fallback;
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function fontId(value, fallback) {
  return FONTS.some((f) => f.id === value) ? value : fallback;
}

// Never trust a stored or submitted design blob: it reaches the public invite
// page and an email, both of which interpolate it into CSS.
export function normalizeDesign(raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  return {
    headingFont: fontId(d.headingFont, DEFAULT_DESIGN.headingFont),
    bodyFont: fontId(d.bodyFont, DEFAULT_DESIGN.bodyFont),
    align: ALIGNMENTS.includes(d.align) ? d.align : DEFAULT_DESIGN.align,
    pageColor: hex(d.pageColor, DEFAULT_DESIGN.pageColor),
    cardColor: hex(d.cardColor, DEFAULT_DESIGN.cardColor),
    textColor: hex(d.textColor, DEFAULT_DESIGN.textColor),
    mutedColor: hex(d.mutedColor, DEFAULT_DESIGN.mutedColor),
    accentColor: hex(d.accentColor, DEFAULT_DESIGN.accentColor),
    buttonTextColor: hex(d.buttonTextColor, DEFAULT_DESIGN.buttonTextColor),
    overlay: clampInt(d.overlay, OVERLAY_MIN, OVERLAY_MAX, DEFAULT_DESIGN.overlay),
    cornerRadius: clampInt(d.cornerRadius, 0, 40, DEFAULT_DESIGN.cornerRadius),
    showLogo: d.showLogo !== false,
  };
}

export function parseDesign(json) {
  try {
    return normalizeDesign(JSON.parse(json || "{}"));
  } catch {
    return { ...DEFAULT_DESIGN };
  }
}

// Script fallbacks appended behind the operator's chosen font.
//
// The font list above is Latin-only. Picking "Georgia" for a Tamil or Chinese
// invite would otherwise leave the browser to pick any fallback it likes, which
// differs per device and can land on something barely legible. Naming the
// fallback explicitly keeps Arabic, Chinese and Tamil looking deliberate on
// every device, while the Latin choice still governs any Latin text alongside.
//
// Arabic reuses the Naskh face app/layout.js already loads for the Quran reader,
// so an Arabic invite matches the Arabic everywhere else in the portal. Email
// gets system faces only — no webfont survives Gmail or Outlook.
const SCRIPT_FALLBACK = {
  ar: {
    css: "var(--font-naskh), var(--font-amiri), 'Noto Naskh Arabic', 'Geeza Pro', serif",
    email: "'Geeza Pro', 'Traditional Arabic', 'Noto Naskh Arabic', serif",
  },
  zh: {
    css: "'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif",
    email: "'PingFang SC', 'Microsoft YaHei', SimSun, sans-serif",
  },
  ta: {
    css: "'Noto Sans Tamil', 'Nirmala UI', Latha, 'Tamil Sangam MN', sans-serif",
    email: "'Nirmala UI', Latha, 'Tamil Sangam MN', sans-serif",
  },
};

export function fontCss(id, language) {
  const base = (FONTS.find((f) => f.id === id) || FONTS[0]).css;
  const fallback = SCRIPT_FALLBACK[language]?.css;
  return fallback ? `${base.replace(/,\s*(serif|sans-serif|monospace)$/, "")}, ${fallback}` : base;
}

export function fontEmail(id, language) {
  const base = (FONTS.find((f) => f.id === id) || FONTS[0]).email;
  const fallback = SCRIPT_FALLBACK[language]?.email;
  return fallback ? `${base.replace(/,\s*(serif|sans-serif|monospace)$/, "")}, ${fallback}` : base;
}

// ── Wording ────────────────────────────────────────────────────────────────
// Fixed strings for the five supported invite languages: the operator's own
// event text is used verbatim, and only this scaffolding is translated.
//
// The Malay, Mandarin, Tamil and Arabic wording is a first pass and has NOT
// been checked by a native speaker. Read it before the first invite goes out in
// that language — see docs/EVENTS.md.
export const LANGUAGES = [
  { id: "en", label: "English" },
  { id: "ms", label: "Bahasa Melayu" },
  { id: "zh", label: "中文 (Mandarin)" },
  { id: "ta", label: "தமிழ் (Tamil)" },
  { id: "ar", label: "العربية (Arabic)" },
];

// Arabic reads right-to-left. This drives `dir` on the invite page and in the
// email, which flips the whole layout — not just text alignment, but the order
// of the agenda's time/activity columns and which side padding lands on.
const RTL = new Set(["ar"]);

export function isRtl(language) {
  return RTL.has(language);
}

export function dirFor(language) {
  return isRtl(language) ? "rtl" : "ltr";
}

// The operator picks alignment in physical terms (left/right), but in an RTL
// invite "left" would put the text on the wrong side of the card. Flip it so
// the control keeps meaning what it looks like it means.
export function resolveAlign(align, language) {
  if (!isRtl(language)) return align;
  if (align === "left") return "right";
  if (align === "right") return "left";
  return align;
}

const STRINGS = {
  en: {
    youreInvited: "You're invited",
    when: "When",
    where: "Where",
    programme: "Programme",
    dressCode: "Dress code",
    whatToBring: "What to bring",
    gettingThere: "Getting there",
    parking: "Parking",
    directions: "Directions",
    openInMaps: "Open in Maps",
    willYouCome: "Will you be joining us?",
    yes: "Yes, I'll be there",
    no: "Sorry, I can't make it",
    thanksYes: "Wonderful — we'll see you there!",
    thanksNo: "Thank you for letting us know.",
    change: "Changed your mind?",
    responded: "Your response has been recorded.",
    viewInvite: "View the invitation",
    hostedBy: "Hosted by",
    dear: "Dear",
    parentFallback: "there",
    linkExpired: "This invitation link isn't valid.",
    linkExpiredBody: "Please check the link in your email or WhatsApp message, or contact us.",
  },
  ms: {
    youreInvited: "Anda dijemput",
    when: "Bila",
    where: "Di mana",
    programme: "Atur cara",
    dressCode: "Kod pakaian",
    whatToBring: "Apa yang perlu dibawa",
    gettingThere: "Cara ke sana",
    parking: "Tempat letak kereta",
    directions: "Arah",
    openInMaps: "Buka dalam Peta",
    willYouCome: "Adakah anda akan hadir?",
    yes: "Ya, saya akan hadir",
    no: "Maaf, saya tidak dapat hadir",
    thanksYes: "Bagus — jumpa anda di sana!",
    thanksNo: "Terima kasih kerana memberitahu kami.",
    change: "Berubah fikiran?",
    responded: "Jawapan anda telah direkodkan.",
    viewInvite: "Lihat jemputan",
    hostedBy: "Dianjurkan oleh",
    dear: "Salam sejahtera",
    parentFallback: "Ibu/Bapa",
    linkExpired: "Pautan jemputan ini tidak sah.",
    linkExpiredBody: "Sila semak pautan dalam e-mel atau mesej WhatsApp anda, atau hubungi kami.",
  },
  zh: {
    youreInvited: "诚挚邀请",
    when: "时间",
    where: "地点",
    programme: "活动流程",
    dressCode: "着装要求",
    whatToBring: "请携带",
    gettingThere: "交通指南",
    parking: "停车",
    directions: "路线",
    openInMaps: "在地图中打开",
    willYouCome: "您会出席吗？",
    yes: "是的，我会出席",
    no: "抱歉，我无法出席",
    thanksYes: "太好了 — 期待与您见面！",
    thanksNo: "感谢您的告知。",
    change: "改变主意了？",
    responded: "您的回复已记录。",
    viewInvite: "查看邀请函",
    hostedBy: "主办单位",
    dear: "亲爱的",
    parentFallback: "家长",
    linkExpired: "此邀请链接无效。",
    linkExpiredBody: "请检查您电邮或 WhatsApp 讯息中的链接，或与我们联系。",
  },
  ta: {
    youreInvited: "அன்புடன் அழைக்கிறோம்",
    when: "எப்போது",
    where: "எங்கே",
    programme: "நிகழ்ச்சி நிரல்",
    dressCode: "உடை நெறிமுறை",
    whatToBring: "என்ன கொண்டு வர வேண்டும்",
    gettingThere: "வழி விவரம்",
    parking: "வாகன நிறுத்தம்",
    directions: "வழிகாட்டுதல்",
    openInMaps: "வரைபடத்தில் திறக்கவும்",
    willYouCome: "நீங்கள் கலந்து கொள்வீர்களா?",
    yes: "ஆம், நான் வருகிறேன்",
    no: "மன்னிக்கவும், என்னால் வர இயலாது",
    thanksYes: "அருமை — அங்கு சந்திப்போம்!",
    thanksNo: "தெரிவித்தமைக்கு நன்றி.",
    change: "மனம் மாறிவிட்டதா?",
    responded: "உங்கள் பதில் பதிவு செய்யப்பட்டது.",
    viewInvite: "அழைப்பிதழைப் பார்க்கவும்",
    hostedBy: "ஏற்பாடு",
    dear: "அன்புள்ள",
    parentFallback: "பெற்றோர்",
    linkExpired: "இந்த அழைப்பு இணைப்பு செல்லுபடியாகாது.",
    linkExpiredBody: "உங்கள் மின்னஞ்சல் அல்லது WhatsApp செய்தியில் உள்ள இணைப்பைச் சரிபார்க்கவும், அல்லது எங்களைத் தொடர்பு கொள்ளவும்.",
  },
  ar: {
    youreInvited: "أنتم مدعوون",
    when: "الموعد",
    where: "المكان",
    programme: "البرنامج",
    dressCode: "الزي",
    whatToBring: "ما يلزم إحضاره",
    gettingThere: "كيفية الوصول",
    parking: "مواقف السيارات",
    directions: "الاتجاهات",
    openInMaps: "افتح في الخرائط",
    willYouCome: "هل ستنضمون إلينا؟",
    yes: "نعم، سأحضر",
    no: "عذرًا، لا أستطيع الحضور",
    thanksYes: "رائع — نراكم هناك!",
    thanksNo: "شكرًا لإعلامنا.",
    change: "غيّرت رأيك؟",
    responded: "تم تسجيل ردكم.",
    viewInvite: "عرض الدعوة",
    hostedBy: "بتنظيم من",
    dear: "عزيزي",
    parentFallback: "ولي الأمر",
    linkExpired: "رابط الدعوة هذا غير صالح.",
    linkExpiredBody: "يرجى التحقق من الرابط في بريدكم الإلكتروني أو رسالة واتساب، أو التواصل معنا.",
  },
};

export function t(language) {
  return STRINGS[language] || STRINGS.en;
}
