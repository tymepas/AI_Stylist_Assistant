# Evaluation Dataset

30 benchmark scenarios: 10 good matches, 10 bad matches, 10 borderline.

## Measure
- Verdict correctness (good/bad cases only)
- Reason quality
- Confidence appropriateness
- Failure handling (insufficient input cases)

## Success Criteria
≥90% agreement on clearly good and clearly bad cases. Borderline cases are judged on reasoning quality, not verdict agreement, since reasonable people could disagree.

## Case Template
```
Case ID:
Photo description:
Garment description:
Occasion:
Stated style preference:
Category: good | bad | borderline
Expected verdict (if not borderline):
Notes:
```

## Examples

**Case 001** — Photo: neutral lighting. Garment: charcoal tailored blazer, slim fit. Occasion: job interview. Preference: formal/minimal. Category: good. Expected: Recommended or Highly Recommended.

---

**Case 002** — Photo: bright daylight. Garment: neon graphic streetwear hoodie, oversized. Occasion: wedding guest. Preference: formal. Category: bad. Expected: Not Recommended. Should trigger an explicit style_preference_match conflict, not a silent average.

---

**Case 003** — Photo: mixed indoor lighting. Garment: dark green midi dress, plain. Occasion: dinner date. Preference: smart casual. Category: borderline. Notes: tests reasoning quality, not verdict, since the right answer depends on context the model can't know.

---

**Case 004** — Photo: clear indoor selfie. Garment: navy business suit with white shirt. Occasion: client presentation. Preference: business formal. Category: good. Expected: Highly Recommended. Notes: Tests classic business attire.

---

**Case 005** — Photo: outdoor daylight selfie. Garment: black polo shirt and chinos. Occasion: startup interview. Preference: smart casual. Category: good. Expected: Recommended. Notes: Startup culture should not require a full suit.

---

**Case 006** — Photo: neutral lighting. Garment: grey blazer with dark jeans. Occasion: networking event. Preference: business casual. Category: good. Expected: Recommended. Notes: Tests business casual judgment.

---

**Case 007** — Photo: clear selfie. Garment: tuxedo. Occasion: black-tie gala. Preference: formal. Category: good. Expected: Highly Recommended.

---

**Case 008** — Photo: indoor portrait. Garment: navy saree. Occasion: corporate award ceremony. Preference: elegant. Category: good. Expected: Recommended.

---

**Case 009** — Photo: natural daylight. Garment: cream sherwani. Occasion: wedding groom. Preference: traditional. Category: good. Expected: Highly Recommended.

---

**Case 010** — Photo: clear lighting. Garment: pastel kurta pajama. Occasion: Diwali celebration. Preference: traditional. Category: good. Expected: Highly Recommended.

---

**Case 011** — Photo: neutral lighting. Garment: white shirt with navy trousers. Occasion: office meeting. Preference: minimalist. Category: good. Expected: Recommended.

---

**Case 012** — Photo: professional portrait. Garment: charcoal blazer. Occasion: conference speaker. Preference: business formal. Category: good. Expected: Highly Recommended.

---

**Case 013** — Photo: outdoor selfie. Garment: athletic shorts and tank top. Occasion: business interview. Preference: formal. Category: bad. Expected: Not Recommended.

---

**Case 014** — Photo: indoor selfie. Garment: beach flip-flops and shorts. Occasion: wedding guest. Preference: formal. Category: bad. Expected: Not Recommended.

---

**Case 015** — Photo: clear portrait. Garment: distressed ripped jeans and oversized hoodie. Occasion: client meeting. Preference: formal. Category: bad. Expected: Not Recommended.

---

**Case 016** — Photo: neutral lighting. Garment: gym tracksuit. Occasion: office presentation. Preference: business. Category: bad. Expected: Not Recommended.

---

**Case 017** — Photo: clear selfie. Garment: printed beach shirt. Occasion: funeral. Preference: conservative. Category: bad. Expected: Not Recommended.

---

**Case 018** — Photo: natural lighting. Garment: swimwear. Occasion: office conference. Preference: professional. Category: bad. Expected: Not Recommended.

---

**Case 019** — Photo: indoor lighting. Garment: oversized streetwear hoodie. Occasion: board meeting. Preference: business. Category: bad. Expected: Not Recommended.

---

**Case 020** — Photo: clear portrait. Garment: casual T-shirt with graphic print. Occasion: wedding reception. Preference: formal. Category: bad. Expected: Not Recommended.

---

**Case 021** — Photo: daylight selfie. Garment: pajamas. Occasion: networking event. Preference: business casual. Category: bad. Expected: Not Recommended.

---

**Case 022** — Photo: clear selfie. Garment: sports jersey. Occasion: client presentation. Preference: formal. Category: bad. Expected: Not Recommended.

---

**Case 023** — Photo: mixed lighting. Garment: blazer with sneakers. Occasion: business casual Friday. Preference: business casual. Category: borderline. Notes: Depends on company culture.

---

**Case 024** — Photo: indoor portrait. Garment: black kurta. Occasion: office Diwali celebration. Preference: traditional. Category: borderline. Notes: Traditional clothing may be appropriate depending on workplace culture.

---

**Case 025** — Photo: outdoor selfie. Garment: denim jacket. Occasion: dinner date. Preference: smart casual. Category: borderline. Notes: Tests reasoning rather than verdict.

---

**Case 026** — Photo: clear portrait. Garment: formal suit. Occasion: beach wedding. Preference: formal. Category: borderline. Notes: Formality is correct but climate may reduce suitability.

---

**Case 027** — Photo: natural daylight. Garment: linen shirt and chinos. Occasion: summer office. Preference: business casual. Category: borderline. Notes: Weather should influence reasoning.

---

**Case 028** — Photo: selfie wearing a blue shirt. Garment: black blazer uploaded separately. Occasion: business meeting. Preference: business formal. Category: borderline. Notes: AI must ignore clothing currently worn in the selfie and evaluate only the uploaded blazer.

---

**Case 029** — Photo: selfie with sunglasses. Garment: business suit. Occasion: interview. Preference: formal. Category: borderline. Notes: Sunglasses should reduce confidence slightly but not prevent analysis.

---

**Case 030** — Photo: slightly dim lighting. Garment: navy blazer. Occasion: conference. Preference: business formal. Category: borderline. Notes: Tests confidence calibration under imperfect image quality.
