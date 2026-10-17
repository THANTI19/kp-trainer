# Prompt สำหรับสร้างข้อสอบ ก.พ. เพิ่ม

คัดลอกข้อความในกรอบด้านล่างไปใช้กับ Claude โดยแก้ TOPIC และจำนวนข้อได้ตามต้องการ
แล้วนำ JSON ที่ได้ไป import ในแอปตามวิธีท้ายไฟล์

**สำคัญมากสำหรับข้อกฎหมาย:** ควรแนบตัวบทกฎหมายจริงไปกับ prompt ด้วย
(คัดลอกจากเว็บสำนักงานคณะกรรมการกฤษฎีกา krisdika.go.th) แล้วสั่งให้เขียนจากตัวบทนั้นเท่านั้น
LLM จำตัวเลขวัน มาตรา และระยะเวลาผิดได้ ถ้าเฉลยผิด คนที่ใช้แอปจะจำผิดไปสอบ

```
You are a writer of practice questions for the Thai civil service exam (ก.พ. ภาค ก).
Write ORIGINAL questions in the style of the real exam. Do not copy questions from
past papers or published prep books.

TOPIC: <เช่น พ.ร.บ.วิธีปฏิบัติราชการทางปกครอง พ.ศ. 2539 มาตรา 1-20>
SOURCE TEXT: <วางตัวบทกฎหมายที่นี่>
Create 15 questions in Thai, and 10 flashcards.

Rules for law questions:
- Every fact must come from SOURCE TEXT. Put the act name + section in "source".
- Use real exam phrasing: "ข้อใดกล่าวถูกต้อง", "ข้อใดไม่ใช่", "ภายในกี่วัน", short scenarios.
- Exactly one correct choice. Distractors must be plausible but clearly wrong
  according to the text (e.g. other time limits that appear in the same act).
- Numeric choices must be in ascending order.

Return ONLY valid JSON in this exact shape:
{
  "questions": [
    {"subject": "law", "topic": "admin_state|good_gov|admin_proc|tort|ethics|criminal",
     "stem": "...", "choices": ["...", "...", "...", "..."], "answer": <0-3>,
     "explanation_th": "<why, 1-2 sentences>", "source": "<พ.ร.บ.... มาตรา ...>"}
  ],
  "cards": [
    {"deck": "law", "front": "<short question>", "back": "<short answer>", "source": "<act + section>"}
  ]
}

For English questions use "subject": "english",
"topic": "conversation|vocabulary|grammar|reading", add "translation_th",
and for reading put the text in "passage" (repeat the same passage in each question about it).
English flashcards: {"deck": "english", "front": "<word>", "back": "<Thai meaning>",
"pos": "n|v|adj|adv", "example": "<sentence containing the word>"}.
```

## วิธี import

1. บันทึก JSON ที่ได้เป็นไฟล์ เช่น `new_questions.json`
2. ในแอป ไปที่ ⚙️ ตั้งค่า → **กู้คืนจากไฟล์สำรอง** → เลือกไฟล์ (แอปแยกได้เองว่าเป็นไฟล์เนื้อหา ไม่ใช่ไฟล์สำรอง)
3. แอปบอกจำนวนที่เพิ่ม ข้อที่ซ้ำหรือรูปแบบไม่ถูกต้องจะถูกข้าม

ถ้าจะให้ **ทุกคน** ที่ใช้แอปได้ข้อสอบชุดใหม่ ให้รวมข้อสอบเข้าไปใน `data/questions.json` และ `data/cards.json`
แล้วอัปโหลดขึ้น GitHub (อย่าลืมแก้ `VERSION` ใน `sw.js`)

**ตรวจทุกข้อก่อนใช้:** เทียบเฉลยกับตัวบท และดูว่าไม่มีตัวเลือกที่ถูกสองข้อ
