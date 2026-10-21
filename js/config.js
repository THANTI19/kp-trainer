/* Everything that makes this app "the ก.พ. app" lives here.
 *
 * IMPORTANT: apps hosted under the same GitHub Pages account (e.g. /toeic-trainer
 * and /kp-trainer) share ONE browser origin, so they share IndexedDB, localStorage
 * and Cache Storage. Every storage name below must be unique to this app,
 * otherwise the apps overwrite or delete each other's data.
 */
export const APP = {
  name: "ก.พ. Trainer",
  dbName: "kp-trainer",                  // IndexedDB (TOEIC uses "toeic-trainer")
  lsPrefix: "kp.",                       // localStorage keys (TOEIC uses "toeic.")
  gistFile: "kp-trainer-events.json",    // sync file inside the gist
  gistDescription: "KP Trainer sync (do not edit)",
};

export const SUBJECTS = {
  english: { name: "ภาษาอังกฤษ", short: "อังกฤษ", icon: "🇬🇧", pass: 50, mock: 25 },
  law: { name: "ความรู้และลักษณะการเป็นข้าราชการที่ดี", short: "ข้าราชการที่ดี", icon: "⚖️", pass: 60, mock: 25 },
};
export const SUBJECT_ORDER = ["english", "law"]; // order in the real ภาค ก paper

export const LAW_TOPICS = ["admin_state", "good_gov", "admin_proc", "tort", "ethics", "criminal", "other_law"];

export const TOPICS = {
  admin_state: "ระเบียบบริหารราชการแผ่นดิน",
  good_gov: "บริหารกิจการบ้านเมืองที่ดี",
  admin_proc: "วิธีปฏิบัติราชการทางปกครอง",
  tort: "ความรับผิดทางละเมิดของเจ้าหน้าที่",
  ethics: "มาตรฐานทางจริยธรรม",
  criminal: "ความผิดต่อตำแหน่งหน้าที่ราชการ",
  other_law: "กฎหมายอื่น ๆ",
  conversation: "Conversation",
  vocabulary: "Vocabulary",
  grammar: "Grammar",
  reading: "Reading",
};

export const DECKS = {
  law: { name: "การ์ดกฎหมาย", icon: "⚖️" },
  english: { name: "คำศัพท์อังกฤษ", icon: "🔤" },
};

export const LETTERS = ["ก", "ข", "ค", "ง", "จ"]; // some prep books use 5 choices
export const DAILY_SIZE = 10;
export const MOCK_MINUTES = 60; // practice pace for 50 questions, not the official exam time
