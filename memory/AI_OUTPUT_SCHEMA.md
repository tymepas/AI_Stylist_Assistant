# AI OUTPUT SCHEMA

- Allowed rating values: "Excellent" | "Good" | "Fair" | "Poor" | "Unable to Evaluate"
- Allowed confidence values: "High" | "Medium" | "Low"
- Allowed status values: "complete" | "unable_to_analyze"

## Model output (no overall verdict, model never fills this in)

```json
{
  "status": "",
  "dimensions": {
    "occasion": {"rating": "", "reason": "", "confidence": ""},
    "color": {"rating": "", "reason": "", "confidence": ""},
    "formality": {"rating": "", "reason": "", "confidence": ""},
    "seasonality": {"rating": "", "reason": "", "confidence": ""},
    "style": {"rating": "", "reason": "", "confidence": ""},
    "style_preference_match": {"rating": "", "reason": "", "confidence": ""}
  },
  "things_to_consider": [],
  "analysis_based_on": {
    "considered": ["photo", "garment", "occasion", "style_preference"],
    "not_considered": ["price", "material_quality", "brand", "durability", "comfort"]
  },
  "next_step": ""
}
```

## Unable to analyze

```json
{
  "status": "unable_to_analyze",
  "reason": "",
  "confidence": "Low",
  "next_step": ""
}
```

## Final report (after the application computes the verdict)

The application adds `overall_recommendation` and `verdict_score` to the model's output using the weighted formula in PRD.md. These two fields are never produced by the model directly.

## Validation
Every rating and confidence field must exactly match one of the allowed enum values above. If any field is missing or out of enum, treat the whole response as invalid, enter the invalid JSON failure state, do not partially render it.

## Phase 4 Shopping Advisor extension

For `status: "complete"`, the raw model response also includes an optional advisory section:

```json
"shopping_advisor": {
  "recommendations": [
    {
      "title": "",
      "garment_type": "top | bottom | outerwear | dress | footwear | accessory | suiting | traditional_wear",
      "color_direction": "",
      "style_direction": "",
      "rationale": "",
      "addresses": ["occasion"],
      "match_level": "Excellent Match | Strong Match | Good Match | Possible Match"
    }
  ]
}
```

The model returns an empty `recommendations` array when Style DNA context is absent. The application validates this section separately from the six evaluation dimensions. Invalid shopping data never invalidates an otherwise valid outfit analysis.

Shopping advice is advisory only. It must not calculate or estimate a verdict score, recommendation, price, stock, retailer, URL, affiliate link, material quality, brand, durability, or comfort.